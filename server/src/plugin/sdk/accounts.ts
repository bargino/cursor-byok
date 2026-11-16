/** Shared account-boundary helpers. Provider protocols and identities stay in each plugin. */
import type { JsonValue, NetworkRequestInit, PluginContext } from "./plugin.ts";
import type { ProviderResult } from "./provider.ts";
import type {
  ResourceDraft,
  ResourceImportFile,
  ResourceImportResult,
  ResourcePatch,
  ResourceSnapshot,
} from "./resource.ts";
export function object(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
}
export function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
export function number(v: unknown): number | null {
  return (typeof v === "number" || typeof v === "string" && v.trim()) && Number.isFinite(Number(v))
    ? Number(v)
    : null;
}
export function epoch(v: unknown): number | null {
  const n = number(v);
  if (n !== null) return n > 1e11 ? n : n * 1000;
  const at = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(at) ? at : null;
}
export function required(v: unknown, name: string): string {
  const s = text(v);
  if (!s || s.length > 32768 || /[\r\n\0]/.test(s)) throw new Error(`Missing or invalid ${name}`);
  return s;
}
export function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unbase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export async function fingerprint(value: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(b), (v) => v.toString(16).padStart(2, "0")).join("");
}
export function jwt(token: string): Record<string, unknown> {
  try {
    const s = token.replace(/^[^.:]+:/, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return object(
      JSON.parse(new TextDecoder().decode(unbase64(s.padEnd(Math.ceil(s.length / 4) * 4, "=")))),
    );
  } catch {
    return {};
  }
}
export class AccountError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
export async function json(
  context: PluginContext,
  url: string,
  init: NetworkRequestInit = {},
): Promise<Record<string, unknown>> {
  const r = await context.network.fetch(url, init);
  if (r.status < 200 || r.status >= 300) {
    throw new AccountError(r.status, `Upstream request failed (HTTP ${r.status})`);
  }
  let v;
  try {
    v = JSON.parse(r.body);
  } catch {
    throw new AccountError(502, "Upstream returned invalid JSON");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new AccountError(502, "Upstream returned an invalid object");
  }
  return v;
}
export function failure(
  error: unknown,
  data: unknown,
): Exclude<ProviderResult, { status: "completed" }> {
  const message = error instanceof Error ? error.message : String(error);
  const patch = { privateData: data as JsonValue };
  if (error instanceof AccountError) {
    if (error.status === 401) {
      return {
        status: "resource-error",
        message,
        patch: { ...patch, state: { status: "invalid", message } },
      };
    }
    if ([402, 403, 429].includes(error.status)) {
      return {
        status: "resource-error",
        message,
        patch: {
          ...patch,
          state: {
            status: "cooling",
            retryAtMs: Date.now() + (error.status === 402 ? 300_000 : 60_000),
            message,
          },
        },
      };
    }
  }
  return { status: "request-error", message, patch };
}
export function refreshFailure(
  error: unknown,
  resource: ResourceSnapshot,
  data: unknown,
): ResourcePatch {
  const result = failure(error, data);
  if (result.status !== "request-error") return result.patch;
  if (JSON.stringify(resource.privateData) === JSON.stringify(data)) throw error;
  return {
    ...result.patch,
    state: {
      status: "cooling",
      retryAtMs: Date.now() + 60_000,
      message: "Credentials refreshed, but quota lookup failed; retry refresh",
    },
  };
}
export async function importAccounts(
  files: ResourceImportFile[],
  parse: (value: unknown) => Promise<ResourceDraft>,
): Promise<ResourceImportResult> {
  const resources: ResourceDraft[] = [], warnings: string[] = [];
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(file.content);
    } catch {
      warnings.push(`${file.name}: invalid JSON`);
      continue;
    }
    const values = Array.isArray(raw)
      ? raw
      : Array.isArray(object(raw).accounts)
      ? object(raw).accounts as unknown[]
      : [raw];
    for (const value of values) {
      try {
        resources.push(await parse(value));
      } catch (e) {
        warnings.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (!resources.length) throw new Error(warnings.join("; ") || "No valid credentials found");
  return { resources, warnings };
}
