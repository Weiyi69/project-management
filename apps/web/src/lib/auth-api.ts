import type { AuthResponse } from "@orbit/contracts";

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

function getErrorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("message" in body)) {
    return undefined;
  }

  const message = body.message;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message) && message.every((item) => typeof item === "string")) {
    return message.join(" ");
  }

  return undefined;
}

function parseAuthenticatedResponse(value: unknown): AuthResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("user" in value) ||
    typeof value.user !== "object" ||
    value.user === null ||
    !("id" in value.user) ||
    typeof value.user.id !== "string" ||
    !("name" in value.user) ||
    typeof value.user.name !== "string" ||
    !("email" in value.user) ||
    typeof value.user.email !== "string" ||
    !("workspaceId" in value.user) ||
    typeof value.user.workspaceId !== "string" ||
    !("workspaceName" in value.user) ||
    typeof value.user.workspaceName !== "string"
  ) {
    throw new Error("The authentication API returned an invalid response.");
  }

  return {
    user: {
      id: value.user.id,
      name: value.user.name,
      email: value.user.email,
      workspaceId: value.user.workspaceId,
      workspaceName: value.user.workspaceName,
    },
  };
}

function objectResponse(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("The authentication API returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
  }

  const responseText = await response.text();
  let body: unknown = null;
  if (responseText.trim()) {
    try {
      body = JSON.parse(responseText);
    } catch {
      if (response.ok) {
        throw new Error("The authentication API returned an invalid response.");
      }
    }
  }
  if (!response.ok) {
    throw new AuthApiError(
      getErrorMessage(body) ??
        `The request failed (${response.status} ${response.statusText || "HTTP error"}).`,
      response.status,
    );
  }

  return body;
}

export const authApi = {
  async register(input: { name: string; email: string; password: string }) {
    const body = objectResponse(
      await request("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    if (
      typeof body.email !== "string" ||
      body.verificationRequired !== true ||
      typeof body.resendCooldownSeconds !== "number"
    ) {
      throw new Error("The authentication API returned an invalid registration response.");
    }
    return {
      email: body.email,
      verificationRequired: true as const,
      resendCooldownSeconds: body.resendCooldownSeconds,
    };
  },
  async login(input: { email: string; password: string }) {
    return parseAuthenticatedResponse(
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },
  async verifyEmail(input: { email: string; code: string }) {
    const body = objectResponse(
      await request("/auth/verify-email", { method: "POST", body: JSON.stringify(input) }),
    );
    if (body.verified !== true) throw new Error("The verification response was invalid.");
  },
  async resendVerification(email: string) {
    const body = objectResponse(
      await request("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    );
    if (typeof body.resendCooldownSeconds !== "number") {
      throw new Error("The authentication API returned an invalid resend response.");
    }
    return { resendCooldownSeconds: body.resendCooldownSeconds };
  },
  async requestPasswordReset(email: string) {
    return objectResponse(
      await request("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    );
  },
  async resetPassword(input: { email: string; code: string; newPassword: string }) {
    const body = objectResponse(
      await request("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    if (body.reset !== true) throw new Error("The password reset response was invalid.");
  },
  async currentUser() {
    return parseAuthenticatedResponse(await request("/auth/me"));
  },
  async logout() {
    await request("/auth/logout", { method: "POST" });
  },
};
