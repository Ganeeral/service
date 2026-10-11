import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { PoolClient } from "pg";

export type EncryptedLink = { iv: string; tag: string; data: string };
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const encryptionKey = (capability: string) =>
  createHash("sha256").update("telegram-link:").update(capability).digest();

export async function issueLink(
  client: PoolClient,
  appointmentId: string,
  username: string,
  capability: string,
) {
  const token = randomBytes(32).toString("base64url");
  const url = `https://t.me/${username}?start=${token}`;
  await client.query(
    "INSERT INTO appointment_link_tokens (token_hash, appointment_id, expires_at) VALUES ($1,$2,now() + interval '24 hours')",
    [tokenHash(token), appointmentId],
  );
  // Recovery uses the customer's submission capability, which is never stored in plaintext.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(capability), iv);
  const data = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  const encrypted: EncryptedLink = {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
  return { url, encrypted };
}

export function recoverLink(
  encrypted: EncryptedLink,
  capability: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(capability),
    Buffer.from(encrypted.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
