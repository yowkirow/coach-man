import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { badRequest } from "./errors";

function fieldsOf(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** zod validation that answers with our error shape and per-field messages. */
export function v<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw badRequest("Some fields need attention.", { fields: fieldsOf(result.error) });
    }
  });
}

/** The same validation for a body read by hand (a multipart upload's JSON part). */
export function parseWith<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest("Some fields need attention.", { fields: fieldsOf(result.error) });
  }
  return result.data;
}
