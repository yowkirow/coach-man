import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { badRequest } from "./errors";

/** zod validation that answers with our error shape and per-field messages. */
export function v<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".") || "_";
        if (!fields[key]) fields[key] = issue.message;
      }
      throw badRequest("Some fields need attention.", { fields });
    }
  });
}
