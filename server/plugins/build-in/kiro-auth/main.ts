import { defineProviderPlugin, type JsonValue } from "cursor-byok:plugin";
import {
  epoch,
  importAccounts,
  json,
  number,
  object,
  refreshFailure,
  text,
} from "cursor-byok:accounts";
import {
  data,
  draft,
  fresh,
  headers,
  models,
  normalize,
  regions,
  resourceType,
  runtime,
} from "./api.ts";
import { oauth } from "./oauth.ts";
import { provider } from "./provider.ts";
export default defineProviderPlugin({
  providers: regions.map(provider),
  resources: regions.map((region) => ({
    type: resourceType(region),
    displayName: { "en-US": `Kiro accounts (${region})`, "zh-CN": `Kiro 账号（${region}）` },
    add: region === "us-east-1" ? [oauth(region)] : [],
    import: {
      displayName: {
        "en-US": "Import Kiro credentials or API key",
        "zh-CN": "导入 Kiro 凭证或 API Key",
      },
      accept: [".json"],
      multiple: true,
      parse: (files, context) =>
        importAccounts(files, async (raw) => {
          const d = normalize(raw, region);
          await models(d, context);
          return draft(d);
        }),
    },
    present(resource) {
      const d = data(resource),
        q = object(d.quota),
        rows = Array.isArray(q.usageBreakdownList) ? q.usageBreakdownList.map(object) : [];
      const row = rows.find((r) =>
        ["CREDIT", "CREDITS"].includes(text(r.resourceType).toUpperCase())
      ) ?? rows.find((r) => r.resourceType === "AGENTIC_REQUEST");
      const metrics = [];
      if (row) {
        const buckets = [
          row,
          ...(object(row.freeTrialInfo).freeTrialStatus === "ACTIVE" &&
              (epoch(object(row.freeTrialInfo).freeTrialExpiry) ?? Infinity) > Date.now()
            ? [object(row.freeTrialInfo)]
            : []),
          ...(Array.isArray(row.bonuses)
            ? row.bonuses.map(object).filter((b) =>
              b.status === "ACTIVE" && (epoch(b.expiresAt) ?? Infinity) > Date.now()
            )
            : []),
        ];
        let remaining = 0, known = false;
        for (const b of buckets) {
          const total = number(b.usageLimitWithPrecision ?? b.usageLimit),
            used = number(b.currentUsageWithPrecision ?? b.currentUsage);
          if (total !== null && used !== null) {
            known = true;
            remaining += Math.max(0, total - used);
          }
        }
        if (known) {
          metrics.push({
            id: "credits",
            label: { "en-US": "Credit balance", "zh-CN": "积分余额" },
            unit: "count" as const,
            value: remaining,
          });
        }
      }
      return {
        displayName: d.profile_arn || (d.api_key ? "Kiro API Key" : "AWS Builder ID / IAM"),
        description: text(object(q.subscriptionInfo).subscriptionTitle) || region,
        metrics,
      };
    },
    async refresh(resource, context) {
      let d = data(resource);
      try {
        d = await fresh(d, context);
        const query = new URLSearchParams({ origin: "AI_EDITOR", resourceType: "AGENTIC_REQUEST" });
        if (d.profile_arn) query.set("profileArn", d.profile_arn);
        d = {
          ...d,
          quota: await json(context, runtime(region) + "/getUsageLimits?" + query, {
            headers: headers(d),
          }),
        };
        return { privateData: d as unknown as JsonValue, state: { status: "ready" as const } };
      } catch (e) {
        return refreshFailure(e, resource, d);
      }
    },
  })),
});
