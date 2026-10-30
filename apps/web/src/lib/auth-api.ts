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

function parseAuthResponse(value: unknown): AuthResponse {
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
      workspaceName: value.user.workspaceName,
    },
  };
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

  const body: unknown = await response.json();
  if (!response.ok) {
    throw new AuthApiError(
      getErrorMessage(body) ?? "The request could not be completed.",
      response.status,
    );
  }

  return body;
}

export const authApi = {
  async register(input: { name: string; email: string; password: string }) {
    return parseAuthResponse(
      await request("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },
  async login(input: { email: string; password: string }) {
    return parseAuthResponse(
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },
  async currentUser() {
    return parseAuthResponse(await request("/auth/me"));
  },
  async logout() {
    await request("/auth/logout", { method: "POST" });
  },
};
