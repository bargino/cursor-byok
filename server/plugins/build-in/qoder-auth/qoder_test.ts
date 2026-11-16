import type { JsonValue } from "cursor-byok:plugin";
import type { ModelEvent } from "cursor-byok:provider";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { assert, context, eq, lines, rejects, request, response } from "../../test_support.ts";
import {
  applyToken,
  type Data,
  data,
  draft,
  fresh,
  normalize,
  profile,
  resourceType,
} from "./api.ts";
import { oauth } from "./oauth.ts";
import { encodeBody, signed } from "./sign.ts";
import { provider, qoderLines } from "./provider.ts";
import plugin from "./main.ts";
const credentials = (overrides: Partial<Data> = {}): Data => ({
  scope: "cn",
  access_token: "test-access",
  refresh_token: "test-refresh",
  expires_at: Date.now() + 3600_000,
  uid: "one",
  name: "Same name",
  machine_id: "machine",
  user_type: "personal",
  organization_id: "",
  organization_name: "",
  organization_tags: [],
  ...overrides,
});
function snapshot(d = credentials()) {
  return {
    id: "record",
    type: resourceType(d.scope),
    ...draft(d),
    state: { status: "ready" as const },
  };
}
function decoded(b: string) {
  const alpha = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!",
    standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    k = Math.floor(b.length / 3);
  return Buffer.from(
    (b.slice(b.length - k) + b.slice(k, b.length - k) + b.slice(0, k)).split("").map((c) =>
      c === "$" ? "=" : standard[alpha.indexOf(c)]
    ).join(""),
    "base64",
  ).toString("utf8");
}
Deno.test("Qoder CN/global browser authorization binds PKCE and keeps the verifier in the session", async () => {
  for (const scope of ["cn", "global"] as const) {
    const start = await oauth(scope).begin(context());
    const u = new URL(start.verificationUrl), s = start.session as Record<string, string>;
    eq(u.hostname, scope === "cn" ? "qoder.com.cn" : "qoder.com");
    assert(u.searchParams.get("challenge"));
    assert(!u.searchParams.has("verifier"));
    eq(u.searchParams.get("machine_id"), s.machine);
    assert(s.verifier.length >= 43);
    eq(u.searchParams.get("nonce"), s.nonce);
  }
});
Deno.test("Qoder polling preserves pending status and completes with upstream-confirmed UID", async () => {
  const start = await oauth("cn").begin(context());
  for (const status of [202, 404]) {
    eq(
      (await oauth("cn").poll(start.session, context({ fetch: () => response({}, status) })))
        .status,
      "pending",
    );
  }
  const result = await oauth("cn").poll(
    start.session,
    context({
      fetch(url) {
        return url.includes("userinfo")
          ? response({ id: "real-user", name: "Name", user_type: "personal" })
          : response({ token: "access", refresh_token: "refresh", expires_in: 3600_000 });
      },
    }),
  );
  assert(result.status === "completed");
  assert(result.resources[0].key.includes("real-user"));
});
Deno.test("Qoder expiry uses milliseconds and identity does not use a nickname", async () => {
  const t = applyToken(credentials(), { token: "new", expires_in: 3600_000 });
  assert(t.expires_at > Date.now() + 3500_000);
  assert(draft(credentials()).key !== draft(credentials({ uid: "two" })).key);
  eq(draft(credentials()).key, draft(credentials({ access_token: "changed" })).key);
  await rejects(() => profile(credentials(), context({ fetch: () => response({ id: "other" }) })));
});
Deno.test("Qoder COSY encoding is reversible and the signature binds exact path and body bytes", () => {
  const raw = '{"text":"中文","messages":[]}';
  eq(decoded(encodeBody(raw)), raw);
  const call = signed(credentials(), "/algo/api/v2/model/list?Encode=1", JSON.parse(raw));
  eq(decoded(call.body), raw);
  const auth = call.headers.authorization.split(".");
  eq(
    auth[2],
    createHash("md5").update(
      [
        auth[1],
        call.headers["cosy-key"],
        call.headers["cosy-date"],
        call.body,
        "/api/v2/model/list",
      ].join("\n"),
    ).digest("hex"),
  );
  assert(!JSON.stringify(call).includes("test-refresh"));
  assert(!("cosy-machinetoken" in call.headers));
});
Deno.test("Qoder refresh rotates credentials without a fallible profile request", async () => {
  let count = 0;
  const d = await fresh(
    credentials({ expires_at: 1, refresh_token: "jrt-test" }),
    context({
      fetch(url) {
        count++;
        assert(url.endsWith("/api/v1/jobToken/refresh"));
        return response({ token: "rotated", refresh_token: "next", expires_in: 3600_000 });
      },
    }),
  );
  eq(count, 1);
  eq(d.access_token, "rotated");
  eq(d.refresh_token, "next");
});
Deno.test("Qoder model catalog keeps upstream system keys and applies explicit disablement", async () => {
  const models = await provider("cn").models!.list(
    { resource: snapshot() },
    context({
      fetch: () =>
        response({
          data: {
            chat: [{ key: "one", name: "A" }, { key: "byok", source: "custom" }, {
              key: "one",
              enable: false,
            }, { key: "native-key", display_name: "Name", max_output_tokens: 4000 }],
          },
        }),
    }),
  );
  eq(models.map((m) => m.id), ["native-key"]);
  eq(models[0].maxOutputTokens, 4000);
});
Deno.test("Qoder stream adapts envelopes, signs tools/history, and requires a native finish event", async () => {
  const r = request();
  r.tools = [{ name: "read", description: "Read", parameters: { type: "object" } }];
  r.messages.push({
    role: "assistant",
    text: "",
    thinking: "",
    replayState: null,
    toolCalls: [{ index: 0, callId: "old", name: "read", arguments: { path: "a" } }],
  }, { role: "tool", callId: "old", name: "read", content: "result", isError: false, parts: [] });
  const before = JSON.stringify(r), events: ModelEvent[] = [];
  const result = await provider("cn").invoke(
    { resource: snapshot(), model: { id: "native-key", displayName: "Model" }, request: r },
    {
      emit: (e) => events.push(e),
    },
    context({
      stream(_url, init) {
        const native = JSON.parse(decoded(init.body!));
        eq(native.business.model_key, "native-key");
        eq(native.messages[2].content, "");
        eq(native.messages[3].tool_call_id, "old");
        return lines([
          "data: " +
          JSON.stringify({
            statusCodeValue: 200,
            body: JSON.stringify({
              choices: [{ delta: { content: "OK" }, finish_reason: "stop" }],
            }),
          }),
          "",
          "event: finish",
          "",
        ]);
      },
    }),
  );
  eq(result.status, "completed");
  assert(events.some((e) => e.type === "text-delta" && e.text === "OK"));
  eq(JSON.stringify(r), before);
  await rejects(async () => {
    for await (
      const _ of qoderLines(
        lines(["data: " + JSON.stringify({ statusCodeValue: 200, body: { choices: [] } }), ""])
          .lines,
      )
    ) {}
  });
});
Deno.test("Qoder quota refresh exposes separate credit buckets without inventing unlimited shared credits", async () => {
  const resource = plugin.resources![0], snap = snapshot();
  const patch = await resource.refresh!(
    snap,
    context({
      fetch: () =>
        response({
          data: {
            userQuota: { total: 100, used: 20 },
            addOnQuota: { remaining: 5 },
            orgResourcePackage: { total: -1, used: 100 },
          },
        }),
    }),
  );
  const view = resource.present({ ...snap, privateData: patch.privateData as JsonValue });
  eq(view.metrics?.map((m) => m.value), [80, 5]);
  await rejects(() => resource.refresh!(snap, context({ fetch: () => response({}, 500) })));
});
