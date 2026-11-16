import type { JsonValue, PluginContext } from "cursor-byok:plugin";
import type {
  ResourceAction,
  ResourceDraft,
  ResourceImportSupport,
  ResourcePatch,
  ResourceSnapshot,
  ResourceState,
  ResourceView,
} from "cursor-byok:resource";
import {
  type AccountData,
  accountData,
  accountHeaders,
  ApiError,
  billingBase,
  type CreditPackage,
  type Credits,
  freshAccount,
  number,
  object,
  type Realm,
  refreshToken,
  request,
  resourceType,
  text,
} from "./api.ts";

export function credentialDraft(data: AccountData): ResourceDraft {
  if (!data.uid.trim() || !data.accessToken.trim()) {
    throw new Error("WorkBuddy credentials require a UID and access token");
  }
  // A nickname is presentation, never account identity. Enterprise spaces have separate credentials.
  return {
    key: `workbuddy:${data.realm}:${data.uid}:${data.enterpriseId ?? "personal"}`,
    privateData: data as unknown as JsonValue,
  };
}
export function creditsState(credits: Credits | null): ResourceState {
  return credits?.remaining === 0
    ? {
      status: "cooling",
      retryAtMs: Date.now() + 5 * 60_000,
      message: "WorkBuddy credits exhausted; refresh after topping up",
    }
    : { status: "ready" };
}
export function parseSummary(value: unknown, nowMs = Date.now()): Credits {
  const data = object(value);
  if (!Array.isArray(data?.Packages)) {
    throw new Error("WorkBuddy balance response is missing Packages");
  }
  let remaining = 0, total = 0;
  for (const raw of data.Packages) {
    const p = object(raw);
    const remain = number(p?.CycleRemainCapacity);
    const size = number(p?.CycleTotalCapacity);
    if (remain === null || size === null) {
      throw new Error("WorkBuddy balance contains invalid capacity fields");
    }
    remaining += Math.max(0, Math.min(remain, Math.max(0, size)));
    total += Math.max(0, size);
  }
  return { remaining, total, packages: [], updatedAtMs: nowMs };
}
function timestamp(value: unknown): number | null {
  const numeric = number(value);
  if (numeric !== null) return numeric > 100_000_000_000 ? numeric : numeric * 1000;
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(
    /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? raw.replace(" ", "T") + "+08:00" : raw,
  );
  return Number.isFinite(parsed) ? parsed : null;
}
export function parsePackages(value: unknown): CreditPackage[] {
  const data = object(value);
  if (!Array.isArray(data?.Accounts)) {
    throw new Error("WorkBuddy package response is missing Accounts");
  }
  return data.Accounts.map((raw) => {
    const p = object(raw) ?? {};
    const cycleSize = number(p.CycleCapacitySizePrecise) ?? number(p.CycleCapacitySize);
    const cycle = cycleSize !== null && cycleSize > 0;
    const total = Math.max(
      0,
      (cycle ? cycleSize : number(p.CapacitySizePrecise) ?? number(p.CapacitySize)) ?? 0,
    );
    const remaining = Math.max(
      0,
      Math.min(
        total,
        (cycle
          ? number(p.CycleCapacityRemainPrecise) ?? number(p.CycleCapacityRemain)
          : number(p.CapacityRemainPrecise) ?? number(p.CapacityRemain)) ?? 0,
      ),
    );
    return {
      name: text(p.PackageName) ?? text(p.PackageCode) ?? "WorkBuddy credits",
      remaining,
      total,
      expiresAtMs: timestamp(p.DeductionEndTime) || timestamp(p.ExpiredTime) ||
        timestamp(p.CycleEndTime),
    };
  });
}
export async function queryCredits(data: AccountData, context: PluginContext): Promise<Credits> {
  const headers = { ...accountHeaders(data), "user-agent": "axios/1.16.1" };
  if (data.enterpriseId) {
    const result = object(
      await request(
        context,
        `${billingBase(data)}/v2/billing/meter/get-enterprise-user-usage`,
        headers,
        "POST",
        {},
      ),
    );
    const total = number(result?.limitNum ?? result?.limit_num);
    const used = number(result?.credit ?? result?.used_num);
    if (total === null || used === null) {
      throw new Error("WorkBuddy enterprise balance is incomplete");
    }
    return {
      remaining: total < 0 ? null : Math.max(0, total - used),
      total: total < 0 ? null : total,
      packages: [],
      updatedAtMs: Date.now(),
    };
  }
  return parseSummary(
    await request(
      context,
      `${billingBase(data)}/billing/meter/get-user-resource-summary`,
      headers,
      "POST",
      {},
    ),
  );
}
export async function refreshAccount(
  resource: ResourceSnapshot,
  context: PluginContext,
): Promise<ResourcePatch> {
  let data = accountData(resource);
  try {
    data = await freshAccount(data, context);
    let credits;
    try {
      credits = await queryCredits(data, context);
    } catch (error) {
      if (
        !(error instanceof ApiError && (error.status === 401 || error.code === 12153)) ||
        !data.refreshToken ||
        data.accessToken !== accountData(resource).accessToken
      ) throw error;
      data = await refreshToken(data, context);
      credits = await queryCredits(data, context);
    }
    data = { ...data, credits };
    return { privateData: data as unknown as JsonValue, state: creditsState(data.credits) };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.code === 12153)) {
      return {
        privateData: data as unknown as JsonValue,
        state: { status: "invalid", message: "WorkBuddy authorization expired; sign in again" },
      };
    }
    if (data.accessToken !== accountData(resource).accessToken) {
      return {
        privateData: data as unknown as JsonValue,
        state: {
          status: "cooling",
          retryAtMs: Date.now() + 60_000,
          message: "Credentials refreshed; balance lookup failed, retry refresh",
        },
      };
    }
    throw error;
  }
}
export function presentAccount(resource: ResourceSnapshot): ResourceView {
  const data = accountData(resource);
  const credits = data.credits;
  return {
    displayName: data.displayName,
    description: data.enterpriseId
      ? { "en-US": "WorkBuddy Enterprise", "zh-CN": "WorkBuddy 企业账号" }
      : data.uid,
    metrics: credits
      ? [
        ...(credits.remaining !== null
          ? [{
            id: "credits",
            label: { "en-US": "Credit balance", "zh-CN": "积分余额" },
            unit: "count" as const,
            value: credits.remaining,
          }]
          : []),
        ...(credits.total !== null
          ? [{
            id: "credits-total",
            label: { "en-US": "Total credits", "zh-CN": "积分总额" },
            unit: "count" as const,
            value: credits.total,
          }]
          : []),
      ]
      : [],
  };
}
export const creditPackagesAction: ResourceAction = {
  id: "credit-packages",
  displayName: { "en-US": "Credit packages", "zh-CN": "积分明细" },
  async run(resource, _input, context) {
    const patch = await refreshAccount(resource, context);
    if (patch.state?.status === "invalid") {
      return {
        title: { "en-US": "Authorization expired", "zh-CN": "授权已过期" },
        description: { "en-US": "Sign in to WorkBuddy again", "zh-CN": "请重新登录 WorkBuddy" },
        patch,
        cards: [],
      };
    }
    const data = accountData({
      ...resource,
      privateData: patch.privateData ?? resource.privateData,
    });
    if (data.enterpriseId) {
      return {
        title: { "en-US": "Enterprise credits", "zh-CN": "企业积分" },
        patch,
        description: data.credits?.remaining === null
          ? { "en-US": "Unlimited", "zh-CN": "不限量" }
          : String(data.credits?.remaining ?? ""),
        cards: [],
      };
    }
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const packages: CreditPackage[] = [];
    try {
      for (const kind of ["paid", "free"]) {
        for (let page = 1; page <= 100; page++) {
          const result = await request(
            context,
            `${billingBase(data)}/billing/meter/get-user-resource-${kind}-packages`,
            accountHeaders(data),
            "POST",
            {
              PageNumber: page,
              PageSize: 200,
              Status: [0, 3],
              ...(kind === "paid" ? { NeedRenewInfo: true } : {
                SlicePeriodStartTime: `${day} 00:00:00`,
                SlicePeriodEndTime: `${day} 23:59:59`,
              }),
            },
          );
          const entries = parsePackages(result);
          packages.push(...entries);
          if (entries.length < 200) break;
          if (page === 100) throw new Error("WorkBuddy returned too many credit package pages");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        title: { "en-US": "Package lookup failed", "zh-CN": "积分明细查询失败" },
        description: message,
        patch,
        cards: [],
      };
    }
    return {
      title: { "en-US": "WorkBuddy credit packages", "zh-CN": "WorkBuddy 积分明细" },
      patch,
      cards: packages.map((p, index) => ({
        id: String(index),
        title: p.name,
        ...(p.expiresAtMs !== null ? { expiresAtMs: p.expiresAtMs } : {}),
        fields: [{
          id: "remaining",
          label: { "en-US": "Remaining / total", "zh-CN": "剩余 / 总额" },
          value: `${p.remaining} / ${p.total}`,
        }],
      })),
    };
  },
};
export const checkInAction: ResourceAction = {
  id: "daily-checkin",
  displayName: { "en-US": "Daily check-in", "zh-CN": "每日签到" },
  async run(resource, _input, context) {
    let data = accountData(resource);
    if (data.realm !== "cn" || data.enterpriseId) {
      throw new Error("Daily check-in is available for WorkBuddy China personal accounts");
    }
    try {
      data = await freshAccount(data, context);
      try {
        await request(
          context,
          `${billingBase(data)}/v2/billing/meter/daily-checkin`,
          accountHeaders(data),
          "POST",
          {},
        );
      } catch (error) {
        if (
          !(error instanceof ApiError &&
            /already.*check|已签到|已签过|重复签到/i.test(error.message))
        ) throw error;
      }
      return {
        title: { "en-US": "Check-in completed", "zh-CN": "签到完成" },
        cards: [],
        patch: await refreshAccount(
          { ...resource, privateData: data as unknown as JsonValue },
          context,
        ),
      };
    } catch (error) {
      return {
        title: { "en-US": "Check-in failed", "zh-CN": "签到失败" },
        description: error instanceof Error ? error.message : String(error),
        cards: [],
        patch: {
          privateData: data as unknown as JsonValue,
          ...(error instanceof ApiError && (error.status === 401 || error.code === 12153)
            ? { state: { status: "invalid" as const, message: "Sign in to WorkBuddy again" } }
            : {}),
        },
      };
    }
  },
};

export function credentialImport(realm: Realm): ResourceImportSupport {
  return {
    displayName: { "en-US": "Import WorkBuddy credentials", "zh-CN": "导入 WorkBuddy 凭证" },
    accept: [".json"],
    multiple: true,
    async parse(files) {
      const resources: ResourceDraft[] = [], warnings: string[] = [];
      function collect(value: unknown): void {
        if (Array.isArray(value)) {
          for (const item of value) collect(item);
          return;
        }
        const raw = object(value);
        if (!raw || raw.disabled === true) return;
        if (Array.isArray(raw.accounts)) {
          collect(raw.accounts);
          return;
        }
        const auth = object(raw.auth) ?? raw, account = object(raw.account) ?? raw;
        const uid = text(account.uid), accessToken = text(auth.accessToken);
        if (!uid || !accessToken) throw new Error("Missing WorkBuddy UID or accessToken");
        const domain = text(auth.domain);
        const actualRealm: Realm =
          auth.realm === "global" || /(?:^|\.)(?:workbuddy|codebuddy)\.ai$/i.test(domain ?? "")
            ? "global"
            : "cn";
        if (actualRealm !== realm) {
          throw new Error(`Import these credentials into the ${actualRealm} WorkBuddy pool`);
        }
        const expiry = number(auth.expiresAtMs) ?? timestamp(auth.expiresAt);
        resources.push(
          credentialDraft({
            realm,
            uid,
            accessToken,
            refreshToken: text(auth.refreshToken),
            expiresAtMs: expiry,
            domain,
            enterpriseId: text(account.enterpriseId),
            displayName: text(account.nickname) ?? text(raw.displayName) ?? uid,
            deviceToken: text(raw.deviceToken) ?? text(raw.device_token),
            credits: null,
          }),
        );
      }
      for (const file of files) {
        try {
          collect(JSON.parse(file.content));
        } catch (error) {
          warnings.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!resources.length) throw new Error(warnings.join("; ") || "No WorkBuddy accounts found");
      return { resources, warnings };
    },
  };
}
