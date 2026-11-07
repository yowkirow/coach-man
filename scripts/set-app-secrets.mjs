// Generates CoachMan's app-internal secrets for one Cloudflare environment and uploads them with
// `wrangler secret bulk`. Values are never printed; the temp file is deleted right after upload.
// Usage: node scripts/set-app-secrets.mjs <staging|production> <vapid contact email>
import { execFileSync } from "node:child_process";
import { randomBytes, webcrypto } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [env, email] = process.argv.slice(2);
if (!["staging", "production"].includes(env) || !email) {
  console.error("Usage: node scripts/set-app-secrets.mjs <staging|production> <email>");
  process.exit(1);
}

const { subtle } = webcrypto;
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicKey = Buffer.from(await subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const { kty, crv, x, y, d } = await subtle.exportKey("jwk", pair.privateKey);

const secrets = {
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
  VAPID_PUBLIC_KEY: publicKey,
  VAPID_PRIVATE_KEY: JSON.stringify({ kty, crv, x, y, d }),
  VAPID_SUBJECT: `mailto:${email}`,
};

const file = join(tmpdir(), `coachman-${env}-${randomBytes(6).toString("hex")}.json`);
writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
try {
  execFileSync("npx", ["wrangler", "secret", "bulk", file, "--env", env], {
    stdio: "inherit",
    shell: true,
    cwd: process.cwd(),
  });
} finally {
  rmSync(file, { force: true });
}
console.log(`Set ${Object.keys(secrets).join(", ")} on ${env}.`);
