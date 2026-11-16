import { defineProviderPlugin, type JsonValue } from "cursor-byok:plugin";
import { importAccounts, number, object, refreshFailure } from "cursor-byok:accounts";
import { auth, data, draft, fresh, normalize, profile, resourceType, type Scope } from "./api.ts";
import { oauth } from "./oauth.ts";
import { provider } from "./provider.ts";
const scopes: Scope[] = ["cn", "global"];
export default defineProviderPlugin({
  providers: scopes.map(provider),
  resources: scopes.map((scope) => ({
    type: resourceType(scope),
    displayName: scope === "cn"
      ? { "en-US": "Qoder China accounts", "zh-CN": "Qoder 国内账号" }
      : { "en-US": "Qoder Global accounts", "zh-CN": "Qoder 国际账号" },
    add: [oauth(scope)],
    import: {
      displayName: { "en-US": "Import Qoder credentials", "zh-CN": "导入 Qoder 凭证" },
      accept: [".json"],
      multiple: true,
      parse: (files, context) =>
        importAccounts(files, async (raw) => draft(await profile(normalize(raw, scope), context))),
    },
    present(resource) {
      const d = data(resource), q = object(d.quota), metrics = [];
      for (const key of ["userQuota", "addOnQuota", "orgResourcePackage"]) {
        const w = object(q[key]);
        if (w.available === false || number(w.total ?? w.cap) === -1) continue;
        const remain = number(w.remaining) ??
          (number(w.total ?? w.cap) !== null && number(w.used) !== null
            ? Number(w.total ?? w.cap) - Number(w.used)
            : null);
        if (remain !== null) {
          metrics.push({
            id: key,
            label: key === "userQuota"
              ? { "en-US": "Plan credits", "zh-CN": "套餐积分" }
              : key === "addOnQuota"
              ? { "en-US": "Add-on credits", "zh-CN": "附加积分" }
              : { "en-US": "Shared credits", "zh-CN": "共享积分" },
            unit: "count" as const,
            value: Math.max(0, remain),
          });
        }
      }
      return { displayName: d.name || d.uid, description: d.organization_name || d.uid, metrics };
    },
    async refresh(resource, context) {
      let d = data(resource);
      try {
        d = await fresh(d, context);
        const result = await auth(context, scope, "/api/v2/quota/usage", d.access_token);
        if (
          result.success === false ||
          result.code !== undefined && ![0, 200, "0", "200"].includes(result.code as never)
        ) throw new Error("Qoder quota query failed");
        d = { ...d, quota: object(result.data ?? result) };
        return { privateData: d as unknown as JsonValue, state: { status: "ready" as const } };
      } catch (e) {
        return refreshFailure(e, resource, d);
      }
    },
  })),
});
