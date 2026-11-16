import type { ModelDefinition, ModelSupport } from "cursor-byok:model";
import { accountData, accountHeaders, chatBase, number, object, request, text } from "./api.ts";

export function parseModels(value: unknown): ModelDefinition[] {
  const data = object(value);
  if (!Array.isArray(data?.models)) throw new Error("WorkBuddy model catalog is missing models");
  const entries = [...data.models];
  const features = object(data.productFeaturesConfig);
  const trial = object(features?.ModelTrialBanner);
  if (Array.isArray(trial?.banners)) {
    for (const raw of trial.banners) {
      const banner = object(raw);
      const target = entries.find((entry) => object(entry)?.id === banner?.targetModelId);
      if (text(banner?.modelId)) {
        entries.push({
          ...object(target),
          id: banner!.modelId,
          name: banner!.modelId,
          credits: null,
        });
      }
    }
  }
  const agents = Array.isArray(data.agents)
    ? data.agents.map(object).filter((v) => v !== null)
    : [];
  const agent =
    agents.find((a) =>
      Array.isArray(a.tags) && a.tags.some((tag) => String(tag).toLowerCase() === "default")
    ) ??
      agents.find((a) => text(a.name)?.toLowerCase() === "cli") ??
      agents.find((a) => Array.isArray(a.models) && a.models.length);
  const order = Array.isArray(agent?.models)
    ? agent.models.filter((v): v is string => typeof v === "string")
    : [];
  const caps = object(features?.ModelRateLimitCap);
  const paid = new Set(
    Array.isArray(caps?.lines)
      ? caps.lines.map((v) => text(object(v)?.paidId)).filter(Boolean)
      : [],
  );
  const allowed = order.length
    ? new Set([...order, "fast-model", "balanced-model", "deep-model"])
    : null;
  const seen = new Set<string>();
  const models = entries.flatMap((raw): ModelDefinition[] => {
    const model = object(raw);
    const id = text(model?.id);
    if (
      !model || !id || model.disabled === true || model.supportsToolCall === false ||
      seen.has(id) ||
      id === "auto" || id === "auto-chat" || paid.has(id) || (allowed && !allowed.has(id))
    ) return [];
    // WorkBuddy's catalog also contains media generation entries without a chat interface.
    const maxOutputTokens = number(model.maxOutputTokens);
    if (
      /^(?:image|video|audio|nes|completion|codewise)[-_]/i.test(id) ||
      (maxOutputTokens !== null && maxOutputTokens > 0 && maxOutputTokens <= 256) ||
      (Array.isArray(model.tags) &&
        model.tags.some((tag) => /^(?:text|image)-to-(?:image|video)$/.test(String(tag))))
    ) return [];
    seen.add(id);
    const reasoning = object(model.reasoning);
    const efforts = Array.isArray(reasoning?.supportedEfforts)
      ? reasoning.supportedEfforts.filter((v): v is string => typeof v === "string")
      : [];
    return [{
      id,
      displayName: text(model.name) ?? id,
      ...(text(model.descriptionZh) ? { description: text(model.descriptionZh)! } : {}),
      ...(maxOutputTokens !== null && maxOutputTokens > 0 ? { maxOutputTokens } : {}),
      capabilities: { images: model.supportsImages === true },
      privateData: {
        reasoningEfforts: efforts,
        defaultEffort: text(reasoning?.defaultEffort) ?? text(reasoning?.effort),
        supportsReasoning: model.supportsReasoning === true,
        onlyReasoning: model.onlyReasoning === true,
        canDisableThinking: reasoning?.canDisableThinking === true,
      },
    }];
  });
  if (order.length) {
    const rank = ["fast-model", "balanced-model", "deep-model", ...order];
    models.sort((a, b) => rank.indexOf(a.id) - rank.indexOf(b.id));
  }
  return models;
}

export const workbuddyModels: ModelSupport = {
  async list({ resource }, context) {
    if (!resource) throw new Error("Sign in to WorkBuddy before syncing models");
    const data = accountData(resource);
    const catalog = await request(context, `${chatBase(data)}/v3/config`, {
      ...accountHeaders(data),
      "x-domain": new URL(chatBase(data)).hostname,
    });
    const models = parseModels(catalog);
    if (!models.length) throw new Error("WorkBuddy returned no available chat models");
    return models;
  },
};
