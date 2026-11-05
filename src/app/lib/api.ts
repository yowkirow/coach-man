import type { ApiErrorBody } from "@shared/api-types";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    /** Extra help from the server, e.g. which address an invite was sent to (masked). */
    readonly hint: string | null = null,
    /** Everything else the server put in `details`. */
    readonly details: Record<string, unknown> = {},
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

let onNoWorkspace: (() => void) | null = null;
/** Called when a staff request finds the person isn't staff anywhere (403 no_workspace). */
export function setNoWorkspaceHandler(fn: () => void) {
  onNoWorkspace = fn;
}

export async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  return send<T>(method, `/api/v1${path}`, body, opts);
}

async function send<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(url, {
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
    if (res.status === 403 && err?.code === "no_workspace") onNoWorkspace?.();
    const details = err?.details as
      | ({ fields?: Record<string, string>; hint?: string } & Record<string, unknown>)
      | undefined;
    throw new ApiRequestError(
      res.status,
      err?.code ?? "error",
      err?.message ?? `Request failed (${res.status}).`,
      details?.fields ?? {},
      typeof details?.hint === "string" ? details.hint : null,
      details && typeof details === "object" ? details : {},
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

/** /api/account: the signed-in person, whether or not they're staff anywhere. */
export const accountApi = {
  get: <T>(path = "") => send<T>("GET", `/api/account${path}`),
  post: <T>(path: string, body?: unknown) => send<T>("POST", `/api/account${path}`, body ?? {}),
};

/** /api/invites: invite links (the preview needs no sign-in; accepting does). */
export const inviteApi = {
  preview: <T>(token: string) => send<T>("GET", `/api/invites/${encodeURIComponent(token)}`),
  accept: <T>(token: string) =>
    send<T>("POST", `/api/invites/${encodeURIComponent(token)}/accept`, {}),
};

/** /api/public: what anyone may read (a listed academy's page), no sign-in. */
export const publicApi = {
  get: <T>(path: string, opts?: RequestOptions) =>
    send<T>("GET", `/api/public${path}`, undefined, opts),
};

/** /api/portal: the family portal's own API (never /api/v1, which families can't use). */
export const portalApi = {
  get: <T>(path: string, opts?: RequestOptions) =>
    send<T>("GET", `/api/portal${path}`, undefined, opts),
  post: <T>(path: string, body?: unknown) => send<T>("POST", `/api/portal${path}`, body ?? {}),
  del: <T>(path: string) => send<T>("DELETE", `/api/portal${path}`),
};

/** The extra the server sends with some refusals, e.g. `alreadyLinked` on a family invite. */
export function errorDetails(err: unknown): Record<string, unknown> {
  return err instanceof ApiRequestError ? err.details : {};
}

/** Signed in, but not staff in any academy: the staff app sends them to /welcome. */
export function isNoWorkspace(err: unknown): boolean {
  return err instanceof ApiRequestError && err.status === 403 && err.code === "no_workspace";
}

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

/** An academy's public image (logo, payment QR, coach photo) for people who aren't staff yet. */
export function publicFileUrl(key: string | null | undefined): string | null {
  return key ? `/api/public/files/${key.split("/").map(encodeURIComponent).join("/")}` : null;
}

/**
 * A file in the family portal: public academy images (cacheable) through /api/public/files, and
 * the family's own students' photos through /api/portal/files.
 */
export function portalFileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^ws\/[^/]+\/public\//.test(key)) return publicFileUrl(key);
  return `/api/portal/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** The hint the server gives when an invite was sent to another address ("j•••@gmail.com"). */
export function errorHint(err: unknown): string | null {
  return err instanceof ApiRequestError ? err.hint : null;
}
