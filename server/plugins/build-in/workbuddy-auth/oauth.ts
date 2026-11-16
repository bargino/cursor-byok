import type { JsonValue } from "cursor-byok:plugin";
import type { OAuth2AddMethod } from "cursor-byok:resource";
import {
  type AccountData,
  ApiError,
  authBase,
  number,
  object,
  type Realm,
  request,
  text,
  userAgent,
  version,
} from "./api.ts";
import { credentialDraft } from "./resources.ts";

export function loginHeaders(
  realm: Realm,
  step: "state" | "token" | "account",
  accessToken?: string,
): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "user-agent": userAgent(realm),
    "x-product": "SaaS",
    "x-request-id": crypto.randomUUID().replaceAll("-", ""),
    "x-no-user-id": "true",
    "x-no-enterprise-id": "true",
    "x-no-department-info": "true",
    ...(step === "account"
      ? { authorization: `Bearer ${accessToken}` }
      : { "x-no-authorization": "true" }),
    ...(step !== "token"
      ? { "x-domain": realm === "cn" ? "www.workbuddy.cn" : "www.codebuddy.ai" }
      : {}),
    ...(step === "state"
      ? { "content-type": "application/json", "x-custom-channel-id": "unknown" }
      : {}),
  };
}

function pending(error: unknown): boolean {
  return error instanceof ApiError && [11217, 12151].includes(error.code ?? -1);
}

export function workbuddyOAuth(realm: Realm): OAuth2AddMethod {
  return {
    type: "oauth2.0",
    id: `workbuddy-${realm}`,
    displayName: realm === "cn"
      ? { "en-US": "Sign in with WorkBuddy China", "zh-CN": "登录 WorkBuddy 国内版" }
      : { "en-US": "Sign in with WorkBuddy Global", "zh-CN": "登录 WorkBuddy 国际版" },
    async begin(context) {
      const platform = realm === "cn" ? "workbuddy" : "workbuddy-ai";
      const data = object(
        await request(
          context,
          `${authBase(realm)}/v2/plugin/auth/state?platform=${platform}`,
          loginHeaders(realm, "state"),
          "POST",
          {},
        ),
      );
      const state = text(data?.state);
      const url = text(data?.authUrl);
      if (!state || !url) {
        throw new Error("WorkBuddy did not return an authorization URL and state");
      }
      const parsed = new URL(url);
      const allowed = realm === "cn"
        ? ["www.workbuddy.cn", "www.codebuddy.cn", "copilot.tencent.com"]
        : ["www.codebuddy.ai", "www.workbuddy.ai"];
      if (
        parsed.protocol !== "https:" || !allowed.includes(parsed.hostname) || parsed.username ||
        parsed.password
      ) {
        throw new Error("WorkBuddy returned an unexpected authorization URL");
      }
      if (!parsed.searchParams.has("version")) parsed.searchParams.set("version", version(realm));
      if (realm === "cn" && !parsed.searchParams.has("loginSessionId")) {
        parsed.searchParams.set("loginSessionId", crypto.randomUUID());
      }
      return {
        session: { state, realm },
        userCode: "",
        verificationUrl: parsed.toString(),
        expiresAtMs: Date.now() + 15 * 60_000,
        pollIntervalMs: 3000,
      };
    },
    async poll(session: JsonValue, context) {
      const value = object(session);
      const state = text(value?.state);
      if (!state || value?.realm !== realm) {
        return { status: "failed", message: "WorkBuddy login session is invalid" };
      }
      const suffix = `?state=${encodeURIComponent(state)}`;
      let token;
      try {
        token = object(
          await request(
            context,
            `${authBase(realm)}/v2/plugin/auth/token${suffix}`,
            loginHeaders(realm, "token"),
          ),
        );
      } catch (error) {
        if (pending(error)) return { status: "pending" };
        if (error instanceof ApiError && /denied|拒绝|cancel/i.test(error.message)) {
          return { status: "denied" };
        }
        if (error instanceof ApiError && [12005, 11212, 11216].includes(error.code ?? -1)) {
          return { status: "failed", message: error.message };
        }
        throw error;
      }
      const accessToken = text(token?.accessToken);
      if (!accessToken) return { status: "pending" };
      let account;
      try {
        account = object(
          await request(
            context,
            `${authBase(realm)}/v2/plugin/login/account${suffix}`,
            loginHeaders(realm, "account", accessToken),
          ),
        );
      } catch (error) {
        if (pending(error)) return { status: "pending" };
        if (error instanceof ApiError && [12005, 11212, 11216].includes(error.code ?? -1)) {
          return { status: "failed", message: error.message };
        }
        throw error;
      }
      const uid = text(account?.uid);
      if (!uid) throw new Error("WorkBuddy login completed without an account UID");
      const expiresIn = number(token?.expiresIn);
      const data: AccountData = {
        realm,
        uid,
        accessToken,
        refreshToken: text(token?.refreshToken),
        expiresAtMs: expiresIn !== null && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
        domain: text(token?.domain),
        enterpriseId: text(account?.enterpriseId),
        displayName: text(account?.nickname) ?? uid,
        deviceToken: null,
        credits: null,
      };
      // Balance lookup is independent of sign-in; a transient billing failure must not lose a login.
      return { status: "completed", resources: [credentialDraft(data)] };
    },
  };
}
