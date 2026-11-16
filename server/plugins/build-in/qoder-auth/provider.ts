import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type { ProviderSupport } from "cursor-byok:provider";
import { buildChatBody, streamOpenAiChat } from "cursor-byok:protocol/openai-chat";
import { AccountError, failure, json, number, object, text } from "cursor-byok:accounts";
import { data, fresh, resourceType, type Scope, VERSION } from "./api.ts";
import { signed } from "./sign.ts";
export const MODELS = "/algo/api/v2/model/list?Encode=1";
export const CHAT =
  "/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
export async function* qoderLines(lines: AsyncIterable<string>) {
  let event = "", values: string[] = [], observed = false;
  function decode() {
    if (event === "error") throw new AccountError(502, "Qoder stream returned an error");
    const env = object(JSON.parse(values.join("\n")));
    if (Number(env.statusCodeValue) !== 200) {
      throw new AccountError(Number(env.statusCodeValue) || 502, "Qoder rejected the stream");
    }
    const raw = typeof env.body === "string" ? env.body : JSON.stringify(env.body);
    if (raw === "[DONE]") return null;
    const chunk = object(JSON.parse(raw));
    if (chunk.error || !Array.isArray(chunk.choices)) {
      throw new AccountError(502, "Invalid Qoder stream chunk");
    }
    observed ||= chunk.choices.length > 0;
    return `data: ${raw}`;
  }
  for await (const line of lines) {
    if (line === "") {
      if (event === "finish") {
        if (!observed) throw new AccountError(502, "Empty Qoder stream");
        yield "data: [DONE]";
        return;
      }
      if (values.length) {
        const chunk = decode();
        if (chunk) yield chunk;
      }
      event = "";
      values = [];
    } else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      values.push(line.slice(5).trimStart());
      if (values.join("").length > (4 << 20)) throw new Error("Qoder stream frame too large");
    }
  }
  if (event === "finish" && observed) {
    yield "data: [DONE]";
    return;
  }
  throw new AccountError(502, "Qoder stream ended without its finish event");
}
export function provider(scope: Scope): ProviderSupport {
  return {
    id: `qoder-${scope}`,
    displayName: scope === "cn" ? "Qoder CN" : "Qoder Global",
    providerType: "qoder",
    resourceType: resourceType(scope),
    models: {
      async list({ resource }, context) {
        if (!resource) throw new Error("Sign in to Qoder first");
        const d = data(resource), call = signed(d, MODELS, {});
        const raw = await json(context, call.url, {
          method: "GET",
          headers: call.headers,
          body: call.body,
        });
        const rows = object(raw.data ?? raw).chat;
        if (!Array.isArray(rows)) throw new Error("Qoder returned no chat catalog");
        const models = new Map();
        for (const item of rows) {
          const m = object(item), id = text(m.key ?? m.model_key);
          if (!id || /[\/\r\n]/.test(id)) continue;
          models.delete(id);
          if (m.enable === false || m.enable === 0 || m.source && m.source !== "system") continue;
          models.set(id, {
            id,
            displayName: text(m.display_name ?? m.name) || id,
            ...(number(m.max_output_tokens)
              ? { maxOutputTokens: Number(m.max_output_tokens) }
              : {}),
          });
        }
        return [...models.values()];
      },
    },
    async invoke(input, output, context) {
      if (!input.resource) return { status: "request-error", message: "Sign in to Qoder first" };
      let d = data(input.resource);
      try {
        d = await fresh(d, context);
        const body = buildChatBody({ url: "", model: input.model.id, request: input.request });
        const messages = body.messages as Record<string, JsonValue>[];
        for (
          const m of messages
        ) {
          if (m.content === null && (m.role === "tool" || Array.isArray(m.tool_calls))) {
            m
              .content = "";
          }
        }
        const session = input.request.cacheKey || crypto.randomUUID(), id = crypto.randomUUID();
        const parameters: Record<string, JsonValue> = {};
        if (body.max_completion_tokens) parameters.max_tokens = body.max_completion_tokens;
        if (body.reasoning_effort) parameters.reasoning_effort = body.reasoning_effort;
        const model = { key: input.model.id, format: "openai", source: "system" };
        const prompt = [...messages].reverse().find((m) => m.role === "user")?.content;
        const promptText = typeof prompt === "string" ? prompt : "";
        const native = {
          request_id: id,
          request_set_id: id,
          chat_record_id: session,
          session_id: session,
          stream: true,
          chat_task: "FREE_INPUT",
          is_reply: true,
          is_retry: false,
          session_type: "qodercli",
          agent_id: "agent_common",
          task_id: "common",
          source: 1,
          version: "3",
          aliyun_user_type: d.user_type,
          model_config: model,
          messages,
          tools: body.tools ?? [],
          parameters,
          chat_context: {
            text: { type: "text", text: promptText },
            extra: { originalContent: { type: "text", text: promptText }, modelConfig: model },
          },
          business: {
            product: "cli",
            version: VERSION,
            type: "agent",
            id: session,
            name: "API chat",
            begin_at: Date.now(),
            stage: "start",
            model_key: input.model.id,
          },
        };
        const call = signed(d, CHAT, native, input.model.id);
        const adapted: PluginContext = {
          ...context,
          network: {
            ...context.network,
            async stream(url, init) {
              const r = await context.network.stream(url, { ...init, body: call.body });
              if (r.status !== 200) throw new AccountError(r.status, `Qoder HTTP ${r.status}`);
              return { ...r, lines: qoderLines(r.lines) };
            },
          },
        };
        await streamOpenAiChat(
          { url: call.url, model: input.model.id, request: input.request, headers: call.headers },
          output,
          adapted,
        );
        return { status: "completed", patch: { privateData: d as unknown as JsonValue } };
      } catch (e) {
        return failure(e, d);
      }
    },
  };
}
