import type { JsonValue } from "cursor-byok:plugin";
import type { ModelEvent } from "cursor-byok:provider";
import { AccountError, base64 } from "cursor-byok:accounts";
import { assert, context, eq, lines, rejects, request, response } from "../../test_support.ts";
import {
  applyToken,
  type Data,
  data,
  draft,
  fresh,
  models,
  normalize,
  resourceType,
} from "./api.ts";
import { oauth, trustedURL } from "./oauth.ts";
import { consume, crc32, frames } from "./eventstream.ts";
import { body, provider } from "./provider.ts";
import plugin from "./main.ts";
const credential = (overrides: Partial<Data> = {}): Data => ({
  region: "us-east-1",
  auth_region: "us-east-1",
  auth_method: "idc",
  access_token: "access",
  refresh_token: "refresh",
  api_key: "",
  expires_at: Date.now() + 3600_000,
  profile_arn: "",
  client_id: "client-one",
  client_secret: "secret",
  client_secret_expires_at: Date.now() + 86400_000,
  ...overrides,
});
async function snapshot(d = credential()) {
  return {
    id: "resource",
    type: resourceType(d.region),
    ...await draft(d),
    state: { status: "ready" as const },
  };
}
function frame(type: string, payload: unknown, messageType = "event"): Uint8Array {
  const encoder = new TextEncoder(), headers = [] as number[];
  for (const [name, value] of [[":message-type", messageType], [":event-type", type]]) {
    const n = encoder.encode(name), v = encoder.encode(value);
    headers.push(n.length, ...n, 7, v.length >> 8, v.length & 255, ...v);
  }
  const p = encoder.encode(JSON.stringify(payload)),
    b = new Uint8Array(16 + headers.length + p.length),
    view = new DataView(b.buffer);
  view.setUint32(0, b.length);
  view.setUint32(4, headers.length);
  view.setUint32(8, crc32(b.subarray(0, 8)));
  b.set(headers, 12);
  b.set(p, 12 + headers.length);
  view.setUint32(b.length - 4, crc32(b.subarray(0, b.length - 4)));
  return b;
}
function binary(chunks: Uint8Array[]) {
  return lines(chunks.map(base64));
}
Deno.test("AWS event-stream CRC matches the standard independent vector", () =>
  eq(crc32(new TextEncoder().encode("123456789")), 0xcbf43926));
Deno.test("Kiro validates both CRCs across arbitrarily fragmented binary chunks", async () => {
  const original = frame("assistantResponseEvent", { content: "中文" });
  for (const split of [1, 7, 12, original.length - 2]) {
    const result = [];
    for await (const f of frames(binary([original.slice(0, split), original.slice(split)]).lines)) {
      result.push(f);
    }
    eq(result[0].payload.content, "中文");
  }
  const corrupt = original.slice();
  corrupt[corrupt.length - 1] ^= 1;
  await rejects(async () => {
    for await (const _ of frames(binary([corrupt]).lines)) {}
  });
  await rejects(async () => {
    for await (const _ of frames(binary([original.slice(0, -1)]).lines)) {}
  });
});
Deno.test("Kiro streams text, complete tool arguments and explicit metering", async () => {
  const events: ModelEvent[] = [];
  await consume(
    binary([
      frame("assistantResponseEvent", { content: "Hello" }),
      frame("toolUseEvent", {
        toolUseId: "t",
        name: "read",
        input: '{"id":9007199254740993',
        stop: false,
      }),
      frame("toolUseEvent", { toolUseId: "t", input: "}", stop: true }),
      frame("meteringEvent", { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 30 }),
    ]).lines,
    { emit: (e) => events.push(e) },
  );
  assert(events.some((e) => e.type === "text-delta" && e.text === "Hello"));
  eq(
    events.filter((e) => e.type === "tool-call-arguments-delta").map((e) =>
      e.type === "tool-call-arguments-delta" ? e.delta : ""
    ).join(""),
    '{"id":9007199254740993}',
  );
  assert(events.some((e) => e.type === "usage" && e.usage.cacheReadTokens === 30));
  assert(events.some((e) => e.type === "done" && e.reason === "tool-use"));
});
Deno.test("Kiro rejects empty responses, null content and unfinished tool JSON", async () => {
  for (
    const chunks of [[], [frame("assistantResponseEvent", { content: null })], [
      frame("toolUseEvent", { toolUseId: "t", name: "read", input: '{"path":', stop: false }),
    ]]
  ) await rejects(() => consume(binary(chunks).lines, { emit() {} }));
});
Deno.test("Kiro recognizes fragmented JSON quota errors even with HTTP 200", async () => {
  const raw = new TextEncoder().encode('{"__type":"ServiceQuotaExceededException"}');
  let status = 0;
  try {
    await consume(binary([raw.slice(0, 13), raw.slice(13)]).lines, { emit() {} });
  } catch (e) {
    if (e instanceof AccountError) status = e.status;
  }
  eq(status, 402);
});
Deno.test("Kiro OAuth uses the application access token and keeps identity tokens separate", () => {
  const next = applyToken(credential(), {
    accessToken: "application",
    idToken: "identity",
    expiresIn: 3600,
  });
  eq(next.access_token, "application");
  let failed = false;
  try {
    applyToken(credential(), { idToken: "identity", expiresIn: 3600 });
  } catch {
    failed = true;
  }
  assert(failed);
});
Deno.test("Kiro Builder ID registration honors device timing and slow-down", async () => {
  const method = oauth("us-east-1");
  let n = 0;
  const start = await method.begin(context({
    fetch(url) {
      n++;
      assert(url.startsWith("https://oidc.us-east-1.amazonaws.com"));
      return n === 1
        ? response({
          clientId: "registered",
          clientSecret: "private",
          clientSecretExpiresAt: 1900000000,
        })
        : response({
          deviceCode: "device",
          userCode: "CODE",
          verificationUriComplete: "https://view.awsapps.com/start/#/device",
          expiresIn: 900,
          interval: 7,
        });
    },
  }));
  eq(start.pollIntervalMs, 7000);
  assert(start.expiresAtMs <= Date.now() + 600000);
  eq(
    (await method.poll(
      start.session,
      context({ fetch: () => response({ error: "slow_down" }, 400) }),
    )).status,
    "slow-down",
  );
  const result = await method.poll(
    start.session,
    context({
      fetch: () =>
        response({
          accessToken: "access",
          refreshToken: "refresh",
          idToken: "do-not-use",
          expiresIn: 3600,
        }),
    }),
  );
  assert(result.status === "completed");
  eq((result.resources[0].privateData as Record<string, JsonValue>).access_token, "access");
  eq(trustedURL("https://evil.example/start"), false);
});
Deno.test("Kiro pools separate clients and API keys without assigning fake expirations", async () => {
  const a = await draft(credential()), b = await draft(credential({ client_id: "client-two" }));
  assert(a.key !== b.key);
  eq(a.key, (await draft(credential({ access_token: "new" }))).key);
  const key = normalize({ api_key: "ksk_test", expires_at: 2000000000 }, "us-east-1");
  eq(key.expires_at, null);
  eq(await fresh(key, context()), key);
});
Deno.test("Kiro catalog uses regional metadata for OAuth and the Q endpoint for API keys", async () => {
  for (const d of [credential(), credential({ api_key: "ksk_test", auth_method: "api_key" })]) {
    let page = 0;
    const rows = await models(
      d,
      context({
        fetch(url, init) {
          assert(url.includes(d.api_key ? "q.us-east-1" : "codewhisperer.us-east-1"));
          eq(init.headers?.["x-amz-target"], "AmazonCodeWhispererService.ListAvailableModels");
          if (d.api_key) eq(init.headers?.TokenType, "API_KEY");
          page++;
          return response({
            models: [{
              modelId: "native-model",
              modelName: "Actual model",
              tokenLimits: { maxOutputTokens: 8000 },
            }],
            ...(page === 1 ? { nextToken: "next" } : {}),
          });
        },
      }),
    );
    eq(rows.length, 1);
    eq(rows[0].maxOutputTokens, 8000);
  }
});
Deno.test("Kiro native history preserves system text, tool ownership and the original request", () => {
  const r = request();
  r.messages.push({
    role: "assistant",
    text: "",
    thinking: "",
    replayState: null,
    toolCalls: [{ index: 0, callId: "c", name: "read", arguments: { path: "a" } }],
  }, { role: "tool", callId: "c", name: "read", content: "result", isError: false, parts: [] });
  r.tools = [{ name: "read", description: "Read", parameters: { type: "object" } }];
  const before = JSON.stringify(r), native = body(r, "native-model", credential());
  const history = native.conversationState.history as Record<string, Record<string, unknown>>[];
  assert(String(history[0].userInputMessage.content).includes("Follow the project rules."));
  eq(
    (native.conversationState.currentMessage.userInputMessage.userInputMessageContext as Record<
      string,
      unknown[]
    >).toolResults.length,
    1,
  );
  eq(JSON.stringify(r), before);
});
Deno.test("Kiro moves a completed turn to history without rewriting its content or tools", () => {
  const r = request();
  r.tools = [{ name: "read", description: "Read", parameters: { type: "object" } }];
  const first = body(r, "native-model", credential()).conversationState.currentMessage;
  r.messages.push({
    role: "assistant",
    text: "first answer",
    thinking: "",
    replayState: null,
    toolCalls: [],
  });
  r.messages.push({ role: "system", content: [{ type: "text", text: "new request context" }] });
  r.messages.push({ role: "user", content: [{ type: "text", text: "second question" }] });
  const second = body(r, "native-model", credential()).conversationState;
  eq(second.history?.[0], first);
  assert(String(second.currentMessage.userInputMessage.content).includes("new request context"));
});
Deno.test("Kiro generation chooses one endpoint and delivers binary mode through the host", async () => {
  const d = credential({ api_key: "ksk_test", auth_method: "api_key" }), events: ModelEvent[] = [];
  const result = await provider("us-east-1").invoke(
    {
      resource: await snapshot(d),
      model: { id: "native", displayName: "Native" },
      request: request(),
    },
    { emit: (e) => events.push(e) },
    context({
      stream(url, init) {
        eq(url, "https://q.us-east-1.amazonaws.com/");
        eq(init.responseEncoding, "base64");
        eq(init.headers?.TokenType, "API_KEY");
        return binary([frame("assistantResponseEvent", { content: "OK" })]);
      },
    }),
  );
  eq(result.status, "completed");
  assert(events.some((e) => e.type === "text-delta" && e.text === "OK"));
});
Deno.test("Kiro Credits exclude expired bonuses and preserve fractional amounts", async () => {
  const resource = plugin.resources![0], snap = await snapshot();
  const patch = await resource.refresh!(
    snap,
    context({
      fetch: () =>
        response({
          subscriptionInfo: { subscriptionTitle: "Pro" },
          usageBreakdownList: [{
            resourceType: "CREDIT",
            unit: "INVOCATIONS",
            usageLimitWithPrecision: 100.5,
            currentUsageWithPrecision: 20.25,
            bonuses: [{ status: "ACTIVE", expiresAt: 1, usageLimit: 999, currentUsage: 0 }, {
              status: "ACTIVE",
              expiresAt: 2000000000,
              usageLimit: 5,
              currentUsage: 1,
            }],
          }],
        }),
    }),
  );
  eq(resource.present({ ...snap, privateData: patch.privateData! }).metrics?.[0].value, 84.25);
});
