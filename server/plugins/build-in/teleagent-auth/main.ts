import { defineProviderPlugin, type JsonValue } from "cursor-byok:plugin";
import { importAccounts, json, number, refreshFailure } from "cursor-byok:accounts";
import { BASE, data, draft, fresh, headers, normalize, RESOURCE, unwrap, verify } from "./api.ts";
import { provider } from "./provider.ts";
import { oauth } from "./oauth.ts";
export default defineProviderPlugin({
  providers: [provider],
  resources: [{
    type: RESOURCE,
    displayName: { "en-US": "TeleAgent accounts", "zh-CN": "TeleAgent 账号" },
    add: [oauth],
    import: {
      displayName: { "en-US": "Import TeleAgent credentials", "zh-CN": "导入 TeleAgent 凭证" },
      accept: [".json"],
      multiple: true,
      parse: (files, context) =>
        importAccounts(files, async (raw) => draft(await verify(normalize(raw), context))),
    },
    present(resource) {
      const d = data(resource);
      return {
        displayName: d.name || d.account_id,
        description: `TeleAgent ${d.app_version}`,
        metrics: d.points === undefined ? [] : [{
          id: "points",
          label: { "en-US": "Points balance", "zh-CN": "积分余额" },
          unit: "count" as const,
          value: d.points,
        }],
      };
    },
    async refresh(resource, context) {
      let d = data(resource);
      try {
        d = await fresh(d, context);
        const q = unwrap(
          await json(context, BASE + "/superCowork/sapi/user/portal/companyStore/userCenter", {
            headers: headers(d),
          }),
        );
        const points = number(q.current_points_balance);
        if (points === null) throw new Error("TeleAgent did not return a points balance");
        d = { ...d, points };
        return { privateData: d as unknown as JsonValue, state: { status: "ready" as const } };
      } catch (e) {
        return refreshFailure(e, resource, d);
      }
    },
  }],
});
