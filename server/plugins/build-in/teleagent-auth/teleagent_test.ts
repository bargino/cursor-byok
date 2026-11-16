import type { JsonValue } from "cursor-byok:plugin";
import type { ModelEvent } from "cursor-byok:provider";
import { assert, context, eq, lines, rejects, request, response } from "../../test_support.ts";
import {
  BASE,
  CHAT,
  type Data,
  data,
  draft,
  fresh,
  headers,
  normalize,
  RESOURCE,
  signature,
  verify,
} from "./api.ts";
import { oauth } from "./oauth.ts";
import { checked, provider } from "./provider.ts";
import plugin from "./main.ts";
const TOKEN =
  "tenant:eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50SWQiOiJmaXh0dXJlLWFjY291bnQiLCJhY2NvdW50TmFtZSI6IkZpeHR1cmUiLCJleHAiOjIwMDAwMDAwMDB9.signature-fixture";
const credentials = () =>
  normalize({
    token: TOKEN,
    api_key: "sk-authorized-fixture",
    device_id: "fixture-device",
    install_id: "fixture-install",
    app_version: "2.7.1",
  });
const snapshot = (d = credentials()) => ({
  id: "resource",
  type: RESOURCE,
  ...draft(d),
  state: { status: "ready" as const },
});
Deno.test("TeleAgent HMAC matches the independent reference golden vector and binds body bytes", () => {
  const d = credentials(),
    raw = '{"messages":[{"role":"user","content":"你好"}],"model":"chat-pro","stream":true}';
  eq(
    signature(d, "POST", CHAT, "1793800000", "00000000-0000-4000-8000-000000000001", raw),
    "594be319d4c4b4053d240380cc1f1dda0b6758a93ff92bde1c352860ad8232f9",
  );
  assert(
    signature(d, "POST", CHAT, "1793800000", "n", raw) !==
      signature(d, "POST", CHAT, "1793800000", "n", raw + " "),
  );
});
Deno.test("TeleAgent uses original device metadata and cannot extend JWT expiry", async () => {
  const d = credentials();
  eq(d.expires_at, 2000000000000);
  eq(d.renewable, false);
  eq(normalize({ ...d, expires_at: 2100000000000 }).expires_at, 2000000000000);
  await rejects(() => normalize({ token: TOKEN, api_key: "sk_test" }));
  eq(headers(d)["x-token"], TOKEN);
  assert(!headers(d).authorization);
});
Deno.test("TeleAgent verifies the official account ID before storing credentials", async () => {
  await rejects(() =>
    verify(
      credentials(),
      context({ fetch: () => response({ code: 0, data: { accountId: "other" } }) }),
    )
  );
  const d = await verify(
    credentials(),
    context({
      fetch: () =>
        response({ code: 0, data: { accountId: "fixture-account", accountName: "User" } }),
    }),
  );
  eq(d.name, "User");
  eq(draft(d).key, draft({ ...d, token: "new-token" }).key);
});
Deno.test("TeleAgent browser flow uses one host-owned window and cancels its exact job", async () => {
  const c = context({
    fetch: () => response({ code: 0, data: { accountId: "fixture-account", accountName: "User" } }),
  });
  let cancelled = "";
  c.desktop = {
    async beginTeleAgentLogin() {
      return { id: "job", expiresAtMs: Date.now() + 600000 };
    },
    async pollTeleAgentLogin(id) {
      eq(id, "job");
      return { status: "completed", credentials: { ...credentials() } as unknown as JsonValue };
    },
    async cancelTeleAgentLogin(id) {
      cancelled = id;
    },
  };
  const start = await oauth.begin(c);
  eq(start.browserOpened, true);
  const result = await oauth.poll(start.session, c);
  assert(result.status === "completed");
  eq((result.resources[0].privateData as Record<string, JsonValue>).renewable, true);
  await oauth.cancel!(start.session, c);
  eq(cancelled, "job");
});
Deno.test("TeleAgent imported desktop sessions do not opt into token rotation", async () => {
  await rejects(() => fresh({ ...credentials(), expires_at: 1 }, context()));
  const next = await fresh(
    { ...credentials(), expires_at: 1, renewable: true },
    context({
      fetch(url, init) {
        assert(url.endsWith("/auth/token-refresh"));
        eq(init.headers?.["x-token"], TOKEN);
        return response({ code: 0, data: { accessToken: TOKEN, expiresIn: 3600 } });
      },
    }),
  );
  assert(next.expires_at > Date.now());
});
Deno.test("TeleAgent model calls sign exact bytes and never send the gateway key to account APIs", async () => {
  const events: ModelEvent[] = [];
  const result = await provider.invoke(
    {
      resource: snapshot(),
      model: { id: "chat-pro", displayName: "TeleAgent" },
      request: request(),
    },
    { emit: (e) => events.push(e) },
    context({
      stream(url, init) {
        eq(url, BASE + CHAT);
        eq(init.headers?.authorization, "Bearer sk-authorized-fixture");
        eq(
          init.headers?.["x-superagent-signature"],
          signature(
            credentials(),
            "POST",
            CHAT,
            init.headers!["x-superagent-timestamp"],
            init.headers!["x-superagent-nonce"],
            init.body!,
          ),
        );
        return lines([
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}',
          "data: [DONE]",
        ]);
      },
    }),
  );
  eq(result.status, "completed");
  assert(events.some((e) => e.type === "text-delta" && e.text === "OK"));
});
Deno.test("TeleAgent treats premature EOF and missing finish reasons as failures", async () => {
  for (
    const input of [['data: {"choices":[{"delta":{"content":"partial"}}]}'], [
      'data: {"choices":[{"delta":{"content":"partial"}}]}',
      "data: [DONE]",
    ]]
  ) {
    await rejects(async () => {
      for await (const _ of checked(lines(input).lines)) {}
    });
  }
});
Deno.test("TeleAgent preserves a real zero points balance and fails when no balance is returned", async () => {
  const resource = plugin.resources![0], snap = snapshot();
  const patch = await resource.refresh!(
    snap,
    context({ fetch: () => response({ code: 0, data: { current_points_balance: "0" } }) }),
  );
  eq(resource.present({ ...snap, privateData: patch.privateData! }).metrics?.[0].value, 0);
  await rejects(() =>
    resource.refresh!(snap, context({ fetch: () => response({ code: 0, data: {} }) }))
  );
});
