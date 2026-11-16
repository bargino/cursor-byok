import type { OAuth2AddMethod } from "cursor-byok:resource";
import { object, text } from "cursor-byok:accounts";
import { draft, LOGIN, normalize, verify } from "./api.ts";
export const oauth: OAuth2AddMethod = {
  type: "oauth2.0",
  id: "teleagent-browser",
  displayName: { "en-US": "Sign in to TeleAgent", "zh-CN": "登录 TeleAgent" },
  description: {
    "en-US":
      "Requires the installed official TeleAgent client. Opens a separate official login window.",
    "zh-CN": "需要安装并启动过 TeleAgent 官方客户端，将打开独立官方登录窗口。",
  },
  async begin(context) {
    if (!context.desktop) throw new Error("Native TeleAgent login is unavailable in this host");
    const job = await context.desktop.beginTeleAgentLogin();
    return {
      session: { id: job.id },
      browserOpened: true,
      userCode: "",
      verificationUrl: LOGIN,
      expiresAtMs: job.expiresAtMs,
      pollIntervalMs: 2000,
    };
  },
  async poll(session, context) {
    const id = text(object(session).id);
    if (!id || !context.desktop) throw new Error("Invalid TeleAgent login session");
    const result = object(await context.desktop.pollTeleAgentLogin(id));
    if (result.status === "pending") return { status: "pending" };
    if (result.status !== "completed") {
      return {
        status: "failed",
        message: text(result.message) || "TeleAgent login failed",
      };
    }
    const d = await verify(normalize(result.credentials, true), context);
    return { status: "completed", resources: [draft(d)] };
  },
  async cancel(session, context) {
    const id = text(object(session).id);
    if (id) await context.desktop?.cancelTeleAgentLogin(id);
  },
};
