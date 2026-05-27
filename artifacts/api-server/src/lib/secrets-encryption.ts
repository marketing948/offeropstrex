import crypto from "crypto";

export const ENCRYPTED_SECRET_PREFIX = "enc:v1:";

const DEV_FALLBACK_KEY = "offerops-dev-secrets-encryption-do-not-use-in-production";

function deriveKeyMaterial(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export function resolveSecretsEncryptionKey(): Buffer {
  const configured = process.env.SECRETS_ENCRYPTION_KEY?.trim();
  if (configured) return deriveKeyMaterial(configured);

  if (process.env.NODE_ENV === "production") {
    throw new Error("SECRETS_ENCRYPTION_KEY is required in production when encrypting or decrypting secrets");
  }

  return deriveKeyMaterial(DEV_FALLBACK_KEY);
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_SECRET_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (!trimmed) return "";

  const key = resolveSecretsEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]).toString("base64url");
  return `${ENCRYPTED_SECRET_PREFIX}${payload}`;
}

/** Decrypts enc:v1 values; returns legacy plaintext unchanged. */
export function decryptSecret(stored: string): string {
  const trimmed = stored.trim();
  if (!trimmed) return "";

  if (!isEncryptedSecret(trimmed)) {
    return trimmed;
  }

  const key = resolveSecretsEncryptionKey();
  const raw = Buffer.from(trimmed.slice(ENCRYPTED_SECRET_PREFIX.length), "base64url");
  if (raw.length < 28) {
    throw new Error("Invalid encrypted secret payload");
  }

  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
