import { defineProviderPlugin } from "cursor-byok:plugin";
import { type Realm, resourceType } from "./api.ts";
import { workbuddyOAuth } from "./oauth.ts";
import { workbuddyProvider } from "./provider.ts";
import {
  checkInAction,
  credentialImport,
  creditPackagesAction,
  presentAccount,
  refreshAccount,
} from "./resources.ts";

const realms: Realm[] = ["cn", "global"];
export default defineProviderPlugin({
  providers: realms.map(workbuddyProvider),
  resources: realms.map((realm) => ({
    type: resourceType(realm),
    displayName: realm === "cn"
      ? { "en-US": "WorkBuddy China accounts", "zh-CN": "WorkBuddy 国内账号" }
      : { "en-US": "WorkBuddy Global accounts", "zh-CN": "WorkBuddy 国际账号" },
    add: [workbuddyOAuth(realm)],
    import: credentialImport(realm),
    present: presentAccount,
    refresh: refreshAccount,
    actions: realm === "cn" ? [creditPackagesAction, checkInAction] : [creditPackagesAction],
  })),
});
