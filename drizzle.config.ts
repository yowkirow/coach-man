import { defineConfig } from "drizzle-kit";

// Generates SQL migrations into ./migrations, which `wrangler d1 migrations apply` reads.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
  casing: "snake_case",
});
