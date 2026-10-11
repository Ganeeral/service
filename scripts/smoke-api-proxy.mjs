import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3007";
const health = await fetch(`${base}/api/v1/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { status: "ok" });
assert.equal(health.headers.get("cache-control"), "no-store");
const options = await fetch(`${base}/api/v1/booking-options`);
assert.equal(options.status, 200);
assert.ok(Array.isArray((await options.json()).services));
const post = (origin) =>
  fetch(`${base}/api/v1/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomBytes(32).toString("base64url"),
      Origin: origin,
    },
    body: "{}",
  });
const invalid = await post(new URL(base).origin);
assert.equal(invalid.status, 400, "Forward JSON body and Origin to NestJS");
assert.equal((await invalid.json()).code, "INVALID_INPUT");
assert.equal((await post("https://evil.example")).status, 403);
assert.equal((await fetch(`${base}/api/v1/owner/appointments`)).status, 404);
console.log("Same-origin forwarding checks passed; no appointment was created");
