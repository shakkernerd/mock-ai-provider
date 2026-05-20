export function isOpenAiProviderPath(path: string, providers: readonly string[]): boolean {
  if (path.startsWith("/openai/v1/")) {
    return providers.includes("openai");
  }
  return path.startsWith("/v1/") && isOpenAiNativeMode(providers);
}

export function matchesOpenAiPath(params: {
  path: string;
  providers: readonly string[];
  exact?: readonly string[];
  prefix?: readonly string[];
}): boolean {
  const normalized = readOpenAiPathSuffix(params.path, params.providers);
  if (!normalized) {
    return false;
  }
  return Boolean(
    params.exact?.includes(normalized)
      || params.prefix?.some((prefix) => normalized.startsWith(prefix))
  );
}

export function readOpenAiPathSuffix(path: string, providers: readonly string[]): string | null {
  if (path.startsWith("/openai/v1/") && providers.includes("openai")) {
    return path.slice("/openai/v1/".length);
  }
  if (path.startsWith("/v1/") && isOpenAiNativeMode(providers)) {
    return path.slice("/v1/".length);
  }
  return null;
}

function isOpenAiNativeMode(providers: readonly string[]): boolean {
  return providers.length === 1 && providers[0] === "openai";
}
