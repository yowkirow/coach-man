import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found.`);
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "conflict", message, details);
export const unauthorized = () => new ApiError(401, "unauthorized", "Sign in to continue.");
export const forbidden = (message = "You don't have access to this.") =>
  new ApiError(403, "forbidden", message);
/** Signed in, but not staff in any academy (families use the portal instead). */
export const noWorkspace = () =>
  new ApiError(403, "no_workspace", "You're not part of an academy on CoachMan yet.");
