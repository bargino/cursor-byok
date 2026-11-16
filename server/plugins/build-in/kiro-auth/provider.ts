import type { JsonValue } from "cursor-byok:plugin";
import type { LlmRequest, ProviderSupport } from "cursor-byok:provider";
import { AccountError, failure } from "cursor-byok:accounts";
import {
  type Data,
  data,
  fresh,
  headers,
  models,
  type Region,
  resourceType,
  runtime,
} from "./api.ts";
import { consume } from "./eventstream.ts";
export function body(request: LlmRequest, model: string, d: Data) {
  const history: unknown[] = [];
  let user: Record<string, unknown> | null = null, assistant: Record<string, unknown> | null = null;
  let systems = request.instructions ? [`[system]\n${request.instructions}\n[/system]`] : [];
  const tools = request.tools.map((t) => ({
    toolSpecification: {
      name: t.name,
      description: t.description,
      inputSchema: { json: t.parameters },
    },
  }));
  const flushUser = () => {
      if (user) {
        history.push({ userInputMessage: user });
        user = null;
      }
    },
    flushAssistant = () => {
      if (assistant) {
        history.push({ assistantResponseMessage: assistant });
        assistant = null;
      }
    };
  for (const m of request.messages) {
    if (m.role === "system") {
      flushUser();
      flushAssistant();
      systems.push(
        `[system]\n${m.content.map((p) => p.type === "text" ? p.text : "").join("\n")}\n[/system]`,
      );
      continue;
    }
    if (m.role === "assistant") {
      flushUser();
      assistant ??= { content: "" };
      assistant.content = String(assistant.content) + (assistant.content ? "\n" : "") + m.text;
      if (m.toolCalls.length) {
        assistant.toolUses = [
          ...(assistant.toolUses as unknown[] ?? []),
          ...m.toolCalls.map((t) => ({ toolUseId: t.callId, name: t.name, input: t.arguments })),
        ];
      }
      continue;
    }
    flushAssistant();
    if (!user) {
      user = {
        content: systems.length ? systems.join("\n\n") + "\n" : "",
        modelId: model,
        origin: "AI_EDITOR",
        userInputMessageContext: { tools },
      };
      systems = [];
    }
    const context = user.userInputMessageContext as Record<string, unknown>;
    if (m.role === "tool") {
      if (m.parts.some((p) => p.type === "image")) {
        throw new Error("Kiro tool results accept text only");
      }
      context.toolResults = [...(context.toolResults as unknown[] ?? []), {
        toolUseId: m.callId,
        content: [{ text: m.content }],
        status: m.isError ? "error" : "success",
      }];
    } else {
      user.content = String(user.content) + (user.content ? "\n" : "") +
        m.content.filter((p) => p.type === "text").map((p) => p.type === "text" ? p.text : "").join(
          "\n",
        );
      const images = m.content.flatMap((p) =>
        p.type === "image"
          ? [{
            format: p.mediaType.replace("image/", "").replace("jpg", "jpeg"),
            source: { bytes: p.dataBase64 },
          }]
          : []
      );
      if (images.length) user.images = [...(user.images as unknown[] ?? []), ...images];
    }
  }
  if (assistant || !user) throw new Error("Kiro requires a final user message or tool result");
  return {
    conversationState: {
      conversationId: request.cacheKey || crypto.randomUUID(),
      agentContinuationId: crypto.randomUUID(),
      agentTaskType: "vibe",
      chatTriggerType: "MANUAL",
      currentMessage: { userInputMessage: user },
      ...(history.length ? { history } : {}),
    },
    ...(d.profile_arn ? { profileArn: d.profile_arn } : {}),
  };
}
export function provider(region: Region): ProviderSupport {
  return {
    id: `kiro-${region}`,
    displayName: `Kiro (${region})`,
    providerType: "kiro",
    resourceType: resourceType(region),
    models: {
      async list({ resource }, context) {
        if (!resource) throw new Error("Sign in to Kiro first");
        return models(data(resource), context);
      },
    },
    async invoke(input, output, context) {
      if (!input.resource) return { status: "request-error", message: "Sign in to Kiro first" };
      let d = data(input.resource);
      try {
        d = await fresh(d, context);
        const target = d.api_key
          ? "AmazonCodeWhispererStreamingService.GenerateAssistantResponse"
          : "";
        const r = await context.network.stream(
          runtime(region) + (d.api_key ? "/" : "/generateAssistantResponse"),
          {
            method: "POST",
            headers: headers(d, target),
            responseEncoding: "base64",
            body: JSON.stringify(body(input.request, input.model.id, d)),
          },
        );
        if (r.status !== 200) throw new AccountError(r.status, `Kiro HTTP ${r.status}`);
        await consume(r.lines, output);
        return { status: "completed", patch: { privateData: d as unknown as JsonValue } };
      } catch (e) {
        return failure(e, d);
      }
    },
  };
}
