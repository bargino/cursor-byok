import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type { ModelSnapshot } from "cursor-byok:model";
import type {
  LlmRequest,
  ProviderInvokeInput,
  ProviderOutput,
  ProviderResult,
  ProviderSupport,
} from "cursor-byok:provider";
import { buildChatBody, HttpError, streamOpenAiChat } from "cursor-byok:protocol/openai-chat";
import {
  type AccountData,
  accountData,
  accountHeaders,
  ApiError,
  chatBase,
  digest,
  freshAccount,
  number,
  object,
  type Realm,
  refreshToken,
  resourceType,
  text,
  version,
} from "./api.ts";
import { workbuddyModels } from "./models.ts";

export function prepareBody(
  request: LlmRequest,
  model: ModelSnapshot,
  data: AccountData,
): Record<string, JsonValue> {
  const body = buildChatBody({ url: "", model: model.id, request });
  delete body.max_completion_tokens;
  delete body.service_tier;
  if (request.maxOutputTokens !== null) {
    body.max_tokens = model.id.startsWith("gpt-")
      ? Math.max(16, request.maxOutputTokens)
      : request.maxOutputTokens;
  }
  const metadata = object(model.privateData);
  const efforts = Array.isArray(metadata?.reasoningEfforts)
    ? metadata.reasoningEfforts.filter((v): v is string => typeof v === "string")
    : [];
  const requested = request.reasoning.effort;
  const effort = requested && efforts.includes(requested)
    ? requested
    : text(metadata?.defaultEffort) ?? efforts.at(-1);
  if (metadata?.supportsReasoning === true && request.reasoning.enabled && effort) {
    body.reasoning_effort = effort;
  } else delete body.reasoning_effort;
  if (/^deepseek/i.test(model.id)) {
    const enabled = metadata?.onlyReasoning === true || request.reasoning.enabled;
    body.thinking = { type: enabled ? "enabled" : "disabled" };
    for (const raw of Array.isArray(body.messages) ? body.messages : []) {
      const message = object(raw);
      if (message?.role === "assistant" && enabled) {
        const reasoning = text(message.reasoning_content) ?? " ";
        message.reasoning_content = reasoning;
        message.reasoning = reasoning;
      }
    }
  }
  // WorkBuddy expects tool_choice as a string. Canonical tool history remains untouched.
  if (request.tools.length) body.tool_choice = "auto";
  return body;
}

export async function chatHeaders(
  data: AccountData,
  cacheKey: string | null,
): Promise<Record<string, string>> {
  const requestId = crypto.randomUUID().replaceAll("-", "");
  const conversationId = cacheKey
    ? (await digest(`${data.realm}:${data.uid}:${data.enterpriseId ?? ""}:${cacheKey}`)).slice(
      0,
      32,
    )
    : crypto.randomUUID().replaceAll("-", "");
  const span = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  return {
    ...accountHeaders(data),
    ...identityHeaders(data),
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
    "x-domain": data.realm === "global" ? "www.workbuddy.ai" : "www.workbuddy.cn",
    "x-agent-purpose": "conversation",
    "x-ide-name": "WorkBuddy",
    "x-ide-type": "WorkBuddy",
    "x-ide-version": version(data.realm),
    "x-product": "SaaS",
    "x-private-data": data.enterpriseId || data.realm === "global" ? "true" : "false",
    "x-conversation-id": conversationId,
    "x-conversation-request-id": requestId,
    "x-conversation-message-id": requestId,
    "x-request-id": requestId,
    "x-root-request-id": requestId,
    "x-trace-id": requestId,
    "x-b3-traceid": requestId,
    "x-b3-spanid": span,
    "x-b3-sampled": "1",
    traceparent: `00-${requestId}-${span}-01`,
    "acp-connection-id": conversationId,
    "x-agent-type": "main",
    "x-agent-intent": "craft",
    "x-agent-runtime": "local-agent",
    baggage:
      `buddyId=,buddyName=,codebuddy.session_id=${conversationId},codebuddy.conversation_request_id=${requestId}`,
  };
}

function identityHeaders(data: AccountData): Record<string, string> {
  let claims: Record<string, unknown> | null = null;
  try {
    const encoded = data.accessToken.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (encoded) {
      const bytes = Uint8Array.from(
        atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
        (c) => c.charCodeAt(0),
      );
      claims = object(JSON.parse(new TextDecoder().decode(bytes)));
    }
  } catch { /* Opaque access tokens do not carry identity claims. */ }
  const source = text(claims?.id_source);
  const method = text(claims?.token_source);
  if (!source && !data.enterpriseId) return {};
  const info = JSON.stringify({
    uin: data.uid,
    ...(data.enterpriseId ? { owner_uin: data.enterpriseId } : {}),
    ...(source ? { id_source: source } : {}),
    ...(data.enterpriseId && method ? { token_source: method } : {}),
  });
  const encoded = btoa(
    Array.from(new TextEncoder().encode(info), (b) => String.fromCharCode(b)).join(""),
  );
  return {
    "x-userinfo": encoded,
    ...(source ? { "x-id-source": source } : {}),
    ...(data.enterpriseId && method ? { "x-auth-method": method } : {}),
  };
}

async function* checkedLines(lines: AsyncIterable<string>): AsyncIterable<string> {
  for await (const line of lines) {
    const raw = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!raw.startsWith("{")) {
      yield line;
      continue;
    }
    let frame: Record<string, unknown> | null;
    try {
      frame = object(JSON.parse(raw));
    } catch {
      yield line;
      continue;
    }
    const code = number(frame?.code);
    const error = object(frame?.error);
    if ((code !== null && code !== 0) || error) {
      throw new ApiError(
        200,
        code ?? number(error?.code),
        text(frame?.msg) ?? text(error?.message) ?? "stream failed",
      );
    }
    const value = code === 0 && object(frame?.data) ? object(frame?.data)! : frame;
    const usage = object(value?.usage);
    if (usage) {
      const cached = number(usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens);
      if (cached !== null && !object(usage.prompt_tokens_details)) {
        usage.prompt_tokens_details = { cached_tokens: cached };
      }
    }
    yield line.startsWith("data:") ? `data: ${JSON.stringify(value)}` : line;
  }
}
function apiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  if (!(error instanceof HttpError)) return null;
  let value: Record<string, unknown> | null = null;
  try {
    value = object(JSON.parse(error.body));
  } catch { /* HTTP status remains authoritative. */ }
  return new ApiError(
    error.status,
    number(value?.code),
    text(value?.msg) ?? text(value?.message) ?? `request failed (HTTP ${error.status})`,
  );
}
function failure(error: unknown, data: AccountData): ProviderResult {
  const upstream = apiError(error);
  const message = upstream?.message ?? (error instanceof Error ? error.message : String(error));
  const patch = { privateData: data as unknown as JsonValue };
  if (upstream && (upstream.status === 401 || upstream.code === 12153)) {
    return {
      status: "resource-error",
      message,
      patch: {
        ...patch,
        state: { status: "invalid", message: "WorkBuddy authorization expired; sign in again" },
      },
    };
  }
  if (
    upstream &&
    (upstream.status === 402 || [14001, 14002, 14012, 14018].includes(upstream.code ?? -1))
  ) {
    return {
      status: "resource-error",
      message,
      patch: {
        ...patch,
        state: {
          status: "cooling",
          retryAtMs: Date.now() + 5 * 60_000,
          message: "WorkBuddy credits exhausted",
        },
      },
    };
  }
  if (
    upstream &&
    (upstream.status === 429 || upstream.status === 403 ||
      [11140, 14017].includes(upstream.code ?? -1))
  ) {
    return {
      status: "resource-error",
      message,
      patch: { ...patch, state: { status: "cooling", retryAtMs: Date.now() + 60_000, message } },
    };
  }
  if (upstream && [11102, 11158].includes(upstream.code ?? -1)) {
    // Model eligibility can differ by account. Try another account without disabling this account for other models.
    return { status: "resource-error", message, patch };
  }
  return { status: "request-error", message, patch };
}
async function invoke(
  input: ProviderInvokeInput,
  output: ProviderOutput,
  context: PluginContext,
): Promise<ProviderResult> {
  if (!input.resource) {
    return { status: "request-error", message: "Sign in to WorkBuddy before using its models" };
  }
  let data = accountData(input.resource);
  let emitted = false;
  const tracked: ProviderOutput = {
    emit(event) {
      emitted = true;
      output.emit(event);
    },
  };
  try {
    data = await freshAccount(data, context);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = prepareBody(input.request, input.model, data);
        if (input.request.cacheKey) {
          body.prompt_cache_key = `cursor-byok-${await digest(
            `${data.realm}:${data.uid}:${data.enterpriseId ?? ""}:${input.request.cacheKey}`,
          )}`;
        }
        const headers = await chatHeaders(data, input.request.cacheKey);
        const adapted: PluginContext = {
          ...context,
          network: {
            ...context.network,
            async stream(url, init) {
              const response = await context.network.stream(url, {
                ...init,
                body: JSON.stringify(body),
              });
              return {
                ...response,
                lines: response.status >= 200 && response.status < 300
                  ? checkedLines(response.lines)
                  : response.lines,
              };
            },
          },
        };
        await streamOpenAiChat(
          {
            url: `${chatBase(data)}/v2/chat/completions`,
            model: input.model.id,
            request: input.request,
            headers,
          },
          tracked,
          adapted,
        );
        return {
          status: "completed",
          patch: { privateData: data as unknown as JsonValue, state: { status: "ready" } },
        };
      } catch (error) {
        const upstream = apiError(error);
        if (
          !emitted && attempt === 0 && data.refreshToken &&
          (upstream?.status === 401 || upstream?.code === 12153)
        ) {
          data = await refreshToken(data, context);
          continue;
        }
        return failure(error, data);
      }
    }
  } catch (error) {
    return failure(error, data);
  }
  return { status: "request-error", message: "WorkBuddy call failed" };
}
export function workbuddyProvider(realm: Realm): ProviderSupport {
  return {
    id: `workbuddy-${realm}`,
    displayName: realm === "cn" ? "WorkBuddy CN" : "WorkBuddy Global",
    providerType: "workbuddy",
    resourceType: resourceType(realm),
    models: workbuddyModels,
    invoke,
  };
}
