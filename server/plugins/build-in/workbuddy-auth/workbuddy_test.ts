import type {
  JsonValue,
  NetworkEventStream,
  NetworkRequestInit,
  NetworkResponse,
  PluginContext,
} from "cursor-byok:plugin";
import type { LlmRequest, ModelEvent } from "cursor-byok:provider";
import type { ResourceSnapshot } from "cursor-byok:resource";
import { type AccountData, chatBase, resourceType } from "./api.ts";
import { loginHeaders, workbuddyOAuth } from "./oauth.ts";
import { parseModels } from "./models.ts";
import { chatHeaders, prepareBody, workbuddyProvider } from "./provider.ts";
import {
  credentialDraft,
  credentialImport,
  creditPackagesAction,
  parsePackages,
  parseSummary,
  presentAccount,
  refreshAccount,
} from "./resources.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}
function data(overrides: Partial<AccountData> = {}): AccountData {
  return {
    realm: "cn",
    uid: "user-1",
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    expiresAtMs: Date.now() + 3600_000,
    domain: "www.workbuddy.cn",
    enterpriseId: null,
    displayName: "Same nickname",
    deviceToken: "device-secret",
    credits: null,
    ...overrides,
  };
}
function snapshot(value = data()): ResourceSnapshot {
  const draft = credentialDraft(value);
  return { ...draft, type: resourceType(value.realm), id: "resource", state: { status: "ready" } };
}
function request(): LlmRequest {
  return {
    instructions: "Be helpful",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    tools: [],
    reasoning: { enabled: true, effort: "high" },
    latency: "standard",
    maxOutputTokens: 2000,
    cacheKey: "conversation",
  };
}
function response(value: unknown, status = 200): NetworkResponse {
  return { status, headers: {}, body: JSON.stringify(value) };
}
function success(value: unknown): NetworkResponse {
  return response({ code: 0, data: value });
}
function stream(payloads: unknown[], status = 200): NetworkEventStream {
  return {
    status,
    headers: {},
    lines: (async function* () {
      for (const p of payloads) {
        yield status === 200
          ? `data: ${typeof p === "string" ? p : JSON.stringify(p)}`
          : JSON.stringify(p);
      }
    })(),
  };
}
function context(handlers: {
  fetch?: (url: string, init: NetworkRequestInit) => NetworkResponse;
  stream?: (url: string, init: NetworkRequestInit) => NetworkEventStream;
}): PluginContext {
  return {
    signal: new AbortController().signal,
    network: {
      async fetch(url, init = {}) {
        if (!handlers.fetch) throw new Error(`unexpected fetch ${url}`);
        return handlers.fetch(url, init);
      },
      async stream(url, init = {}) {
        if (!handlers.stream) throw new Error(`unexpected stream ${url}`);
        return handlers.stream(url, init);
      },
    },
  };
}

Deno.test("current device login uses WorkBuddy platform and endpoint-specific headers", async () => {
  const oauth = workbuddyOAuth("cn");
  const begun = await oauth.begin(context({
    fetch(url, init) {
      eq(url, "https://copilot.tencent.com/v2/plugin/auth/state?platform=workbuddy");
      eq(init.headers?.["x-domain"], "www.workbuddy.cn");
      eq(init.headers?.["x-no-authorization"], "true");
      assert(
        !init.headers?.origin && !init.headers?.referer,
        "device endpoints do not use browser origin headers",
      );
      return success({
        state: "state+one",
        authUrl: "https://www.workbuddy.cn/login?state=state%2Bone",
      });
    },
  }));
  const url = new URL(begun.verificationUrl);
  eq(url.searchParams.get("version"), "5.11.3");
  assert(url.searchParams.get("loginSessionId"));
  const completed = await oauth.poll(
    begun.session,
    context({
      fetch(url, init) {
        assert(url.endsWith("?state=state%2Bone"));
        if (url.includes("/auth/token")) {
          assert(!init.headers?.["x-domain"]);
          return success({
            accessToken: "secret",
            refreshToken: "refresh",
            expiresIn: 3600,
            domain: "www.workbuddy.cn",
          });
        }
        eq(init.headers?.authorization, "Bearer secret");
        assert(!init.headers?.["x-no-authorization"]);
        return success({ uid: "user-1", nickname: "Same nickname" });
      },
    }),
  );
  assert(completed.status === "completed");
  eq(completed.resources[0].key, "workbuddy:cn:user-1:personal");
  assert(
    !JSON.stringify(
      presentAccount({ ...snapshot(), privateData: completed.resources[0].privateData }),
    ).includes("secret"),
  );
});
Deno.test("international login uses the official codebuddy.ai site", async () => {
  const begun = await workbuddyOAuth("global").begin(context({
    fetch(url, init) {
      eq(url, "https://www.codebuddy.ai/v2/plugin/auth/state?platform=workbuddy-ai");
      eq(init.headers?.["x-domain"], "www.codebuddy.ai");
      return success({ state: "state", authUrl: "https://www.codebuddy.ai/login?state=state" });
    },
  }));
  eq(new URL(begun.verificationUrl).searchParams.get("version"), "5.9.4");
  eq(chatBase(data({ realm: "global", domain: "www.workbuddy.ai" })), "https://www.workbuddy.ai");
  eq(chatBase(data({ realm: "global", domain: "evil-codebuddy.ai" })), "https://www.codebuddy.ai");
});
Deno.test("login rejects an unrelated authorization host", async () => {
  let rejected = false;
  try {
    await workbuddyOAuth("cn").begin(
      context({ fetch: () => success({ state: "x", authUrl: "https://attacker.example/login" }) }),
    );
  } catch {
    rejected = true;
  }
  assert(rejected);
});
Deno.test("login pending and terminal license codes remain distinct", async () => {
  for (const code of [11217, 12151, 12005, 11212, 11216]) {
    const result = await workbuddyOAuth("cn").poll(
      { state: "x", realm: "cn" },
      context({ fetch: () => response({ code, msg: "upstream status" }) }),
    );
    eq(result.status, [11217, 12151].includes(code) ? "pending" : "failed");
  }
  eq(loginHeaders("cn", "token")["content-type"], undefined);
});
Deno.test("account provisioning pending after token issuance does not discard the login", async () => {
  const result = await workbuddyOAuth("cn").poll(
    { state: "x", realm: "cn" },
    context({
      fetch(url) {
        return url.includes("/auth/token")
          ? success({ accessToken: "secret" })
          : response({ code: 12151, msg: "provisioning" });
      },
    }),
  );
  eq(result.status, "pending");
});
Deno.test("different UIDs with the same nickname coexist and repeat login keeps the same identity", () => {
  const first = credentialDraft(data());
  const second = credentialDraft(data({ uid: "user-2" }));
  assert(first.key !== second.key);
  eq(first.key, credentialDraft(data({ accessToken: "new-token", displayName: "New name" })).key);
  assert(first.key !== credentialDraft(data({ enterpriseId: "enterprise" })).key);
});
Deno.test("imports nested and flat credentials and normalizes expiry seconds and milliseconds", async () => {
  const result = await credentialImport("cn").parse([{
    name: "auth.json",
    content: JSON.stringify([
      {
        auth: { accessToken: "one", refreshToken: "r", expiresAt: 1_900_000_000 },
        account: { uid: "one", nickname: "same" },
      },
      { accessToken: "two", uid: "two", nickname: "same", expiresAt: 1_900_000_000_000 },
    ]),
  }], context({}));
  eq(result.resources.length, 2);
  eq((result.resources[0].privateData as Record<string, JsonValue>).expiresAtMs, 1_900_000_000_000);
  eq((result.resources[1].privateData as Record<string, JsonValue>).expiresAtMs, 1_900_000_000_000);
});
Deno.test("balance summaries retain fractional credits and malformed responses do not turn into zero", () => {
  const credits = parseSummary({
    Packages: [{ CycleRemainCapacity: "335.47000026", CycleTotalCapacity: "500" }],
  }, 100);
  eq(credits.remaining, 335.47000026);
  eq(credits.total, 500);
  let rejected = false;
  try {
    parseSummary({});
  } catch {
    rejected = true;
  }
  assert(rejected);
});
Deno.test("package precise zero wins over rounded fields and expiry is interpreted in China time", () => {
  const packages = parsePackages({
    Accounts: [{
      PackageName: "Daily",
      CapacityRemain: 20,
      CapacityRemainPrecise: "0",
      CapacitySize: 30,
      CycleEndTime: "2026-12-01 00:00:00",
    }],
  });
  eq(packages[0].remaining, 0);
  eq(packages[0].expiresAtMs, Date.parse("2026-11-30T16:00:00Z"));
});
Deno.test("refresh persists rotated tokens and a live credit balance", async () => {
  const patch = await refreshAccount(
    snapshot(data({ expiresAtMs: 1 })),
    context({
      fetch(url, init) {
        if (url.endsWith("/token/refresh")) {
          eq(init.headers?.["x-refresh-token"], "refresh-secret");
          return success({
            accessToken: "new-access",
            refreshToken: "new-refresh",
            expiresIn: 3600,
          });
        }
        eq(url, "https://www.workbuddy.cn/billing/meter/get-user-resource-summary");
        eq(init.headers?.authorization, "Bearer new-access");
        assert(!init.headers?.["x-refresh-token"]);
        return success({ Packages: [{ CycleRemainCapacity: 125, CycleTotalCapacity: 200 }] });
      },
    }),
  );
  eq((patch.privateData as Record<string, JsonValue>).accessToken, "new-access");
  eq(patch.state?.status, "ready");
  eq(presentAccount({ ...snapshot(), privateData: patch.privateData! }).metrics?.[0].value, 125);
});
Deno.test("model catalog includes capabilities and excludes disabled/media entries", () => {
  const models = parseModels({
    models: [
      {
        id: "gpt-test",
        name: "GPT",
        supportsToolCall: true,
        supportsImages: true,
        maxOutputTokens: 32000,
        supportsReasoning: true,
        reasoning: { supportedEfforts: ["low", "high"] },
      },
      { id: "disabled", disabled: true },
      { id: "image-model" },
      { id: "no-tools", supportsToolCall: false },
    ],
  });
  eq(models.map((m) => m.id), ["gpt-test"]);
  eq(models[0].capabilities?.images, true);
});
Deno.test("protocol adapter preserves canonical history and maps WorkBuddy token/reasoning fields", () => {
  const r = request();
  r.messages.push({
    role: "assistant",
    text: "prior",
    thinking: "",
    toolCalls: [],
    replayState: null,
  });
  const before = JSON.stringify(r);
  const body = prepareBody(r, {
    id: "deepseek-test",
    displayName: "DeepSeek",
    privateData: { supportsReasoning: true, reasoningEfforts: ["high"] },
  }, data());
  eq(body.max_tokens, 2000);
  eq(body.max_completion_tokens, undefined);
  eq(body.thinking, { type: "enabled" });
  eq(JSON.stringify(r), before);
});
Deno.test("conversation and cache affinity are stable per account and isolated between accounts", async () => {
  const a = await chatHeaders(data(), "conversation"),
    again = await chatHeaders(data(), "conversation"),
    b = await chatHeaders(data({ uid: "user-2" }), "conversation");
  eq(a["x-conversation-id"], again["x-conversation-id"]);
  assert(a["x-conversation-id"] !== b["x-conversation-id"]);
  assert(!a["x-refresh-token"] && !a["x-no-authorization"]);
});
Deno.test("invoke streams text, incremental tool calls, usage, and completion", async () => {
  const events: ModelEvent[] = [];
  const result = await workbuddyProvider("cn").invoke(
    { resource: snapshot(), model: { id: "model", displayName: "Model" }, request: request() },
    {
      emit: (e) => events.push(e),
    },
    context({
      stream(url, init) {
        eq(url, "https://www.workbuddy.cn/v2/chat/completions");
        const body = JSON.parse(init.body!);
        eq(body.max_tokens, 2000);
        assert(!body.max_completion_tokens);
        assert(body.prompt_cache_key.startsWith("cursor-byok-"));
        return stream([
          { choices: [{ delta: { content: "hello" } }] },
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call-1",
                  function: { name: "read", arguments: '{"path":' },
                }],
              },
            }],
          },
          {
            choices: [{
              delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] },
              finish_reason: "tool_calls",
            }],
          },
          {
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 50 },
            choices: [],
          },
          "[DONE]",
        ]);
      },
    }),
  );
  eq(result.status, "completed");
  assert(events.some((e) => e.type === "text-delta" && e.text === "hello"));
  assert(events.some((e) => e.type === "tool-call-start" && e.name === "read"));
  assert(events.some((e) => e.type === "usage" && e.usage.cacheReadTokens === 50));
  assert(events.some((e) => e.type === "done" && e.reason === "tool-use"));
});
Deno.test("401 before output refreshes once and saves new credentials", async () => {
  let attempts = 0;
  const result = await workbuddyProvider("cn").invoke(
    { resource: snapshot(), model: { id: "model", displayName: "Model" }, request: request() },
    { emit() {} },
    context({
      fetch: () =>
        success({ accessToken: "rotated", refreshToken: "rotated-refresh", expiresIn: 3600 }),
      stream(_url, init) {
        attempts++;
        if (attempts === 1) {
          return stream([{ code: 12153, msg: "expired" }], 401);
        }
        eq(init.headers?.authorization, "Bearer rotated");
        return stream([
          { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] },
          "[DONE]",
        ]);
      },
    }),
  );
  eq(attempts, 2);
  eq(result.status, "completed");
  eq((result.patch?.privateData as Record<string, JsonValue>).refreshToken, "rotated-refresh");
});
Deno.test("quota exhaustion inside a 200 SSE becomes a cooling account error", async () => {
  const result = await workbuddyProvider("cn").invoke(
    { resource: snapshot(), model: { id: "model", displayName: "Model" }, request: request() },
    { emit() {} },
    context({
      stream: () => stream([{ code: 14018, msg: "credits exhausted" }]),
    }),
  );
  eq(result.status, "resource-error");
  eq(result.patch?.state?.status, "cooling");
});
Deno.test("an expired stream after output is not retried with another token", async () => {
  let attempts = 0;
  const result = await workbuddyProvider("cn").invoke(
    { resource: snapshot(), model: { id: "model", displayName: "Model" }, request: request() },
    { emit() {} },
    context({
      stream() {
        attempts++;
        return stream([{ choices: [{ delta: { content: "partial" } }] }, {
          code: 12153,
          msg: "expired",
        }]);
      },
    }),
  );
  eq(attempts, 1);
  eq(result.status, "resource-error");
});

Deno.test("exported account credentials import into the same pool without losing device tokens", async () => {
  const original = data();
  const result = await credentialImport("cn").parse([{
    name: "export.json",
    content: JSON.stringify({ accounts: [original] }),
  }], context({}));
  eq(result.resources.length, 1);
  eq(result.resources[0].key, credentialDraft(original).key);
  eq(
    (result.resources[0].privateData as Record<string, JsonValue>).deviceToken,
    original.deviceToken,
  );
});

Deno.test("model discovery follows the default agent menu and excludes paid variants and media", () => {
  const models = parseModels({
    models: [
      { id: "hidden" },
      { id: "shown" },
      { id: "shown-paid" },
      { id: "fast-model" },
      { id: "seedance", tags: ["text-to-video"] },
      { id: "auto" },
    ],
    agents: [{
      name: "main",
      tags: ["default"],
      models: ["shown", "shown-paid", "seedance", "auto"],
    }],
    productFeaturesConfig: {
      ModelRateLimitCap: { lines: [{ freeId: "shown", paidId: "shown-paid" }] },
    },
  });
  eq(models.map((m) => m.id), ["fast-model", "shown"]);
});

Deno.test("balance refresh renews an expired token even when imported credentials have no expiry", async () => {
  let lookups = 0;
  const patch = await refreshAccount(
    snapshot(data({ expiresAtMs: null })),
    context({
      fetch(url, init) {
        if (url.endsWith("/token/refresh")) {
          return success({
            accessToken: "renewed",
            refreshToken: "renewed-refresh",
            expiresIn: 3600,
          });
        }
        lookups++;
        if (lookups === 1) return response({ code: 12153, msg: "expired" }, 401);
        eq(init.headers?.authorization, "Bearer renewed");
        return success({ Packages: [{ CycleRemainCapacity: 80, CycleTotalCapacity: 100 }] });
      },
    }),
  );
  eq(patch.state?.status, "ready");
  eq((patch.privateData as Record<string, JsonValue>).accessToken, "renewed");
});

Deno.test("failed package lookup still returns refreshed credentials for persistence", async () => {
  const result = await creditPackagesAction.run(
    snapshot(data({ expiresAtMs: 1 })),
    {},
    context({
      fetch(url) {
        if (url.endsWith("/token/refresh")) {
          return success({
            accessToken: "renewed",
            refreshToken: "renewed-refresh",
            expiresIn: 3600,
          });
        }
        if (url.endsWith("-summary")) {
          return success({ Packages: [{ CycleRemainCapacity: 80, CycleTotalCapacity: 100 }] });
        }
        return response({ code: 10000, msg: "temporary billing failure" }, 500);
      },
    }),
  );
  eq((result.patch?.privateData as Record<string, JsonValue>).accessToken, "renewed");
  eq(result.cards?.length, 0);
  assert(result.description);
});

Deno.test("chat propagates account identity claims required by current WorkBuddy endpoints", async () => {
  const token = `header.${
    btoa(JSON.stringify({ id_source: "workbuddy", token_source: "enterprise_switch" }))
  }.signature`;
  const headers = await chatHeaders(
    data({ accessToken: token, enterpriseId: "enterprise-1" }),
    "conversation",
  );
  eq(headers["x-id-source"], "workbuddy");
  eq(headers["x-auth-method"], "enterprise_switch");
  eq(JSON.parse(atob(headers["x-userinfo"])), {
    uin: "user-1",
    owner_uin: "enterprise-1",
    id_source: "workbuddy",
    token_source: "enterprise_switch",
  });
  const personal = await chatHeaders(data({ accessToken: token }), "conversation");
  assert(!personal["x-auth-method"]);
  assert(personal["x-conversation-id"] !== headers["x-conversation-id"]);
});
