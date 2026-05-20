export function readErrorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const value = (error as { statusCode?: unknown }).statusCode;
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
  }
  return 400;
}

export function readErrorType(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "errorType" in error) {
    const value = (error as { errorType?: unknown }).errorType;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export function openAiErrorBody(error: unknown, fallbackType = "invalid_request_error"): {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
} {
  return {
    error: {
      message: error instanceof Error ? error.message : "request failed",
      type: readErrorType(error) ?? fallbackType,
      param: readErrorString(error, "param"),
      code: readErrorString(error, "code")
    }
  };
}

function readErrorString(error: unknown, property: string): string | null {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return null;
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value : null;
}
