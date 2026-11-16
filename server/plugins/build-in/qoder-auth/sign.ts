import { Buffer } from "node:buffer";
import { constants, createCipheriv, createHash, publicEncrypt } from "node:crypto";
import { base64 } from "cursor-byok:accounts";
import { type Data, regions, VERSION } from "./api.ts";
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
const ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
export function encodeBody(raw: string): string {
  const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const b = base64(new TextEncoder().encode(raw)).split("").map((c) =>
    c === "=" ? "$" : ALPHABET[standard.indexOf(c)]
  ).join("");
  const n = Math.floor(b.length / 3);
  return b.slice(b.length - n) + b.slice(n, b.length - n) + b.slice(0, n);
}
export function signed(value: Data, path: string, raw: unknown, model = "") {
  const key = new TextEncoder().encode(crypto.randomUUID().replaceAll("-", "").slice(0, 16));
  const info = JSON.stringify({
    aid: value.uid,
    uid: value.uid,
    name: value.name,
    yx_uid: "",
    organization_id: value.organization_id,
    organization_name: value.organization_name,
    user_type: value.user_type,
    security_oauth_token: value.access_token,
    refresh_token: value.refresh_token,
  });
  const cipher = createCipheriv("aes-128-cbc", key, key);
  const encrypted = Buffer.concat([cipher.update(info, "utf8"), cipher.final()]).toString("base64");
  const cosyKey = publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING }, key)
    .toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      version: "v1",
      requestId: crypto.randomUUID(),
      info: encrypted,
      cosyVersion: VERSION,
      ideVersion: "",
    }),
  ).toString("base64");
  const body = encodeBody(JSON.stringify(raw)), date = String(Math.floor(Date.now() / 1000));
  const signedPath = path.split("?")[0].replace(/^\/algo/, "");
  const digest = createHash("md5").update([payload, cosyKey, date, body, signedPath].join("\n"))
    .digest("hex");
  return {
    url: regions[value.scope].inference + path,
    body,
    headers: {
      "content-type": "application/json",
      accept: model ? "text/event-stream" : "application/json",
      authorization: `Bearer COSY.${payload}.${digest}`,
      "cosy-key": cosyKey,
      "cosy-date": date,
      "cosy-user": value.uid,
      "cosy-version": VERSION,
      "cosy-clienttype": "5",
      "cosy-machineid": value.machine_id,
      "cosy-machineos": `${Deno.build.arch}_${Deno.build.os === "windows" ? "win32" : Deno.build.os}`,
      "cosy-business-product": "cli",
      "cosy-business-type": "agent",
      "cosy-scene": "assistant",
      "cosy-data-policy": "agree",
      "login-version": "v2",
      "user-agent": `qoder/${VERSION}`,
      ...(value.organization_id ? { "cosy-organization-id": value.organization_id } : {}),
      ...(value.organization_tags.length
        ? { "cosy-organization-tags": value.organization_tags.join(",") }
        : {}),
      ...(model ? { "x-model-key": model, "x-model-source": "system" } : {}),
    },
  };
}
