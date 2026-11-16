import type { ProviderOutput } from "cursor-byok:provider";
import { AccountError, object, text, unbase64 } from "cursor-byok:accounts";
const decoder = new TextDecoder("utf-8", { fatal: true });
export function crc32(b: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of b) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function exception(code: string): AccountError {
  code = code.split("#").at(-1)!.split(":")[0];
  const lower = code.toLowerCase();
  const status = /unauthorized|unrecognizedclient|expiredtoken/.test(lower)
    ? 401
    : /paymentrequired|servicequotaexceeded/.test(lower)
    ? 402
    : /throttling|toomanyrequests/.test(lower)
    ? 429
    : /accessdenied/.test(lower)
    ? 403
    : /validation/.test(lower)
    ? 400
    : 502;
  return new AccountError(
    status,
    status === 502 ? "Kiro upstream service failed" : `Kiro upstream exception (${code})`,
  );
}
export async function* frames(lines: AsyncIterable<string>) {
  let b = new Uint8Array(0);
  for await (const line of lines) {
    const chunk = unbase64(line);
    const next = new Uint8Array(b.length + chunk.length);
    next.set(b);
    next.set(chunk, b.length);
    b = next;
    if (/^\s*\{/.test(new TextDecoder().decode(b.subarray(0, 16)))) {
      if (b.length > 65536) throw new Error("Kiro JSON error response too large");
      continue;
    }
    while (b.length >= 12) {
      const view = new DataView(b.buffer, b.byteOffset, b.byteLength),
        total = view.getUint32(0),
        hlen = view.getUint32(4);
      if (
        total < 16 || total > (8 << 20) || hlen > (128 << 10) || hlen > total - 16 ||
        crc32(b.subarray(0, 8)) !== view.getUint32(8)
      ) {
        if (b[0] === 123 && b.length <= 65536) {
          const e = object(JSON.parse(decoder.decode(b)));
          throw exception(text(e.__type ?? e.code ?? e.errorType));
        }
        throw new Error("Invalid Kiro event-stream prelude or CRC");
      }
      if (b.length < total) break;
      if (crc32(b.subarray(0, total - 4)) !== view.getUint32(total - 4)) {
        throw new Error("Invalid Kiro event-stream message CRC");
      }
      const headers: Record<string, string> = {};
      let at = 12;
      const end = 12 + hlen;
      while (at < end) {
        const n = b[at++];
        if (!n || at + n + 1 > end) throw new Error("Invalid Kiro frame header");
        const name = decoder.decode(b.subarray(at, at + n));
        at += n;
        const type = b[at++];
        let size = [0, 0, 1, 2, 4, 8, 0, 0, 8, 16][type];
        if (size === undefined) throw new Error("Invalid Kiro header type");
        if (type === 6 || type === 7) {
          if (at + 2 > end) throw new Error("Truncated Kiro header");
          size = view.getUint16(at);
          at += 2;
        }
        if (at + size > end) throw new Error("Truncated Kiro header value");
        if (type === 7) {
          if (name in headers) throw new Error("Duplicate Kiro header");
          headers[name] = decoder.decode(b.subarray(at, at + size));
        }
        at += size;
      }
      const payload = object(JSON.parse(decoder.decode(b.subarray(end, total - 4))));
      yield { headers, payload };
      b = b.slice(total);
    }
    if (b.length > (8 << 20)) throw new Error("Kiro frame too large");
  }
  if (b.length) {
    if (/^\s*\{/.test(decoder.decode(b.subarray(0, 16)))) {
      const error = object(JSON.parse(decoder.decode(b)));
      throw exception(text(error.__type ?? error.code ?? error.errorType));
    }
    throw new Error("Truncated Kiro event stream");
  }
}
export async function consume(lines: AsyncIterable<string>, output: ProviderOutput) {
  let observed = false, textOpen = false, thinkingOpen = false;
  let toolBytes = 0;
  const tools = new Map<
    string,
    { index: number; name: string; arguments: string; stopped: boolean }
  >();
  for await (const { headers: h, payload: p } of frames(lines)) {
    if (h[":message-type"] === "error" || h[":message-type"] === "exception") {
      throw exception(h[":exception-type"] || h[":error-code"]);
    }
    if (h[":message-type"] !== "event") throw new Error("Invalid Kiro message type");
    const type = h[":event-type"];
    if (type === "assistantResponseEvent" || type === "reasoningContentEvent") {
      const content = type === "reasoningContentEvent" ? (p.text ?? p.content) : p.content;
      const reasoning = type === "reasoningContentEvent" ? content : p.reasoning_content;
      for (
        const [kind, value] of [["thinking", reasoning], [
          "text",
          type === "reasoningContentEvent" ? undefined : content,
        ]] as const
      ) {
        if (value !== undefined && typeof value !== "string") {
          throw new Error("Invalid Kiro content event");
        }
        if (!value) continue;
        observed = true;
        if (kind === "thinking") {
          if (!thinkingOpen) {
            output.emit({ type: "thinking-start" });
            thinkingOpen = true;
          }
          output.emit({ type: "thinking-delta", text: value });
        } else {
          if (thinkingOpen) {
            output.emit({ type: "thinking-end" });
            thinkingOpen = false;
          }
          if (!textOpen) {
            output.emit({ type: "text-start" });
            textOpen = true;
          }
          output.emit({ type: "text-delta", text: value });
        }
      }
    } else if (type === "toolUseEvent") {
      const id = text(p.toolUseId), name = text(p.name);
      if (!id) throw new Error("Kiro tool event has no ID");
      let tool = tools.get(id);
      if (!tool) {
        if (!name || tools.size >= 128) throw new Error("Invalid Kiro tool name or count");
        tool = { index: tools.size, name, arguments: "", stopped: false };
        tools.set(id, tool);
        output.emit({ type: "tool-call-start", index: tool.index, callId: id, name });
      }
      if (
        tool.stopped || name && name !== tool.name ||
        p.input !== undefined && typeof p.input !== "string"
      ) throw new Error("Invalid Kiro tool continuation");
      const delta = typeof p.input === "string" ? p.input : "";
      toolBytes += delta.length;
      if (toolBytes > (8 << 20)) throw new Error("Kiro tool arguments exceed the response limit");
      if (p.stop !== undefined && typeof p.stop !== "boolean") {
        throw new Error("Invalid Kiro tool stop flag");
      }
      tool.arguments += delta;
      if (tool.arguments.length > (4 << 20)) throw new Error("Kiro tool arguments too large");
      if (delta) output.emit({ type: "tool-call-arguments-delta", index: tool.index, delta });
      if (p.stop === true) {
        const args = JSON.parse(tool.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          throw new Error("Invalid Kiro tool JSON");
        }
        tool.stopped = true;
        output.emit({ type: "tool-call-end", index: tool.index });
      }
      observed = true;
    } else if (type === "meteringEvent") {
      const i = p.input_tokens ?? p.inputTokens, o = p.output_tokens ?? p.outputTokens;
      if (typeof i === "number" && typeof o === "number" && i >= 0 && o >= 0) {
        output.emit({
          type: "usage",
          usage: {
            inputTokens: i,
            outputTokens: o,
            totalTokens: i + o,
            cacheReadTokens:
              typeof (p.cacheReadInputTokens ?? p.cache_read_input_tokens) === "number"
                ? Number(p.cacheReadInputTokens ?? p.cache_read_input_tokens)
                : null,
            cacheWriteTokens: null,
            reasoningTokens: null,
          },
        });
      }
    }
  }
  if (!observed || [...tools.values()].some((t) => !t.stopped)) {
    throw new Error("Incomplete or empty Kiro response");
  }
  if (thinkingOpen) output.emit({ type: "thinking-end" });
  if (textOpen) output.emit({ type: "text-end" });
  output.emit({ type: "done", reason: tools.size ? "tool-use" : "stop" });
}
