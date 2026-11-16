import type { OAuth2AddMethod } from "cursor-byok:resource";
import { base64 } from "cursor-byok:accounts";
import { applyToken, auth, type Data, draft, object, profile, regions, type Scope } from "./api.ts";
export function oauth(scope: Scope): OAuth2AddMethod {
  return {
    type: "oauth2.0",
    id: `qoder-${scope}`,
    displayName: scope === "cn"
      ? { "zh-CN": "登录 Qoder 国内版", "en-US": "Sign in to Qoder China" }
      : { "zh-CN": "登录 Qoder 国际版", "en-US": "Sign in to Qoder Global" },
    async begin() {
      const verifier = base64(crypto.getRandomValues(new Uint8Array(48))).replace(/\+/g, "-")
        .replace(/\//g, "_").replace(/=+$/, "");
      const nonce = scope === "cn" ? crypto.randomUUID() : crypto.randomUUID().replaceAll("-", "");
      const machine = crypto.randomUUID();
      const challenge = base64(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
      ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const query = new URLSearchParams({
        nonce,
        challenge,
        challenge_method: "S256",
        client_id: regions[scope].client,
        machine_id: machine,
      });
      if (scope === "cn") query.set("redirect_uri", "qoder-work-cn://");
      return {
        session: { scope, nonce, verifier, machine },
        userCode: "",
        verificationUrl: regions[scope].web + "/device/selectAccounts?" + query,
        expiresAtMs: Date.now() + 600_000,
        pollIntervalMs: 3000,
      };
    },
    async poll(session, context) {
      const s = object(session);
      if (s.scope !== scope || !s.nonce || !s.verifier || !s.machine) {
        return {
          status: "failed",
          message: "Invalid Qoder login session",
        };
      }
      const query = new URLSearchParams({
        nonce: String(s.nonce),
        verifier: String(s.verifier),
        challenge_method: "S256",
      });
      try {
        const token = await auth(context, scope, "/api/v1/deviceToken/poll?" + query);
        const value = applyToken({ scope, machine_id: String(s.machine) }, token);
        return { status: "completed", resources: [draft(await profile(value as Data, context))] };
      } catch (e) {
        if (e instanceof Error && "status" in e && [202, 404].includes(Number(e.status))) {
          return {
            status: "pending",
          };
        }
        throw e;
      }
    },
  };
}
