import type {
  InvitationPreview,
  InvitationSummary,
  WorkspaceMemberSummary,
  WorkspaceSummary,
} from "@orbit/contracts";

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

function getErrorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("message" in body)) {
    return undefined;
  }
  const message = body.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message) && message.every((item) => typeof item === "string")) {
    return message.join(" ");
  }
  return undefined;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
  }

  if (response.status === 204) {
    if (!response.ok) throw new WorkspaceApiError("Could not complete the request.", response.status);
    return undefined;
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new WorkspaceApiError(getErrorMessage(body) ?? "Could not complete the request.", response.status);
  }
  return body;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("The workspace API returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function workspace(value: unknown): WorkspaceSummary {
  const data = object(value);
  if (
    typeof data.id !== "string" ||
    typeof data.name !== "string" ||
    typeof data.slug !== "string" ||
    (data.role !== "OWNER" && data.role !== "ADMIN" && data.role !== "MEMBER")
  ) {
    throw new Error("The workspace API returned an invalid workspace.");
  }
  return { id: data.id, name: data.name, slug: data.slug, role: data.role };
}

function member(value: unknown): WorkspaceMemberSummary {
  const data = object(value);
  if (
    typeof data.userId !== "string" ||
    typeof data.name !== "string" ||
    typeof data.email !== "string" ||
    (data.role !== "OWNER" && data.role !== "ADMIN" && data.role !== "MEMBER") ||
    typeof data.joinedAt !== "string"
  ) {
    throw new Error("The workspace API returned an invalid member.");
  }
  return {
    userId: data.userId,
    name: data.name,
    email: data.email,
    role: data.role,
    joinedAt: data.joinedAt,
  };
}

function invitation(value: unknown): InvitationSummary {
  const data = object(value);
  if (
    typeof data.id !== "string" ||
    typeof data.email !== "string" ||
    (data.role !== "OWNER" && data.role !== "ADMIN" && data.role !== "MEMBER") ||
    typeof data.inviterName !== "string" ||
    typeof data.expiresAt !== "string" ||
    !(typeof data.acceptedAt === "string" || data.acceptedAt === null) ||
    typeof data.expired !== "boolean"
  ) {
    throw new Error("The workspace API returned an invalid invitation.");
  }
  return {
    id: data.id,
    email: data.email,
    role: data.role,
    inviterName: data.inviterName,
    expiresAt: data.expiresAt,
    acceptedAt: data.acceptedAt,
    expired: data.expired,
  };
}

function recordField(value: unknown, key: string): unknown {
  const data = object(value);
  if (!(key in data)) throw new Error("The workspace API returned an invalid response.");
  return data[key];
}

export const workspaceApi = {
  async list(): Promise<WorkspaceSummary[]> {
    const data = object(await request("/workspaces"));
    if (!Array.isArray(data.workspaces)) throw new Error("The workspace API returned an invalid response.");
    return data.workspaces.map(workspace);
  },
  async create(name: string): Promise<WorkspaceSummary> {
    return workspace(recordField(await request("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name }),
    }), "workspace"));
  },
  async update(id: string, name: string): Promise<WorkspaceSummary> {
    return workspace(recordField(await request(`/workspaces/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }), "workspace"));
  },
  async remove(id: string): Promise<void> {
    await request(`/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async members(id: string): Promise<WorkspaceMemberSummary[]> {
    const data = object(await request(`/workspaces/${encodeURIComponent(id)}/members`));
    if (!Array.isArray(data.members)) throw new Error("The workspace API returned an invalid response.");
    return data.members.map(member);
  },
  async updateMember(id: string, userId: string, role: "ADMIN" | "MEMBER") {
    return member(recordField(await request(
      `/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ), "member"));
  },
  async removeMember(id: string, userId: string) {
    await request(
      `/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  },
  async invitations(id: string): Promise<InvitationSummary[]> {
    const data = object(await request(`/workspaces/${encodeURIComponent(id)}/invitations`));
    if (!Array.isArray(data.invitations)) throw new Error("The workspace API returned an invalid response.");
    return data.invitations.map(invitation);
  },
  async invite(id: string, email: string, role: "ADMIN" | "MEMBER") {
    return invitation(recordField(await request(
      `/workspaces/${encodeURIComponent(id)}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role }) },
    ), "invitation"));
  },
  async revokeInvitation(workspaceId: string, invitationId: string) {
    await request(
      `/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE" },
    );
  },
  async previewInvitation(token: string): Promise<InvitationPreview> {
    const data = object(recordField(await request(
      `/invitations/preview/${encodeURIComponent(token)}`,
    ), "invitation"));
    if (
      typeof data.email !== "string" ||
      (data.role !== "ADMIN" && data.role !== "MEMBER") ||
      typeof data.workspaceName !== "string" ||
      typeof data.expiresAt !== "string" ||
      typeof data.accepted !== "boolean"
    ) {
      throw new Error("The invitation API returned an invalid preview.");
    }
    return {
      email: data.email,
      role: data.role,
      workspaceName: data.workspaceName,
      expiresAt: data.expiresAt,
      accepted: data.accepted,
    };
  },
  async acceptInvitation(token: string): Promise<WorkspaceSummary> {
    return workspace(recordField(await request("/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token }),
    }), "workspace"));
  },
};
