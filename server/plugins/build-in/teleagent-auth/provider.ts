import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type { ProviderSupport } from "cursor-byok:provider";
import { buildChatBody, streamOpenAiChat } from "cursor-byok:protocol/openai-chat";
import { AccountError, failure, object } from "cursor-byok:accounts";
import { BASE, CHAT, data, fresh, headers, RESOURCE, signature, unwrap, verify } from "./api.ts";
export async function* checked(lines: AsyncIterable<string>) {
  let finished = false, observed = false, done = false;
  for await (const line of lines) {
    if (line.startsWith("data:")) {
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") {
        if (!finished || !observed) throw new Error("Incomplete TeleAgent stream");
        done = true;
        yield line;
        return;
      }
      if (raw) {
        const v = object(JSON.parse(raw));
        if (v.error) {
          const e = object(v.error);
          unwrap({ code: e.code ?? 502 });
          throw new AccountError(502, "TeleAgent stream returned an error");
        }
        if (v.code !== undefined && String(v.code) !== "0") unwrap(v);
        if (Array.isArray(v.choices) && v.choices.length) {
          observed = true;
          finished ||= Boolean(object(v.choices[0]).finish_reason);
        }
      }
    }
    yield line;
  }
  if (!done) throw new Error("TeleAgent stream ended without [DONE]");
}
export const provider: ProviderSupport = {
  id: "teleagent",
  displayName: "TeleAgent",
  providerType: "teleagent",
  resourceType: RESOURCE,
  models: {
    async list({ resource }, context) {
      if (!resource) throw new Error("Sign in to TeleAgent first");
      await verify(data(resource), context);
      return ["chat-pro", "chat-flagship", "chat-flash", "chat-lite", "chat-nano"].map((id) => ({
        id,
        displayName: id,
        description: "TeleAgent product tier; model access is determined by the upstream account",
      }));
    },
  },
  async invoke(input, output, context) {
    if (!input.resource) return { status: "request-error", message: "Sign in to TeleAgent first" };
    let d = data(input.resource);
    try {
      d = await fresh(d, context);
      const body = buildChatBody({ url: "", model: input.model.id, request: input.request });
      if (body.max_completion_tokens) {
        body.max_tokens = body.max_completion_tokens;
        delete body.max_completion_tokens;
      }
      delete body.service_tier;
      const raw = JSON.stringify(body),
        nonce = crypto.randomUUID(),
        ts = String(Math.floor(Date.now() / 1000)),
        session = input.request.cacheKey || "ses_" + nonce;
      const h = {
        ...headers(d),
        authorization: `Bearer ${d.api_key}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-superagent-timestamp": ts,
        "x-superagent-nonce": nonce,
        "x-superagent-sign-version": "v1",
        "x-superagent-signature": signature(d, "POST", CHAT, ts, nonce, raw),
        "x-request-id": nonce,
        "x-session-id": session,
        "x-teleai-root-session-id": session,
        "x-message-id": "msg_" + nonce,
        "x-teleai-upstream-request-id": nonce,
        "x-teleai-run-unit-type": "agent_loop",
      };
      const adapted: PluginContext = {
        ...context,
        network: {
          ...context.network,
          async stream(url, init) {
            const r = await context.network.stream(url, { ...init, body: raw });
            if (r.status !== 200) throw new AccountError(r.status, `TeleAgent HTTP ${r.status}`);
            return { ...r, lines: checked(r.lines) };
          },
        },
      };
      await streamOpenAiChat(
        { url: BASE + CHAT, model: input.model.id, request: input.request, headers: h },
        output,
        adapted,
      );
      return { status: "completed", patch: { privateData: d as unknown as JsonValue } };
    } catch (e) {
      return failure(e, d);
    }
  },
};
