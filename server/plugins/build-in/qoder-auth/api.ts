import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type { ResourceSnapshot } from "cursor-byok:resource";
import { AccountError, epoch, json, object, required, text } from "cursor-byok:accounts";
export { AccountError, object, text } from "cursor-byok:accounts";
export type Scope = "cn" | "global";
export const VERSION = "1.1.81";
export const regions = {
  cn: {
    web: "https://qoder.com.cn",
    api: "https://openapi.qoder.com.cn",
    inference: "https://gateway.qoder.com.cn",
    client: "1c5e33e1-364d-4ce6-b02c-acaa81274a5c",
  },
  global: {
    web: "https://qoder.com",
    api: "https://openapi.qoder.sh",
    inference: "https://api3.qoder.sh",
    client: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
  },
};
export type Data = {
  scope: Scope;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  uid: string;
  name: string;
  machine_id: string;
  user_type: string;
  organization_id: string;
  organization_name: string;
  organization_tags: string[];
  quota?: Record<string, unknown>;
};
export const resourceType = (scope: Scope) => `qoder-${scope}-account`;
export function normalize(raw: unknown, scope: Scope): Data {
  const v = object(raw);
  if (v.scope && v.scope !== scope) {
    throw new Error("Qoder credential region does not match this account pool");
  }
  const expiry = epoch(v.expires_at);
  if (expiry === null || expiry <= Date.now()) {
    throw new Error("Qoder credentials need their actual future expires_at");
  }
  return {
    scope,
    access_token: required(v.access_token, "access_token"),
    refresh_token: text(v.refresh_token),
    expires_at: expiry,
    uid: required(v.uid, "uid"),
    name: text(v.name),
    machine_id: required(v.machine_id, "machine_id"),
    user_type: text(v.user_type),
    organization_id: text(v.organization_id),
    organization_name: text(v.organization_name),
    organization_tags: Array.isArray(v.organization_tags)
      ? v.organization_tags.filter((v): v is string => typeof v === "string")
      : [],
    ...(v.quota ? { quota: object(v.quota) } : {}),
  };
}
export function data(resource: ResourceSnapshot): Data {
  const v = object(resource.privateData);
  const scope = v.scope === "global" ? "global" : "cn";
  if (resource.type !== resourceType(scope)) throw new Error("Qoder account region mismatch");
  return { ...v, scope } as Data;
}
export async function auth(
  context: PluginContext,
  scope: Scope,
  path: string,
  token = "",
  body?: unknown,
) {
  const network = path.startsWith("/api/v1/deviceToken/poll")
    ? {
      ...context,
      network: {
        ...context.network,
        async fetch(url: string, init: import("cursor-byok:plugin").NetworkRequestInit = {}) {
          const r = await context.network.fetch(url, init);
          if (r.status === 202) throw new AccountError(202, "Qoder authorization pending");
          return r;
        },
      },
    }
    : context;
  return await json(network, regions[scope].api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": `qoder/${VERSION}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export function applyToken(before: Partial<Data>, response: Record<string, unknown>): Data {
  const token = required(
    response.token ?? response.device_token ?? response.access_token,
    "Qoder access token",
  );
  // Qoder expires_in is milliseconds, unlike the OAuth endpoints in other plugins.
  const expires = epoch(response.expires_at) ??
    (Number(response.expires_in) > 0 && Number(response.expires_in) <= 366 * 86400_000
      ? Date.now() + Number(response.expires_in)
      : 0);
  if (expires <= Date.now()) {
    throw new AccountError(502, "Qoder token response has no valid expiry");
  }
  return {
    ...before,
    access_token: token,
    refresh_token: text(response.refresh_token) || before.refresh_token || "",
    expires_at: expires,
  } as Data;
}
export async function profile(value: Data, context: PluginContext): Promise<Data> {
  const v = await auth(context, value.scope, "/api/v1/userinfo", value.access_token);
  const uid = required(v.id ?? v.uid ?? v.user_id, "Qoder user ID");
  if (value.uid && uid !== value.uid) {
    throw new AccountError(401, "Qoder identity does not match imported credentials");
  }
  return {
    ...value,
    uid,
    name: text(v.name ?? v.nickname) || uid,
    user_type: text(v.user_type),
    organization_id: text(v.organization_id ?? v.organizationId),
    organization_name: text(v.organization_name ?? v.organizationName),
    organization_tags: Array.isArray(v.organization_tags) ? v.organization_tags.map(String) : [],
  };
}
export async function fresh(value: Data, context: PluginContext): Promise<Data> {
  if (value.expires_at > Date.now() + 60_000) return value;
  if (!value.refresh_token) {
    throw new AccountError(401, "Qoder authorization expired; sign in again");
  }
  const path = value.refresh_token.startsWith("jrt-")
    ? "/api/v1/jobToken/refresh"
    : "/api/v1/deviceToken/refresh";
  return applyToken(
    value,
    await auth(context, value.scope, path, "", { refresh_token: value.refresh_token }),
  );
}
export function draft(value: Data) {
  return {
    key: `qoder:${value.scope}:${value.uid}:${value.organization_id}`,
    privateData: value as unknown as JsonValue,
  };
}
