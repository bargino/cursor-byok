import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type { ResourceSnapshot } from "cursor-byok:resource";

export type Realm = "cn" | "global";
export type CreditPackage = {
  name: string;
  remaining: number;
  total: number;
  expiresAtMs: number | null;
};
export type Credits = {
  remaining: number | null;
  total: number | null;
  packages: CreditPackage[];
  updatedAtMs: number;
};
export type AccountData = {
  realm: Realm;
  uid: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number | null;
  domain: string | null;
  enterpriseId: string | null;
  displayName: string;
  deviceToken: string | null;
  credits: Credits | null;
};

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}
export function resourceType(realm: Realm): string {
  return `workbuddy-${realm}-account`;
}
export function chatBase(account: Realm | AccountData): string {
  const realm = typeof account === "string" ? account : account.realm;
  if (realm === "cn") return "https://www.workbuddy.cn";
  const domain = typeof account === "string" ? "" : (account.domain ?? "").toLowerCase();
  return /^(?:[a-z0-9-]+\.)*workbuddy\.ai$/.test(domain)
    ? "https://www.workbuddy.ai"
    : "https://www.codebuddy.ai";
}
export function authBase(realm: Realm): string {
  return realm === "cn" ? "https://copilot.tencent.com" : "https://www.codebuddy.ai";
}
export const billingBase = chatBase;
export function version(realm: Realm): string {
  return realm === "cn" ? "5.11.3" : "5.9.4";
}
export function userAgent(realm: Realm): string {
  const brand = realm === "cn" ? "WorkBuddy" : "workbuddy-ai";
  return `${brand}/${version(realm)} ${brand}/${version(realm)} CLI/${
    realm === "cn" ? "2.176.0" : "2.165.0"
  }`;
}
export function commonHeaders(realm: Realm): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "x-product": "SaaS",
    "x-request-id": crypto.randomUUID().replaceAll("-", ""),
    "user-agent": userAgent(realm),
  };
}
export function accountData(resource: ResourceSnapshot): AccountData {
  const data = object(resource.privateData);
  const accessToken = text(data?.accessToken);
  const uid = text(data?.uid);
  if (!accessToken || !uid) throw new Error("WorkBuddy account requires an access token and UID");
  const realm = data?.realm === "global" ? "global" : "cn";
  if (resource.type !== resourceType(realm)) {
    throw new Error("WorkBuddy account region does not match its pool");
  }
  return {
    realm,
    uid,
    accessToken,
    refreshToken: text(data?.refreshToken),
    expiresAtMs: number(data?.expiresAtMs),
    domain: text(data?.domain),
    enterpriseId: text(data?.enterpriseId),
    displayName: text(data?.displayName) ?? uid,
    deviceToken: text(data?.deviceToken),
    credits: (data?.credits ?? null) as Credits | null,
  };
}
export function accountHeaders(data: AccountData): Record<string, string> {
  return {
    ...commonHeaders(data.realm),
    authorization: `Bearer ${data.accessToken}`,
    "x-user-id": data.uid,
    "x-domain": data.domain ?? new URL(chatBase(data)).hostname,
    ...(data.enterpriseId
      ? { "x-enterprise-id": data.enterpriseId, "x-tenant-id": data.enterpriseId }
      : {}),
    ...(data.deviceToken ? { "x-device-token": data.deviceToken } : {}),
  };
}
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: number | null, message: string) {
    super(`WorkBuddy HTTP ${status}${code === null ? "" : ` code ${code}`}: ${message}`);
  }
}
export function envelope(status: number, body: string): unknown {
  let value: Record<string, unknown> | null;
  try {
    value = object(JSON.parse(body));
  } catch {
    throw new ApiError(status, null, "invalid JSON response");
  }
  const code = number(value?.code);
  if (status < 200 || status >= 300 || code === null || code !== 0) {
    throw new ApiError(status, code, text(value?.msg) ?? text(value?.message) ?? "request failed");
  }
  return value?.data;
}
export async function request(
  context: PluginContext,
  url: string,
  headers: Record<string, string>,
  method = "GET",
  body?: JsonValue,
): Promise<unknown> {
  const response = await context.network.fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return envelope(response.status, response.body);
}
export async function refreshToken(
  data: AccountData,
  context: PluginContext,
): Promise<AccountData> {
  if (!data.refreshToken) throw new ApiError(401, null, "authorization expired; sign in again");
  const token = object(
    await request(context, `${chatBase(data)}/v2/plugin/auth/token/refresh`, {
      ...accountHeaders(data),
      "x-refresh-token": data.refreshToken,
      "x-auth-refresh-source": "plugin",
    }, "POST"),
  );
  const accessToken = text(token?.accessToken);
  if (!accessToken) throw new ApiError(401, null, "token refresh did not return an access token");
  const expiresIn = number(token?.expiresIn);
  return {
    ...data,
    accessToken,
    refreshToken: text(token?.refreshToken) ?? data.refreshToken,
    domain: text(token?.domain) ?? data.domain,
    expiresAtMs: expiresIn !== null && expiresIn > 0
      ? Date.now() + expiresIn * 1000
      : data.expiresAtMs,
  };
}
export async function freshAccount(
  data: AccountData,
  context: PluginContext,
): Promise<AccountData> {
  return data.expiresAtMs !== null && Date.now() >= data.expiresAtMs - 60_000
    ? await refreshToken(data, context)
    : data;
}
export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
