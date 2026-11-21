import type { ModelInput } from "../api";

export const imageGenerationEndpoint = "/v1/images/generations";

export function isImageGenerationModel(model: Pick<ModelInput, "type" | "openai_endpoint">): boolean {
  return model.type === "openai" && model.openai_endpoint === imageGenerationEndpoint;
}

export function switchFullModelUrl(value: string, endpoint: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/(?:chat\/completions|responses|messages|images\/generations)\/?$/, endpoint.replace(/^\/v1/, ""));
    if (path === url.pathname) return value;
    url.pathname = path;
    return url.href;
  } catch {
    return value;
  }
}
