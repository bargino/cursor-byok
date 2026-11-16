import type { PluginContext } from "cursor-byok:plugin";
import { accountIdentity, credentialDraft, parseCredentialFiles } from "./resources.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(requests: string[]): PluginContext["network"] {
  return {
    fetch: async (url, init = {}) => {
      requests.push(`${url}:${init.body ?? ""}`);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
      };
    },
    stream: () => Promise.reject(new Error("stream is not expected")),
  };
}

Deno.test("imports an array of email and refresh_token credentials", async () => {
  const requests: string[] = [];
  const result = await parseCredentialFiles([
    {
      name: "antigravity.json",
      content: JSON.stringify([
        { email: "teocougar@gmail.com", refresh_token: "refresh-token" },
      ]),
    },
  ], context(requests));

  assert(result.warnings.length === 0, "the credential file should not produce warnings");
  assert(result.credentials.length === 1, "one credential should be imported");
  assert(result.credentials[0].displayName === "teocougar@gmail.com", "email should be used as display name");
  assert(result.credentials[0].accessToken === "access-token", "refresh token should be exchanged for an access token");
  assert(result.credentials[0].refreshToken === "refresh-token", "refresh token should be preserved");
  assert(requests.length === 1, "the refresh token should be exchanged once");
});

Deno.test("same import filename or nickname cannot collapse different Google accounts", async () => {
  const first = await credentialDraft({ accessToken: "opaque-one", refreshToken: null, displayName: "auth.json" });
  const second = await credentialDraft({ accessToken: "opaque-two", refreshToken: null, displayName: "auth.json" });
  assert(first.key !== second.key, "human labels must not be account identity");
  const renewed = await accountIdentity("new-access-token", "User@example.com");
  const original = await accountIdentity("old-access-token", "user@example.com");
  assert(renewed.key === original.key, "email identity must survive token renewal and case differences");
});

Deno.test("verified token claims take precedence over a shared display label", async () => {
  function jwt(sub: string): string { return `header.${btoa(JSON.stringify({ sub }))}.signature`; }
  const a = await accountIdentity(jwt("one"), "Shared name");
  const b = await accountIdentity(jwt("two"), "Shared name");
  assert(a.key !== b.key, "different subjects must coexist");
});
