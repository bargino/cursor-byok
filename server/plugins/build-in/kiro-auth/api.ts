import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type { ResourceSnapshot } from "cursor-byok:resource";
import {
  AccountError,
  epoch,
  fingerprint,
  json,
  object,
  required,
  text,
} from "cursor-byok:accounts";
export type Region = "us-east-1" | "eu-central-1";
export const regions: Region[] = ["us-east-1", "eu-central-1"];
export type Data = {
  region: Region;
  auth_region: Region;
  auth_method: "idc" | "social" | "api_key";
  access_token: string;
  refresh_token: string;
  api_key: string;
  expires_at: number | null;
  profile_arn: string;
  client_id: string;
  client_secret: string;
  client_secret_expires_at: number | null;
  quota?: Record<string, unknown>;
};
export const resourceType = (region: Region) => `kiro-${region}-account`;
export const runtime = (region: Region) => `https://q.${region}.amazonaws.com`;
export const oidc = (region: Region) => `https://oidc.${region}.amazonaws.com`;
export function normalize(raw: unknown, pool: Region): Data {
  const v = object(raw),
    arn = text(v.profile_arn ?? v.profileArn),
    declared = text(v.region ?? v.scope);
  const match = arn.match(/^arn:aws:codewhisperer:([a-z0-9-]+):\d+:profile\/[A-Za-z0-9_-]+$/);
  if (arn && !match) throw new Error("Invalid Kiro profile ARN");
  const region = declared || match?.[1] || pool;
  if (region !== pool || match && match[1] !== region) {
    throw new Error("Kiro credential region does not match this pool");
  }
  const authRegion = text(v.auth_region ?? v.authRegion) || region;
  if (!regions.includes(authRegion as Region)) {
    throw new Error("Unsupported Kiro authentication region");
  }
  const key = text(v.api_key ?? v.kiroApiKey ?? v.kiro_api_key),
    access = text(v.access_token ?? v.accessToken),
    refresh = text(v.refresh_token ?? v.refreshToken);
  const client = text(v.client_id ?? v.clientId), secret = text(v.client_secret ?? v.clientSecret);
  const method = key
    ? "api_key"
    : text(v.auth_method ?? v.authMethod) || (client ? "idc" : "social");
  const expiry = epoch(v.expires_at ?? v.expiresAt);
  if (key) {
    if (!key.startsWith("ksk_") || access || refresh) {
      throw new Error("Kiro API keys cannot be mixed with OAuth tokens");
    }
  } else if (
    !access || expiry === null || !["idc", "social"].includes(method) ||
    method === "social" && !arn || method === "idc" && (!client || refresh && !secret)
  ) throw new Error("Incomplete Kiro OAuth credentials");
  for (const s of [key, access, refresh, client, secret]) if (s) required(s, "Kiro credential");
  return {
    region: pool,
    auth_region: authRegion as Region,
    auth_method: method as Data["auth_method"],
    access_token: access,
    refresh_token: refresh,
    api_key: key,
    expires_at: key ? null : expiry,
    profile_arn: arn,
    client_id: client,
    client_secret: secret,
    client_secret_expires_at: epoch(v.client_secret_expires_at ?? v.clientSecretExpiresAt),
    ...(v.quota ? { quota: object(v.quota) } : {}),
  };
}
export function data(r: ResourceSnapshot): Data {
  const v = object(r.privateData) as unknown as Data;
  if (!regions.includes(v.region) || r.type !== resourceType(v.region)) {
    throw new Error("Kiro account pool mismatch");
  }
  return v;
}
export function headers(d?: Data, target = ""): Record<string, string> {
  return {
    "content-type": target ? "application/x-amz-json-1.0" : "application/json",
    "user-agent": "cursor-byok/kiro",
    "x-amzn-codewhisperer-optout": "true",
    ...(target ? { "x-amz-target": target } : {}),
    ...(d
      ? {
        authorization: `Bearer ${d.api_key || d.access_token}`,
        ...(d.api_key ? { TokenType: "API_KEY" } : {}),
      }
      : {}),
  };
}
export function applyToken(before: Partial<Data>, o: Record<string, unknown>): Data {
  const token = required(o.accessToken, "Kiro accessToken"); // idToken is identity, not the application bearer.
  const seconds = Number(o.expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 366 * 86400) {
    throw new AccountError(502, "Invalid Kiro token expiry");
  }
  return {
    ...before,
    access_token: token,
    refresh_token: text(o.refreshToken) || before.refresh_token || "",
    expires_at: Date.now() + seconds * 1000,
    profile_arn: text(o.profileArn) || before.profile_arn || "",
  } as Data;
}
export async function fresh(d: Data, context: PluginContext): Promise<Data> {
  if (d.api_key || d.expires_at !== null && d.expires_at > Date.now() + 60_000) return d;
  if (
    !d.refresh_token ||
    d.auth_method === "idc" && d.client_secret_expires_at !== null &&
      d.client_secret_expires_at <= Date.now()
  ) throw new AccountError(401, "Kiro authorization expired; sign in again");
  const body = d.auth_method === "idc"
    ? {
      clientId: d.client_id,
      clientSecret: d.client_secret,
      refreshToken: d.refresh_token,
      grantType: "refresh_token",
    }
    : { refreshToken: d.refresh_token };
  const url = d.auth_method === "idc"
    ? oidc(d.auth_region) + "/token"
    : `https://prod.${d.auth_region}.auth.desktop.kiro.dev/refreshToken`;
  return applyToken(
    d,
    await json(context, url, { method: "POST", headers: headers(), body: JSON.stringify(body) }),
  );
}
export async function draft(d: Data) {
  const identity = d.api_key || d.profile_arn || d.client_id;
  return {
    key: `kiro:${d.region}:${await fingerprint(d.auth_method + ":" + identity)}`,
    privateData: d as unknown as JsonValue,
  };
}
export async function models(d: Data, context: PluginContext) {
  const base = d.api_key || d.region === "eu-central-1"
    ? runtime(d.region)
    : `https://codewhisperer.${d.region}.amazonaws.com`;
  const out = new Map();
  let next = "";
  const seen = new Set();
  for (let page = 0; page < 20; page++) {
    const r = await json(context, base + "/", {
      method: "POST",
      headers: headers(d, "AmazonCodeWhispererService.ListAvailableModels"),
      body: JSON.stringify({
        origin: "AI_EDITOR",
        ...(d.profile_arn ? { profileArn: d.profile_arn } : {}),
        ...(next ? { nextToken: next } : {}),
      }),
    });
    if (!Array.isArray(r.models)) throw new Error("Kiro did not return a model catalog");
    for (const raw of r.models) {
      const m = object(raw), id = text(m.modelId), limits = object(m.tokenLimits);
      if (!id || /[\/\r\n]/.test(id)) continue;
      out.set(id, {
        id,
        displayName: text(m.modelName) || id,
        ...(Number(limits.maxOutputTokens) > 0
          ? { maxOutputTokens: Number(limits.maxOutputTokens) }
          : {}),
        privateData: { reasoningEfforts: [] },
      });
    }
    next = text(r.nextToken);
    if (!next) return [...out.values()];
    if (seen.has(next)) throw new Error("Kiro catalog pagination repeated");
    seen.add(next);
  }
  throw new Error("Kiro catalog exceeded 20 pages");
}
