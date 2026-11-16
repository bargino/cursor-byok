import { Buffer } from "node:buffer";
import { join } from "node:path";
import { assert, eq, rejects } from "../../../plugins/test_support.ts";
import {
  capturePageLogin,
  clientMetadata,
  discoveryLocations,
  extractTokens,
  gatewayKeyFromSource,
  installedMetadata,
  isCallback,
  LOGIN_URL,
  validateTask,
} from "./teleagent.mjs";
const token = "eyJhbGciOiJIUzI1NiJ9." +
  Buffer.from(JSON.stringify({ accountId: "test", exp: 2000000000 })).toString("base64url") +
  ".fixture";
function task() {
  return {
    version: 1,
    provider: "teleagent",
    challenge: "a".repeat(43),
    url: LOGIN_URL,
    expires_at: Math.floor(Date.now() / 1000) + 600,
  };
}
Deno.test("native login observes only the exact official callback and complete account tokens", () => {
  eq(isCallback("https://agent.teleai.com.cn/superCowork/sapi/cowork/auth?code=x"), true);
  eq(
    isCallback("https://agent.teleai.com.cn.attacker.example/superCowork/sapi/cowork/auth"),
    false,
  );
  eq(extractTokens(JSON.stringify({ token })), [token]);
  eq(extractTokens('token="not-a-jwt"'), []);
});
Deno.test("native login rejects unrelated tasks and never fabricates missing device metadata", async () => {
  await rejects(() => validateTask({ ...task(), url: "https://example.com/login" }));
  await rejects(() => clientMetadata({ api_key: "sk-fixture" }));
  const locations = discoveryLocations({ home: "C:/TestUser", os: "win32", env: {} });
  assert(locations.devices.every((p: string) => p.endsWith("device-meta.json")));
});
Deno.test("native metadata accepts only the signed NewApi model gateway", () => {
  const source =
    'const base="https://agent.teleai.com.cn/superCowork/sapi";const providers={NewApi:{options:{useSuperAgentAuth:true,apiKey:"sk-model_fixture"}},Image:{options:{apiKey:"sk-image_fixture"}}};';
  eq(gatewayKeyFromSource(source), "sk-model_fixture");
  eq(
    gatewayKeyFromSource(source.replace("useSuperAgentAuth:true", "useSuperAgentAuth:false")),
    undefined,
  );
});
Deno.test("native metadata reads bounded ASAR resources without executing application code", async () => {
  const root = await Deno.makeTempDir();
  const archive = join(root, "app.asar");
  try {
    const sources = {
      "package.json": JSON.stringify({
        name: "TeleAgent",
        version: "3.0.0-rc.4",
        main: "dist-electron/main.js",
      }),
      "dist-electron/main.js":
        'throw new Error("must never execute"); const base="https://agent.teleai.com.cn/superCowork/sapi"; const providers={NewApi:{options:{useSuperAgentAuth:true,apiKey:"sk-fixture"}}};',
    };
    let offset = 0;
    const tree = { files: {} as Record<string, unknown> }, parts: Uint8Array[] = [];
    for (const [name, source] of Object.entries(sources)) {
      const bytes = new TextEncoder().encode(source),
        entry = { size: bytes.length, offset: String(offset) };
      if (name.includes("/")) tree.files["dist-electron"] = { files: { "main.js": entry } };
      else tree.files[name] = entry;
      parts.push(bytes);
      offset += bytes.length;
    }
    const header = new TextEncoder().encode(JSON.stringify(tree)),
      headerSize = Math.ceil((header.length + 8) / 4) * 4;
    const all = new Uint8Array(8 + headerSize + offset), view = new DataView(all.buffer);
    view.setUint32(0, 4, true);
    view.setUint32(4, headerSize, true);
    view.setUint32(8, headerSize - 4, true);
    view.setUint32(12, header.length, true);
    all.set(header, 16);
    offset = 8 + headerSize;
    for (const p of parts) {
      all.set(p, offset);
      offset += p.length;
    }
    await Deno.writeFile(archive, all);
    eq(await installedMetadata(archive), { api_key: "sk-fixture", app_version: "3.0.0-rc.4" });
  } finally {
    await Deno.remove(archive).catch(() => {});
    await Deno.remove(root);
  }
});
Deno.test("native browser callback capture returns only the new window's candidate token", async () => {
  const listeners = new Set<(method: string, value: unknown) => void>();
  const cdp = {
    listeners,
    async send(method: string) {
      if (method === "Page.navigate") {
        setTimeout(() => {
          for (const listener of listeners) {
            listener("Page.frameRequestedNavigation", {
              url: "teleai-cowork://auth?token=" + encodeURIComponent(token),
            });
          }
        }, 5);
      }
      return {};
    },
  };
  eq(await capturePageLogin(cdp, task(), new AbortController().signal), token);
  eq(listeners.size, 0);
});
Deno.test("native browser cancellation releases callback listeners without an account result", async () => {
  const controller = new AbortController();
  const cdp = {
    listeners: new Set(),
    async send() {
      return {};
    },
  };
  controller.abort();
  await rejects(() => capturePageLogin(cdp, task(), controller.signal));
  eq(cdp.listeners.size, 0);
});
