import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";

export const SESSION_COOKIE_NAME = "orbit_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getSessionToken(cookieHeader: string | undefined): string | undefined {
  const entry = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));

  return entry?.slice(SESSION_COOKIE_NAME.length + 1) || undefined;
}

export function setSessionCookie(response: Response, token: string): void {
  const cookie = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DURATION_SECONDS}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");

  response.setHeader("Set-Cookie", cookie);
}

export function clearSessionCookie(response: Response): void {
  const cookie = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");

  response.setHeader("Set-Cookie", cookie);
}
