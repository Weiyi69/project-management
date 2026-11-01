import assert from "node:assert/strict";
import { test } from "node:test";
import { createOtp, hashOtp, hashRateLimitKey, normalizeEmail } from "./auth-crypto";

test("normalizes addresses and creates purpose-specific keyed OTP hashes", () => {
  const previousPepper = process.env.OTP_PEPPER;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestOtp = process.env.ORBIT_TEST_OTP;
  process.env.OTP_PEPPER = "unit-test-only-otp-pepper-with-at-least-32-bytes";
  process.env.NODE_ENV = "test";
  delete process.env.ORBIT_TEST_OTP;

  try {
    assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
    const otp = createOtp();
    assert.match(otp, /^\d{6}$/);
    const verificationHash = hashOtp("user-1", "EMAIL_VERIFICATION", otp);
    assert.equal(verificationHash, hashOtp("user-1", "EMAIL_VERIFICATION", otp));
    assert.notEqual(verificationHash, otp);
    assert.notEqual(verificationHash, hashOtp("user-2", "EMAIL_VERIFICATION", otp));
    assert.notEqual(verificationHash, hashOtp("user-1", "PASSWORD_RESET", otp));
    assert.notEqual(
      hashRateLimitKey("login-ip", "127.0.0.1"),
      hashRateLimitKey("login-email", "127.0.0.1"),
    );
  } finally {
    if (previousPepper === undefined) delete process.env.OTP_PEPPER;
    else process.env.OTP_PEPPER = previousPepper;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTestOtp === undefined) delete process.env.ORBIT_TEST_OTP;
    else process.env.ORBIT_TEST_OTP = previousTestOtp;
  }
});
