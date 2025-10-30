export type RequestIdentifier = string | null;

function normalizeMethod(method: string | undefined): string {
  return method ? method.toUpperCase() : "GET";
}

export function formatRequestId(requestId: RequestIdentifier): string {
  return requestId ?? "missing";
}

export function logRequestId(
  context: string,
  method: string | undefined,
  url: string | undefined,
  requestId: RequestIdentifier,
): void {
  const normalizedMethod = normalizeMethod(method);
  const normalizedUrl = url ?? "unknown";
  const formattedRequestId = formatRequestId(requestId);

  console.debug(
    `[${context}] ${normalizedMethod} ${normalizedUrl} - X-Request-Id: ${formattedRequestId}`,
  );
}

export function attachRequestId<T>(
  value: T,
  requestId: RequestIdentifier,
): T {
  if (!requestId) {
    return value;
  }

  if (value !== null && typeof value === "object") {
    return Object.assign(value as Record<string, unknown>, { requestId }) as T;
  }

  if (typeof value === "string") {
    const wrapped = new String(value);
    Object.assign(wrapped, { requestId });
    return wrapped as unknown as T;
  }

  if (typeof value === "number") {
    const wrapped = new Number(value);
    Object.assign(wrapped, { requestId });
    return wrapped as unknown as T;
  }

  if (typeof value === "boolean") {
    const wrapped = new Boolean(value);
    Object.assign(wrapped, { requestId });
    return wrapped as unknown as T;
  }

  return value;
}

export function extractRequestId(value: unknown): RequestIdentifier {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return null;
  }

  if (typeof value === "object" || typeof value === "function") {
    const candidate = (value as { requestId?: unknown }).requestId;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}
