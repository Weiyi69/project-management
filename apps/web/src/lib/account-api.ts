import type {
  AccountProfile,
  NotificationPreference,
  NotificationPreferencesResponse,
} from "@orbit/contracts";

export interface AccountSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export class AccountApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

function messageFrom(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("message" in value)) return undefined;
  return typeof value.message === "string" ? value.message : undefined;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`/api/v1/account${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(!isForm && init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw new AccountApiError(
      messageFrom(body) ?? "The account settings request could not be completed.",
      response.status,
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("The account settings API returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function parseProfile(value: unknown): AccountProfile {
  const response = object(value);
  if (
    typeof response.id !== "string" ||
    typeof response.name !== "string" ||
    typeof response.email !== "string" ||
    !(response.pendingEmail === null || typeof response.pendingEmail === "string") ||
    !(response.emailVerifiedAt === null || typeof response.emailVerifiedAt === "string") ||
    typeof response.createdAt !== "string" ||
    typeof response.hasProfilePhoto !== "boolean"
  ) {
    throw new Error("The account settings API returned an invalid profile.");
  }
  return {
    id: response.id,
    name: response.name,
    email: response.email,
    pendingEmail: response.pendingEmail,
    emailVerifiedAt: response.emailVerifiedAt,
    createdAt: response.createdAt,
    hasProfilePhoto: response.hasProfilePhoto,
  };
}

const notificationTypes = [
  "TASK_ASSIGNED",
  "TASK_MENTIONED",
  "COMMENT_ADDED",
  "DUE_DATE_REMINDER",
  "PROJECT_UPDATED",
  "INVITATION_RECEIVED",
] as const;

function parsePreferences(value: unknown): NotificationPreferencesResponse {
  const response = object(value);
  if (!Array.isArray(response.preferences)) {
    throw new Error("The account settings API returned invalid notification preferences.");
  }
  const preferences = response.preferences.map((item): NotificationPreference => {
    const preference = object(item);
    if (
      typeof preference.type !== "string" ||
      !notificationTypes.includes(preference.type as (typeof notificationTypes)[number]) ||
      typeof preference.inApp !== "boolean" ||
      typeof preference.email !== "boolean"
    ) {
      throw new Error("The account settings API returned invalid notification preferences.");
    }
    return {
      type: preference.type as NotificationPreference["type"],
      inApp: preference.inApp,
      email: preference.email,
    };
  });
  if (preferences.length !== notificationTypes.length) {
    throw new Error("The account settings API returned incomplete notification preferences.");
  }
  return { preferences };
}

export const accountApi = {
  async profile(): Promise<AccountProfile> {
    return parseProfile(await request(""));
  },
  async updateProfile(name: string): Promise<{ name: string }> {
    const response = object(
      await request("/profile", { method: "PATCH", body: JSON.stringify({ name }) }),
    );
    if (typeof response.name !== "string") {
      throw new Error("The account settings API returned an invalid profile update.");
    }
    return { name: response.name };
  },
  async requestEmailChange(email: string): Promise<void> {
    await request("/email-change", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  async confirmEmailChange(code: string): Promise<void> {
    await request("/email-change/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },
  async cancelEmailChange(): Promise<void> {
    await request("/email-change", { method: "DELETE" });
  },
  async uploadProfilePhoto(file: File): Promise<void> {
    const form = new FormData();
    form.set("photo", file);
    await request("/profile-photo", { method: "POST", body: form });
  },
  async removeProfilePhoto(): Promise<void> {
    await request("/profile-photo", { method: "DELETE" });
  },
  async notificationPreferences(): Promise<NotificationPreferencesResponse> {
    return parsePreferences(await request("/notifications"));
  },
  async saveNotificationPreferences(
    preferences: NotificationPreference[],
  ): Promise<NotificationPreferencesResponse> {
    return parsePreferences(
      await request("/notifications", {
        method: "PUT",
        body: JSON.stringify({ preferences }),
      }),
    );
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request("/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  async sessions(): Promise<AccountSession[]> {
    const response = object(await request("/sessions"));
    if (!Array.isArray(response.sessions)) {
      throw new Error("The account settings API returned invalid sessions.");
    }
    return response.sessions.map((item) => {
      const session = object(item);
      if (
        typeof session.id !== "string" ||
        typeof session.createdAt !== "string" ||
        typeof session.expiresAt !== "string" ||
        typeof session.current !== "boolean" ||
        "token" in session ||
        "tokenHash" in session
      ) {
        throw new Error("The account settings API returned invalid session metadata.");
      }
      return {
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        current: session.current,
      };
    });
  },
  async revokeSession(id: string): Promise<void> {
    await request(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async revokeOtherSessions(): Promise<void> {
    await request("/sessions/revoke-others", { method: "POST" });
  },
};

export const accountPhotoUrl = "/api/v1/account/profile-photo";
