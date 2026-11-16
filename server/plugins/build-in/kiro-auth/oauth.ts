import type { OAuth2AddMethod } from "cursor-byok:resource";
import { epoch, json, object, required, text } from "cursor-byok:accounts";
import { applyToken, draft, headers, normalize, oidc, type Region } from "./api.ts";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export function trustedURL(raw: string) {
  const u = new URL(raw);
  return u.protocol === "https:" && !u.username && !u.password && !u.port &&
    [
      "view.awsapps.com",
      "device.sso.us-east-1.amazonaws.com",
      "device.sso.eu-central-1.amazonaws.com",
    ].includes(u.hostname);
}
export function oauth(region: Region): OAuth2AddMethod {
  return {
    type: "oauth2.0",
    id: `kiro-${region}`,
    displayName: {
      "en-US": `Sign in with AWS Builder ID (${region})`,
      "zh-CN": `使用 AWS Builder ID 登录（${region}）`,
    },
    async begin(context) {
      if (region !== "us-east-1") {
        throw new Error(
          "AWS Builder ID browser authorization uses us-east-1; import regional IAM credentials or an API key for Europe",
        );
      }
      const client = await json(context, oidc(region) + "/client/register", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          clientName: "Kiro",
          clientType: "public",
          scopes: [
            "codewhisperer:completions",
            "codewhisperer:analysis",
            "codewhisperer:conversations",
            "codewhisperer:transformations",
            "codewhisperer:taskassist",
          ],
          grantTypes: [GRANT, "refresh_token"],
        }),
      });
      const clientId = required(client.clientId, "OIDC client ID"),
        clientSecret = required(client.clientSecret, "OIDC client secret");
      const dev = await json(context, oidc(region) + "/device_authorization", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          clientId,
          clientSecret,
          startUrl: "https://view.awsapps.com/start",
        }),
      });
      const url = text(dev.verificationUriComplete) || text(dev.verificationUri);
      if (!trustedURL(url)) throw new Error("Kiro returned an untrusted device authorization URL");
      const ttl = Number(dev.expiresIn);
      if (!(ttl > 0 && ttl <= 3600)) throw new Error("Invalid Kiro device session expiry");
      return {
        session: {
          region,
          clientId,
          clientSecret,
          clientExpiry: epoch(client.clientSecretExpiresAt),
          deviceCode: required(dev.deviceCode, "device code"),
        },
        userCode: text(dev.userCode),
        verificationUrl: url,
        expiresAtMs: Date.now() + Math.min(600, ttl) * 1000,
        pollIntervalMs: Math.max(1, Number(dev.interval) || 5) * 1000,
      };
    },
    async poll(session, context) {
      const s = object(session);
      if (s.region !== region || !s.clientId || !s.clientSecret || !s.deviceCode) {
        throw new Error(
          "Invalid Kiro device session",
        );
      }
      const r = await context.network.fetch(oidc(region) + "/token", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          clientId: s.clientId,
          clientSecret: s.clientSecret,
          deviceCode: s.deviceCode,
          grantType: GRANT,
        }),
      });
      let o;
      try {
        o = object(JSON.parse(r.body));
      } catch {
        throw new Error("Invalid Kiro token response");
      }
      if (r.status >= 400) {
        const code = text(o.error ?? o.__type).split("#").at(-1);
        if (["authorization_pending", "AuthorizationPendingException"].includes(code!)) {
          return {
            status: "pending",
          };
        }
        if (["slow_down", "SlowDownException"].includes(code!)) return { status: "slow-down" };
        return { status: "failed", message: `Kiro authorization failed (${code || r.status})` };
      }
      const d = applyToken({
        region,
        auth_region: region,
        auth_method: "idc",
        client_id: String(s.clientId),
        client_secret: String(s.clientSecret),
        client_secret_expires_at: s.clientExpiry as number | null,
        api_key: "",
      }, o);
      return {
        status: "completed",
        resources: [await draft(normalize({ ...d, expires_at: d.expires_at }, region))],
      };
    },
  };
}
