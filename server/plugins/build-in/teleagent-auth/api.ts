import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type { ResourceSnapshot } from "cursor-byok:resource";
import { createHash, createHmac } from "node:crypto";
import { AccountError, epoch, json, jwt, object, required, text } from "cursor-byok:accounts";
export const BASE = "https://agent.teleai.com.cn";
export const CHAT = "/superCowork/sapi/api/v1/chat/completions";
export const RESOURCE = "teleagent-account";
export const LOGIN =
  "https://www.teleai.com.cn/teleai-api/upms/public/auth/authorize?client_id=Z2veLLEHhZfq3hb5hWIwqJuPajIuasYi&redirect_uri=https%3A%2F%2Fagent.teleai.com.cn%2FsuperCowork%2Fsapi%2Fcowork%2Fauth";
export type Data = {
  token: string;
  api_key: string;
  device_id: string;
  install_id: string;
  app_version: string;
  account_id: string;
  name: string;
  expires_at: number;
  renewable: boolean;
  points?: number;
};
function id(v: unknown): string {
  if (typeof v === "number" && !Number.isSafeInteger(v)) {
    throw new Error("TeleAgent account ID exceeds safe integer precision");
  }
  return typeof v === "number" ? String(v) : text(v);
}
export function normalize(raw: unknown, renewable = false): Data {
  const outer = object(raw),
    v = outer.auth ? object(outer.auth) : outer,
    token = required(v.token ?? v.access_token ?? v.accessToken, "TeleAgent token"),
    claims = jwt(token);
  const account = id(claims.accountId ?? claims.account_id ?? claims.uid),
    declared = id(v.account_id ?? v.accountId ?? v.uid);
  if (!account || declared && declared !== account) {
    throw new Error("TeleAgent token identity does not match account_id");
  }
  const expiry = epoch(claims.exp), provided = epoch(v.expires_at);
  if (expiry === null) throw new Error("TeleAgent token needs its actual JWT expiry");
  const apiKey = required(v.api_key ?? v.apiKey ?? v.gateway_key, "TeleAgent gateway API key");
  if (!apiKey.startsWith("sk-")) throw new Error("TeleAgent api_key must start with sk-");
  const device = required(v.device_id ?? v.deviceId, "device_id"),
    install = required(v.install_id ?? v.installId, "install_id"),
    version = required(v.app_version ?? v.appVersion, "app_version");
  if (
    !/^[A-Za-z0-9_.:-]{1,256}$/.test(device) || !/^[A-Za-z0-9_.:-]{1,256}$/.test(install) ||
    !/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(version)
  ) throw new Error("Invalid TeleAgent client device metadata");
  return {
    token,
    api_key: apiKey,
    account_id: account,
    name: text(v.name ?? claims.accountName ?? claims.nickname) || account,
    device_id: device,
    install_id: install,
    app_version: version,
    expires_at: provided === null ? expiry : Math.min(expiry, provided),
    renewable,
  };
}
export function data(r: ResourceSnapshot): Data {
  if (r.type !== RESOURCE) throw new Error("TeleAgent account pool mismatch");
  return object(r.privateData) as unknown as Data;
}
export function headers(d: Data): Record<string, string> {
  return {
    "x-token": d.token,
    "x-route-target": "ops-gateway",
    "x-app-version": d.app_version,
    "x-superagent-device-id": d.device_id,
    "x-superagent-install-id": d.install_id,
    accept: "application/json",
  };
}
export function signature(
  d: Data,
  method: string,
  path: string,
  ts: string,
  nonce: string,
  body: string,
): string {
  const raw = d.token.includes(":") ? d.token.slice(d.token.indexOf(":") + 1) : d.token,
    secret = raw.split(".")[2];
  if (!secret) throw new Error("Invalid TeleAgent JWT signature");
  const hmac = (key: string, value: string) =>
    createHmac("sha256", key).update(value).digest("hex");
  const key = hmac(secret, ["superagent-auth-v1", d.token, d.install_id, ts, nonce].join("/"));
  return hmac(
    key,
    [
      "superagent-auth-v1",
      method,
      path,
      ts,
      nonce,
      d.app_version,
      createHash("sha256").update(body).digest("hex"),
    ].join("\n"),
  );
}
export function unwrap(r: Record<string, unknown>) {
  const code = String(r.code ?? r.responseCode ?? 0);
  if (!["0", "200"].includes(code) || r.success === false) {
    const status =
      ["4001", "40108", "40109", "40112", "40113", "40114", "40115", "40116"].includes(code)
        ? 401
        : code === "429"
        ? 429
        : /^(40101|40103|40104|40105|40301)$/.test(code)
        ? 403
        : 502;
    throw new AccountError(status, `TeleAgent rejected request (code ${code})`);
  }
  return object(r.data ?? r);
}
export async function verify(d: Data, context: PluginContext): Promise<Data> {
  const user = unwrap(
    await json(context, BASE + "/superCowork/sapi/cowork/user_info", { headers: headers(d) }),
  );
  if (id(user.accountId ?? user.account_id ?? user.uid) !== d.account_id) {
    throw new AccountError(401, "TeleAgent user identity does not match credentials");
  }
  return { ...d, name: text(user.accountName ?? user.nickname ?? user.name) || d.name };
}
export async function fresh(d: Data, context: PluginContext): Promise<Data> {
  if (d.expires_at > Date.now() + 300_000) return d;
  if (!d.renewable) throw new AccountError(401, "TeleAgent authorization expired; sign in again");
  const result = unwrap(
    await json(context, BASE + "/superCowork/sapi/cowork/auth/token-refresh", {
      method: "POST",
      headers: {
        ...headers(d),
        "content-type": "application/json",
        "x-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-nonce": crypto.randomUUID(),
        "x-os-type": Deno.build.os === "windows"
          ? "Windows"
          : Deno.build.os === "darwin"
          ? "macOS"
          : "Linux",
      },
    }),
  );
  const next = normalize({
    ...d,
    token: required(result.accessToken, "TeleAgent refreshed token"),
    expires_at: epoch(result.absoluteExpiresAt) ?? Date.now() + Number(result.expiresIn) * 1000,
  }, true);
  if (next.account_id !== d.account_id) {
    throw new AccountError(401, "TeleAgent refresh changed identity");
  }
  return next;
}
export function draft(d: Data) {
  return {
    key: `teleagent:${d.account_id}:${d.device_id}:${d.install_id}`,
    privateData: d as unknown as JsonValue,
  };
}
