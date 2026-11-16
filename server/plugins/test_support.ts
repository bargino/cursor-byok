import type { NetworkEventStream, NetworkRequestInit, NetworkResponse, PluginContext } from "../src/plugin/sdk/plugin.ts";
import type { LlmRequest } from "../src/plugin/sdk/provider.ts";
export function assert(v: unknown, message = "assertion failed"): asserts v { if (!v) throw new Error(message); }
export function eq(a: unknown, b: unknown): void { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
export async function rejects(f: () => unknown | Promise<unknown>) { let failed=false;try{await f();}catch{failed=true;}assert(failed,"expected rejection"); }
export function response(body:unknown,status=200):NetworkResponse{return{status,headers:{},body:JSON.stringify(body)};}
export function lines(values:string[],status=200):NetworkEventStream{return{status,headers:{},lines:(async function*(){yield*values;})()};}
export function context(handlers:{fetch?:(url:string,init:NetworkRequestInit)=>NetworkResponse|Promise<NetworkResponse>;stream?:(url:string,init:NetworkRequestInit)=>NetworkEventStream|Promise<NetworkEventStream>}={}):PluginContext{return{signal:new AbortController().signal,network:{async fetch(url,init={}){if(!handlers.fetch)throw new Error(`unexpected fetch: ${url}`);return await handlers.fetch(url,init);},async stream(url,init={}){if(!handlers.stream)throw new Error(`unexpected stream: ${url}`);return await handlers.stream(url,init);}}};}
export function request():LlmRequest{return{instructions:"Follow the project rules.",messages:[{role:"user",content:[{type:"text",text:"你好"}]}],tools:[],reasoning:{enabled:false,effort:null},latency:"standard",maxOutputTokens:2000,cacheKey:"conversation-1"};}
