const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly serverMessage?: string;
  readonly details?: unknown;

  constructor(
    status: number,
    message: string,
    code?: string,
    serverMessage?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAuthError(error: unknown): boolean {
  return isApiError(error) && (error.status === 401 || error.status === 403);
}

export function isUnavailableError(error: unknown): boolean {
  return isApiError(error) && (error.status === 0 || error.status >= 500);
}

const DEFAULT_API_TIMEOUT_MS = 30_000;

function networkError(error: unknown, timedOut: boolean): ApiError {
  const aborted =
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError";
  if (timedOut || aborted) {
    return new ApiError(
      0,
      timedOut
        ? "The request timed out. Check your connection and try again."
        : "The request was cancelled.",
      timedOut ? "TIMEOUT" : "REQUEST_ABORTED",
    );
  }
  return new ApiError(
    0,
    "Unable to reach OpenDevin. Check your connection and try again.",
    "NETWORK_ERROR",
  );
}

export async function api<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  init?.signal?.addEventListener("abort", onAbort, { once: true });
  if (init?.signal?.aborted) controller.abort();

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw networkError(error, timedOut);
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const serverMessage =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : undefined;
    const code = typeof body.code === "string" ? body.code : undefined;
    throw new ApiError(
      response.status,
      serverMessage || `Request failed (${response.status})`,
      code,
      serverMessage,
      body,
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      response.status,
      "The API returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }
}
