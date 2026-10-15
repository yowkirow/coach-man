// Generates a Web Push (VAPID) key pair for CoachMan reminders.
// Usage: npm run vapid:generate
// - VAPID_PUBLIC_KEY: base64url of the raw P-256 public key (browsers use it as applicationServerKey)
// - VAPID_PRIVATE_KEY: the private key as a JWK JSON string (what @pushforge/builder signs with)
import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicRaw = Buffer.from(await subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const { kty, crv, x, y, d } = await subtle.exportKey("jwk", pair.privateKey);
const privateJwk = JSON.stringify({ kty, crv, x, y, d });

console.log(`VAPID_PUBLIC_KEY=${publicRaw}`);
console.log(`VAPID_PRIVATE_KEY='${privateJwk}'`);
console.log(`
Local dev: paste both lines into .dev.vars (keep the single quotes around the JSON).
Cloudflare: run once per environment and paste the value when prompted (JSON without the quotes):
  npx wrangler secret put VAPID_PUBLIC_KEY --env production
  npx wrangler secret put VAPID_PRIVATE_KEY --env production
Changing keys invalidates existing push subscriptions; coaches re-enable reminders in Settings.`);
