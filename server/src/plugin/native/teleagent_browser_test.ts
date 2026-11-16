// Opt-in acceptance test: set CURSOR_BYOK_TEST_BROWSER to Chrome/Edge and grant
// read/write/env/run/net. All authorization traffic is intercepted locally.
import { Buffer } from "node:buffer";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { assert, eq, rejects } from "../../../plugins/test_support.ts";
import { CALLBACK, capturePageLogin, CDP, LOGIN_URL } from "./teleagent.mjs";

const variable = "CURSOR_BYOK_TEST_BROWSER";
const permitted = (await Deno.permissions.query({ name: "env", variable })).state === "granted";
const browser = permitted ? Deno.env.get(variable) : undefined;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

Deno.test({
  name: "native login captures a real isolated browser callback and ignores unrelated pages",
  ignore: !browser,
  async fn() {
    const profile = await Deno.makeTempDir({ prefix: "cursor-byok-teleagent-test-" });
    const child = new Deno.Command(browser!, {
      args: [
        "--headless=new",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-background-networking",
        "--disable-extensions",
        "about:blank",
      ],
      stdout: "null",
      stderr: "null",
    }).spawn();
    let cdp: CDP | undefined;
    let exited = false;
    const status = child.status.then(() => {
      exited = true;
    });
    try {
      let port = 0;
      const started = Date.now();
      while (!port && !exited && Date.now() - started < 20000) {
        try {
          port = Number(
            (await Deno.readTextFile(join(profile, "DevToolsActivePort"))).split("\n")[0],
          );
        } catch { /* Wait for this profile's own debugging endpoint. */ }
        if (!port) await delay(50);
      }
      assert(port > 0 && port < 65536, "isolated browser did not start");
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find((p: { type: string; url: string }) =>
        p.type === "page" && p.url === "about:blank"
      );
      assert(page, "isolated page is missing");
      cdp = await CDP.open(page.webSocketDebuggerUrl, port);
      const connection = cdp;
      const token = "eyJhbGciOiJIUzI1NiJ9." +
        Buffer.from(JSON.stringify({ accountId: "browser-fixture", exp: 2000000000 })).toString(
          "base64url",
        ) + ".fixture";
      let unrelated = false;
      let failure: unknown;
      const fixture = async (
        method: string,
        p: { requestId: string; request: { url: string } },
      ) => {
        if (method !== "Fetch.requestPaused") return;
        try {
          const auth = p.request.url === LOGIN_URL;
          await connection.send("Fetch.fulfillRequest", {
            requestId: p.requestId,
            responseCode: auth ? 302 : 200,
            responseHeaders: auth
              ? [{
                name: "Location",
                value: unrelated ? "https://unrelated.invalid/callback" : CALLBACK,
              }]
              : [{ name: "Content-Type", value: "application/json" }],
            body: auth ? "" : Buffer.from(JSON.stringify({ token })).toString("base64"),
          });
        } catch (error) {
          failure = error;
        }
      };
      connection.listeners.add(fixture);
      await connection.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      });
      const task = {
        version: 1,
        provider: "teleagent",
        challenge: "a".repeat(43),
        url: LOGIN_URL,
        expires_at: Math.floor(Date.now() / 1000) + 60,
      };
      eq(await capturePageLogin(connection, task, AbortSignal.timeout(10000)), token);
      eq(connection.listeners.size, 1);
      unrelated = true;
      await rejects(() => capturePageLogin(connection, task, AbortSignal.timeout(500)));
      eq(connection.listeners.size, 1);
      assert(!failure, "fixture interception failed");
      connection.listeners.delete(fixture);
    } finally {
      await cdp?.send("Browser.close", {}, 1000).catch(() => {});
      cdp?.close();
      await Promise.race([status, delay(2000)]);
      if (!exited) child.kill();
      await status;
      const target = resolve(profile);
      assert(
        dirname(target) === resolve(tmpdir()) &&
          basename(target).startsWith("cursor-byok-teleagent-test-"),
      );
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
});
