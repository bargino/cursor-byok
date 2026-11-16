import process from "node:process";
import { Buffer } from "node:buffer";
// Adapted from codearts2api-panel (Apache-2.0), commit 7a99d03e8324fde1d0d08bb44e8880eee7f75abf.
// Local capture only; installer, pairing service and file result export are omitted.
// Standalone local login helper. No npm packages, existing browser profiles,
// password handling or public upload endpoint. Metadata discovery reads only
// TeleAgent's device-meta.json and its installed public application resources.
import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const LOGIN_URL =
  "https://www.teleai.com.cn/teleai-api/upms/public/auth/authorize?client_id=Z2veLLEHhZfq3hb5hWIwqJuPajIuasYi&redirect_uri=https%3A%2F%2Fagent.teleai.com.cn%2FsuperCowork%2Fsapi%2Fcowork%2Fauth";
export const CALLBACK = "https://agent.teleai.com.cn/superCowork/sapi/cowork/auth";
class LoginError extends Error {}
const MAX_FILE = 256 * 1024, MAX_BODY = 1024 * 1024;

export function validateTask(task, now = Date.now()) {
  if (
    !task || task.version !== 1 || task.provider !== "teleagent" || task.url !== LOGIN_URL ||
    typeof task.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(task.challenge) ||
    !Number.isSafeInteger(task.expires_at) || task.expires_at * 1000 <= now ||
    task.expires_at * 1000 > now + 630000
  ) {
    throw new LoginError("登录任务无效或已过期，请在面板重新生成 / Invalid or expired login task");
  }
  return task;
}

export async function readJSON(path) {
  if (typeof path !== "string" || !path.trim()) {
    throw new LoginError("未填写 JSON 文件路径 / Enter a JSON file path");
  }
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new LoginError(
        "找不到指定的 JSON 文件，请检查完整路径 / JSON file not found; check the full path",
      );
    }
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw new LoginError(
        "无法读取指定的 JSON 文件，请检查文件权限 / Cannot read JSON file; check permissions",
      );
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new LoginError(
      "输入的是文件夹或其他非普通文件，请填写具体 JSON 文件的完整路径 / Select a JSON file, not a folder",
    );
  }
  if (info.size > MAX_FILE) {
    throw new LoginError(
      "JSON 文件超过 256 KiB 大小限制 / JSON file exceeds the 256 KiB size limit",
    );
  }
  const bytes = await readFile(path);
  if (bytes.length > MAX_FILE) throw new LoginError("JSON file exceeds size limit");
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new LoginError("JSON 格式无效 / Invalid JSON");
  }
}

export function clientMetadata(input) {
  const o = input?.auth ?? input;
  const value = (...keys) =>
    keys.map((k) => o?.[k]).find((v) => typeof v === "string" && v.trim())?.trim() ?? "";
  const result = {
    api_key: value("api_key", "apiKey", "gateway_key"),
    device_id: value("device_id", "deviceId"),
    install_id: value("install_id", "installId"),
    app_version: value("app_version", "appVersion"),
  };
  if (
    !/^sk-[^\s\x00-\x1f\x7f]{1,4093}$/.test(result.api_key) ||
    !/^[A-Za-z0-9_.:-]{1,256}$/.test(result.device_id) ||
    !/^[A-Za-z0-9_.:-]{1,256}$/.test(result.install_id) ||
    result.app_version.length > 64 ||
    !/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(result.app_version)
  ) {
    throw new LoginError(
      "客户端配置缺少有效 api_key、device_id、install_id、app_version / Missing client configuration fields",
    );
  }
  // Never copy an earlier account token, expiry, identity or portal cookies.
  return result;
}

// Bound reads to the ASAR index and selected JavaScript resources. Never
// execute client code, unpack the whole application or touch account tokens.
async function readExact(file, size, position) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const read = await file.read(bytes, offset, size - offset, position + offset);
    if (!read.bytesRead) throw new LoginError("客户端资源不完整 / Incomplete client resource");
    offset += read.bytesRead;
  }
  return bytes;
}
export async function openApplication(archive) {
  const file = await open(archive, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 16) {
      throw new LoginError("客户端安装包索引无效 / Invalid application archive");
    }
    const prefix = await readExact(file, 16, 0);
    const headerSize = prefix.readUInt32LE(4),
      payloadSize = prefix.readUInt32LE(8),
      jsonSize = prefix.readUInt32LE(12);
    if (
      prefix.readUInt32LE(0) !== 4 || headerSize !== payloadSize + 4 || jsonSize < 2 ||
      jsonSize > 16 * 1024 * 1024 || jsonSize + 8 > headerSize || headerSize - jsonSize > 12 ||
      8 + headerSize > info.size
    ) {
      throw new LoginError("客户端安装包索引无效 / Invalid application archive");
    }
    const header = await readExact(file, jsonSize, 16);
    let tree;
    try {
      tree = JSON.parse(header.toString("utf8"));
    } catch {
      throw new LoginError("客户端安装包索引无效 / Invalid application archive");
    }
    const entry = (path) => {
      if (typeof path !== "string" || path.split("/").some((p) => !p || p === "." || p === "..")) {
        throw new LoginError("客户端资源路径无效 / Invalid client resource path");
      }
      let item = tree;
      for (const part of path.split("/")) {
        if (!item?.files || !Object.hasOwn(item.files, part)) return undefined;
        item = item.files[part];
      }
      return item;
    };
    return {
      close: () => file.close(),
      scripts: () =>
        Object.entries(entry("dist-electron")?.files ?? {}).filter(([name, item]) =>
          /^main(?:[-.][A-Za-z0-9_.-]+)?\.(?:c?js|mjs)$/.test(name) && item && !item.files &&
          !item.unpacked && !item.link
        ).map(([name]) => "dist-electron/" + name).slice(0, 12),
      async read(path, max = 24 * 1024 * 1024) {
        const item = entry(path);
        if (
          !item || item.files || item.unpacked || item.link || !Number.isSafeInteger(item.size) ||
          item.size < 0 || item.size > max || typeof item.offset !== "string" ||
          !/^\d{1,16}$/.test(item.offset)
        ) {
          throw new LoginError(
            "客户端资源不可读取或过大 / Client resource unavailable or too large",
          );
        }
        const start = 8 + headerSize + Number(item.offset);
        if (
          !Number.isSafeInteger(start) || !Number.isSafeInteger(start + item.size) ||
          start < 8 + headerSize || start + item.size > info.size
        ) throw new LoginError("客户端资源越界 / Client resource out of bounds");
        const bytes = await readExact(file, item.size, start);
        return bytes.toString("utf8");
      },
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}

export function gatewayKeyFromSource(source) {
  if (
    typeof source !== "string" || !source.includes("https://agent.teleai.com.cn") ||
    !source.includes("/superCowork/sapi")
  ) return undefined;
  const keys = new Set();
  // Match only the NewApi provider's options. Other channels (image, search,
  // telemetry) may have different keys and must not be selected by proximity.
  for (
    const match of source.matchAll(
      /["']?NewApi["']?\s*:\s*\{[^{}]{0,1024}\boptions\s*:\s*\{([^{}]{1,8192})\}/g,
    )
  ) {
    const options = match[1];
    if (!/\buseSuperAgentAuth\s*:\s*(?:!0|true)\b/.test(options)) continue;
    const key = options.match(/\bapiKey\s*:\s*["'](sk-[A-Za-z0-9_-]{1,4093})["']/)?.[1];
    if (key) keys.add(key);
  }
  if (keys.size > 1) {
    throw new LoginError(
      "客户端存在多个模型网关配置，请使用凭据导入 / Multiple model gateway configurations; import credentials",
    );
  }
  return [...keys][0];
}

export async function installedMetadata(archive) {
  const app = await openApplication(archive);
  try {
    let pkg;
    try {
      pkg = JSON.parse(await app.read("package.json", MAX_FILE));
    } catch {
      throw new LoginError(
        "无法读取 TeleAgent 客户端版本 / Cannot read TeleAgent application metadata",
      );
    }
    if (
      typeof pkg.name !== "string" || pkg.name.toLowerCase() !== "teleagent" ||
      typeof pkg.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(pkg.version) || pkg.version.length > 64
    ) {
      throw new LoginError(
        "所选安装包不是有效的 TeleAgent 客户端 / Invalid TeleAgent installation",
      );
    }
    const scripts = app.scripts();
    if (
      typeof pkg.main === "string" && /\.(?:c?js|mjs)$/.test(pkg.main) &&
      !scripts.includes(pkg.main)
    ) scripts.unshift(pkg.main);
    const keys = new Set();
    let size = 0;
    for (const name of scripts.slice(0, 12)) {
      let text;
      try {
        text = await app.read(name);
      } catch {
        continue;
      }
      size += Buffer.byteLength(text);
      if (size > 64 * 1024 * 1024) break;
      const key = gatewayKeyFromSource(text);
      if (key) keys.add(key);
    }
    if (keys.size !== 1) {
      throw new LoginError(
        "未能识别此版本的模型网关参数，请更新助手或使用凭据导入 / Model gateway metadata was not recognized; update or import credentials",
      );
    }
    return { api_key: [...keys][0], app_version: pkg.version };
  } finally {
    await app.close();
  }
}

export function discoveryLocations(
  { home = homedir(), os = platform(), env = process.env, appPath, dataDir } = {},
) {
  const absolute = (
    items,
  ) => [...new Set(items.filter((p) => typeof p === "string" && isAbsolute(p)))];
  const envJoin = (key, ...parts) =>
    env[key] && isAbsolute(env[key]) ? join(env[key], ...parts) : undefined;
  const apps = appPath ? [resolve(appPath)] : os === "darwin"
    ? [
      "/Applications/TeleAgent.app/Contents/Resources/app.asar",
      join(home, "Applications/TeleAgent.app/Contents/Resources/app.asar"),
    ]
    : os === "win32"
    ? ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((key) => [
      envJoin(key, "TeleAgent/resources/app.asar"),
      envJoin(key, "Programs/TeleAgent/resources/app.asar"),
    ])
    : [
      "/opt/TeleAgent/resources/app.asar",
      "/opt/teleagent/resources/app.asar",
      "/usr/share/TeleAgent/resources/app.asar",
      "/usr/share/teleagent/resources/app.asar",
    ];
  const data = dataDir ? [join(resolve(dataDir), "app-auth/device-meta.json")] : [
    join(
      env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
        ? env.XDG_DATA_HOME
        : join(home, ".local/share"),
      "TeleAgent/app-auth/device-meta.json",
    ),
    envJoin("APPDATA", "TeleAgent/app-auth/device-meta.json"),
    join(home, ".config/TeleAgent/app-auth/device-meta.json"),
    join(home, "Library/Application Support/TeleAgent/app-auth/device-meta.json"),
  ];
  return { apps: absolute(apps), devices: absolute(data) };
}

export async function discoverClientMetadata(options = {}) {
  const locations = discoveryLocations(options), apps = [], devices = [];
  let appError;
  for (let path of locations.apps) {
    try {
      if ((await stat(path)).isDirectory()) {
        path = path.endsWith(".app")
          ? join(path, "Contents/Resources/app.asar")
          : join(path, "resources/app.asar");
      }
      const metadata = await installedMetadata(path);
      if (
        !apps.some((a) =>
          a.metadata.api_key === metadata.api_key && a.metadata.app_version === metadata.app_version
        )
      ) apps.push({ path, metadata });
    } catch (e) {
      if (e.code !== "ENOENT") appError = e;
    }
  }
  if (apps.length > 1) {
    throw new LoginError(
      "发现多个不同版本的 TeleAgent，请使用凭据导入 / Multiple TeleAgent installations; import credentials",
    );
  }
  if (!apps.length) {
    throw appError instanceof LoginError ? appError : new LoginError(
      "未找到 TeleAgent 官方客户端，请先安装并启动一次，或使用凭据导入 / TeleAgent client not found; install and start it once, or import credentials",
    );
  }
  let deviceError;
  for (const path of locations.devices) {
    try {
      const data = await readJSON(path),
        device_id = data.device_id ?? data.deviceId,
        install_id = data.install_id ?? data.installId;
      if (
        typeof device_id !== "string" || typeof install_id !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,256}$/.test(device_id) || !/^[A-Za-z0-9_.:-]{1,256}$/.test(install_id)
      ) {
        throw new LoginError(
          "TeleAgent 设备信息不完整，请先启动官方客户端 / Incomplete device metadata; start TeleAgent first",
        );
      }
      if (
        !devices.some((d) =>
          d.metadata.device_id === device_id && d.metadata.install_id === install_id
        )
      ) devices.push({ path, metadata: { device_id, install_id } });
    } catch (e) {
      if (e.code !== "ENOENT" && !String(e.message).includes("file not found")) deviceError = e;
    }
  }
  if (devices.length > 1) {
    throw new LoginError(
      "发现多组 TeleAgent 设备信息，请使用凭据导入 / Multiple device records; import credentials",
    );
  }
  if (!devices.length) {
    throw deviceError instanceof LoginError ? deviceError : new LoginError(
      "未找到 TeleAgent 设备信息，请先启动一次官方客户端，或使用凭据导入 / Start TeleAgent once or import credentials",
    );
  }
  return {
    metadata: clientMetadata({ ...apps[0].metadata, ...devices[0].metadata }),
    appPath: apps[0].path,
    devicePath: devices[0].path,
  };
}

function accountToken(token, now) {
  if (
    typeof token !== "string" || token.length > 32768 ||
    !/^(?:[A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) return false;
  try {
    const jwt = token.includes(":") ? token.slice(token.indexOf(":") + 1) : token;
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    // This is candidate selection, never signature/identity verification. The
    // authenticated panel must call user_info before allowing confirmation.
    return Boolean(claims.accountId ?? claims.account_id ?? claims.uid) &&
      Number.isSafeInteger(claims.exp) && claims.exp * 1000 > now;
  } catch {
    return false;
  }
}

export function extractTokens(text, now = Date.now()) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_BODY) return [];
  const values = new Set();
  for (const m of text.matchAll(/(?:[?&#]token=|["']token["']\s*:\s*["'])([^\s"'<>\\]+)/g)) {
    try {
      const token = decodeURIComponent(m[1]);
      if (accountToken(token, now)) values.add(token);
    } catch { /* malformed encoding */ }
  }
  // JSON replies and HTML embedded JSON may contain the credential directly.
  // Preserve tenant prefixes rather than silently stripping them.
  for (
    const m of text.matchAll(
      /(?<![A-Za-z0-9_:-])(?:[A-Za-z0-9_-]+:)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    )
  ) {
    if (accountToken(m[0], now)) values.add(m[0]);
  }
  return [...values];
}

export function isCallback(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname === CALLBACK && !u.username && !u.password;
  } catch {
    return false;
  }
}

export class CDP {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data.length > MAX_BODY * 3) return;
      let m;
      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }
      if (m.id !== undefined) {
        const slot = this.pending.get(m.id);
        if (!slot) return;
        clearTimeout(slot.timer);
        this.pending.delete(m.id);
        if (m.error) slot.reject(new LoginError("浏览器命令失败 / Browser command failed"));
        else slot.resolve(m.result);
      } else if (typeof m.method === "string") {
        for (const listener of this.listeners) listener(m.method, m.params ?? {});
      }
    });
    socket.addEventListener("close", () => this.close());
    socket.addEventListener("error", () => this.close());
  }
  static async open(url, port) {
    const u = new URL(url);
    if (
      u.protocol !== "ws:" || u.hostname !== "127.0.0.1" || Number(u.port) !== port || u.username ||
      u.password
    ) {
      throw new LoginError("无效的本机浏览器连接 / Invalid local browser connection");
    }
    const ws = new WebSocket(url);
    try {
      await new Promise((ok, fail) => {
        const timer = setTimeout(
          () => fail(new LoginError("浏览器连接超时 / Browser connection timeout")),
          10000,
        );
        ws.addEventListener("open", () => {
          clearTimeout(timer);
          ok();
        }, { once: true });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          fail(new LoginError("浏览器连接失败 / Browser connection failed"));
        }, { once: true });
      });
      return new CDP(ws);
    } catch (e) {
      ws.close();
      throw e;
    }
  }
  send(method, params = {}, timeoutMs = 10000) {
    return new Promise((resolveCommand, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LoginError("浏览器命令超时 / Browser command timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCommand, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new LoginError("浏览器连接已关闭 / Browser connection closed"));
      }
    });
  }
  close() {
    for (const slot of this.pending.values()) {
      clearTimeout(slot.timer);
      slot.reject(new LoginError("浏览器连接已关闭 / Browser connection closed"));
    }
    this.pending.clear();
    this.listeners.clear();
    if (this.socket.readyState < 2) this.socket.close();
  }
}

// Only the official callback response is inspected. UPMS replies, analytics,
// scripts, other tabs and pre-existing browser profiles are outside this scope.
export function observeLogin(cdp, accept) {
  const bodies = new Set();
  let active = true;
  const inspect = (text) => {
    if (active) { for (const token of extractTokens(text)) accept(token); }
  };
  const location = (headers) =>
    Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "location")?.[1];
  const listener = (method, p) => {
    if (!active) return;
    if (method === "Network.requestWillBeSent" && isCallback(p.redirectResponse?.url)) {
      inspect(location(p.redirectResponse.headers));
    }
    if (
      method === "Network.responseReceived" && isCallback(p.response?.url) &&
      p.response.status >= 200 && p.response.status < 400
    ) {
      inspect(location(p.response.headers));
      if (
        ["Document", "XHR", "Fetch"].includes(p.type) && bodies.size < 64 &&
        Number(p.response.encodedDataLength ?? 0) <= MAX_BODY
      ) bodies.add(p.requestId);
    }
    if (method === "Network.loadingFailed") bodies.delete(p.requestId);
    if (
      method === "Network.loadingFinished" && bodies.delete(p.requestId) &&
      Number(p.encodedDataLength ?? 0) <= MAX_BODY
    ) {
      cdp.send("Network.getResponseBody", { requestId: p.requestId }).then((r) => {
        if (typeof r.body !== "string" || r.body.length > MAX_BODY * 2) return;
        inspect(r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body);
      }).catch(() => {});
    }
    if (["Page.frameRequestedNavigation", "Page.frameScheduledNavigation"].includes(method)) {
      try {
        const u = new URL(p.url);
        if (u.protocol === "teleai-cowork:" && u.hostname === "auth") inspect(p.url);
      } catch { /* not a deep link */ }
    }
  };
  cdp.listeners.add(listener);
  return () => {
    active = false;
    bodies.clear();
    cdp.listeners.delete(listener);
  };
}

async function browserPath(explicit) {
  const windows = platform() === "win32";
  const names = windows
    ? []
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  const candidates = explicit ? [resolve(explicit)] : [
    ...(windows
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
        .filter(Boolean)
        .flatMap(
          (root) => [
            join(root, "Google/Chrome/Application/chrome.exe"),
            join(root, "Microsoft/Edge/Application/msedge.exe"),
          ],
        )
      : []),
    ...(platform() === "darwin"
      ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      ]
      : []),
    ...String(process.env.PATH ?? "").split(delimiter).filter(Boolean).flatMap((root) =>
      names.map((name) => join(root, name))
    ),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        await access(candidate, windows ? constants.F_OK : constants.X_OK);
        return resolve(candidate);
      }
    } catch { /* next known executable */ }
  }
  throw new LoginError(
    "未找到 Chrome / Chromium / Edge，请安装浏览器后重试 / Install Chrome, Chromium or Edge and retry",
  );
}

export async function captureLogin(task, executable, signal) {
  const profile = await mkdtemp(join(tmpdir(), "cursor-byok-teleagent-login-"));
  await chmod(profile, 0o700);
  let child, cdp;
  let exited = false, failed = false;
  try {
    child = spawn(executable, [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-extensions",
      "about:blank",
    ], { stdio: "ignore" });
    child.on("exit", () => {
      exited = true;
    });
    child.on("error", () => {
      failed = true;
    });
    const started = Date.now();
    let port;
    while (!port) {
      if (signal?.aborted || exited || failed) {
        throw new LoginError("浏览器启动已取消或失败 / Browser launch canceled or failed");
      }
      if (Date.now() - started > 20000) {
        throw new LoginError("浏览器调试连接启动超时 / Browser startup timed out");
      }
      try {
        const text = await readFile(join(profile, "DevToolsActivePort"), "utf8");
        const value = Number(text.split("\n")[0]);
        if (Number.isInteger(value) && value > 0 && value < 65536) port = value;
      } catch { /* fresh private profile not ready yet */ }
      if (!port) await delay(100);
    }
    const reply = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!reply.ok) throw new LoginError("无法连接本次登录窗口 / Cannot connect to login window");
    const pages = await reply.json();
    const page = Array.isArray(pages)
      ? pages.find((p) => p.type === "page" && p.url === "about:blank")
      : undefined;
    if (!page) throw new LoginError("找不到本次登录窗口 / Login window not found");
    cdp = await CDP.open(page.webSocketDebuggerUrl, port);
    return await capturePageLogin(
      cdp,
      task,
      signal,
      () => exited || failed || cdp.socket.readyState !== 1,
    );
  } finally {
    // Browser.close exits this newly spawned instance and its child processes
    // on Windows as well as POSIX. Process signals are a bounded fallback.
    if (cdp?.socket.readyState === 1) await cdp.send("Browser.close", {}, 750).catch(() => {});
    cdp?.close();
    if (child?.pid && !exited) {
      child.kill();
      for (let i = 0; i < 20 && !exited; i++) await delay(100);
      if (!exited) {
        child.kill("SIGKILL");
        await delay(200);
      }
    }
    const cleanupPath = resolve(profile);
    if (
      dirname(cleanupPath) !== resolve(tmpdir()) ||
      !basename(cleanupPath).startsWith("cursor-byok-teleagent-login-")
    ) {
      throw new LoginError(
        "登录临时目录不在预期位置，已停止清理 / Refused to remove an unexpected profile path",
      );
    }
    await rm(cleanupPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
      () => {
        console.error("请手动清理临时登录目录 / Remove the temporary login folder: " + profile);
      },
    );
  }
}

// Shared page-level callback observation for the isolated login window and tests.
export async function capturePageLogin(cdp, task, signal, closed = () => false) {
  validateTask(task);
  const tokens = new Set(), stop = observeLogin(cdp, (token) => tokens.add(token));
  try {
    await cdp.send("Network.enable", {
      maxTotalBufferSize: 4 * MAX_BODY,
      maxResourceBufferSize: MAX_BODY,
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: task.url });

    while (!tokens.size) {
      if (signal?.aborted || closed()) {
        throw new LoginError("登录已取消或窗口已关闭 / Login canceled or window closed");
      }
      if (Date.now() >= task.expires_at * 1000) {
        throw new LoginError("登录任务已过期，请重新生成 / Login task expired");
      }
      await delay(150);
    }
    await delay(150);
    if (signal?.aborted || closed() || Date.now() >= task.expires_at * 1000) {
      throw new LoginError("登录已取消或过期 / Login canceled or expired");
    }
    if (tokens.size !== 1) {
      throw new LoginError("登录结果存在多个身份，请重新登录 / Multiple login identities");
    }
    return [...tokens][0];
  } finally {
    stop();
  }
}

if (import.meta.main) {
  try {
    const task = validateTask(JSON.parse(await new Response(Deno.stdin.readable).text()));
    const { metadata } = await discoverClientMetadata();
    const executable = await browserPath();
    console.log("CURSOR_BYOK_READY");
    const controller = new AbortController();
    const cancelPath = join(process.env.CURSOR_BYOK_LOGIN_DIR, "cancel");
    const timer = setInterval(async () => {
      try {
        await stat(cancelPath);
        controller.abort();
      } catch {}
      try {
        process.kill(Number(process.env.CURSOR_BYOK_PARENT_PID), 0);
      } catch {
        controller.abort();
      }
    }, 150);
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(Math.max(1, task.expires_at * 1000 - Date.now())),
      ]);
      const token = await captureLogin(task, executable, signal);
      console.log("CURSOR_BYOK_RESULT:" + JSON.stringify({ ...metadata, token, renewable: true }));
    } finally {
      clearInterval(timer);
    }
  } catch (error) {
    console.log(
      "CURSOR_BYOK_ERROR:" +
        (error instanceof LoginError ? error.message : "TeleAgent login failed"),
    );
    Deno.exitCode = 1;
  }
}
