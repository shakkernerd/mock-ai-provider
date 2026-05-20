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
