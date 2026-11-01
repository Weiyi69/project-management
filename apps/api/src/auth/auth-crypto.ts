import { createHmac, randomInt } from "node:crypto";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createOtp(): string {
  if (process.env.NODE_ENV === "test" && process.env.ORBIT_TEST_OTP) {
    if (!/^\d{6}$/.test(process.env.ORBIT_TEST_OTP)) {
      throw new Error("ORBIT_TEST_OTP must contain exactly six digits.");
    }
    return process.env.ORBIT_TEST_OTP;
  }
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(userId: string, purpose: string, code: string): string {
  return createHmac("sha256", requireOtpPepper())
    .update(`${purpose}:${userId}:${code}`)
    .digest("hex");
}

export function hashRateLimitKey(scope: string, subject: string): string {
  return createHmac("sha256", requireOtpPepper())
    .update(`rate-limit:${scope}:${subject}`)
    .digest("hex");
}

export function requireOtpPepper(): string {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, "utf8") < 32) {
    throw new Error("OTP_PEPPER must be configured with at least 32 bytes of random data.");
  }
  return pepper;
}
