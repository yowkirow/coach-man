import type { ApiErrorBody } from "@shared/api-types";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
  get isOffline() {
    return this.status === 0;
  }
}

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiRequestError(0, "offline", "You're offline. This will sync when you reconnect.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeParse(text) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    if (res.status === 401) onUnauthorized?.();
    const fields = (err?.details as { fields?: Record<string, string> } | undefined)?.fields ?? {};
    throw new ApiRequestError(
      res.status,
      err?.code ?? "error",
      err?.message ?? `Request failed (${res.status}).`,
      fields,
    );
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("POST", path, body ?? {}, opts),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>("PATCH", path, body, opts),
  put: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>("PUT", path, body, opts),
  del: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("DELETE", path, body, opts),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiRequestError ? err.fields : {};
}

export function fileUrl(key: string | null | undefined): string | null {
  return key ? `/api/v1/files/${key.split("/").map(encodeURIComponent).join("/")}` : null;
}
