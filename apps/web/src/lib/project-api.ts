import type {
  ProjectMemberResponse,
  ProjectMemberRole,
  ProjectMembersResponse,
  ProjectMemberSummary,
  ProjectLifecycle,
  ProjectSummary,
  ProjectResponse,
  ProjectsResponse,
  TaskWorkspaceMember,
  WorkspaceResponse,
  WorkspaceSummary,
} from "@orbit/contracts";

export class ProjectApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProjectApiError";
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

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    const workspaceId = sessionStorage.getItem("orbit.selectedWorkspace");
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
  }

  const body: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    throw new ProjectApiError(getErrorMessage(body) ?? "Could not complete the request.", response.status);
  }

  return body;
}

function isProjectLifecycle(value: unknown): value is ProjectLifecycle {
  return (
    value === "PLANNING" ||
    value === "ACTIVE" ||
    value === "ON_HOLD" ||
    value === "COMPLETED" ||
    value === "ARCHIVED"
  );
}

function parseProject(value: unknown): ProjectSummary {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("description" in value) ||
    !(typeof value.description === "string" || value.description === null) ||
    !("state" in value) ||
    !isProjectLifecycle(value.state) ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "string" ||
    !("updatedAt" in value) ||
    typeof value.updatedAt !== "string" ||
    !("workspace" in value) ||
    typeof value.workspace !== "object" ||
    value.workspace === null ||
    !("id" in value.workspace) ||
    typeof value.workspace.id !== "string" ||
    !("name" in value.workspace) ||
    typeof value.workspace.name !== "string" ||
    !("taskCount" in value) ||
    typeof value.taskCount !== "number" ||
    !("canManage" in value) ||
    typeof value.canManage !== "boolean" ||
    !("statuses" in value) ||
    !Array.isArray(value.statuses)
  ) {
    throw new Error("The projects API returned an invalid project.");
  }

  const statuses = value.statuses.map((status) => {
    if (
      typeof status !== "object" ||
      status === null ||
      !("id" in status) ||
      typeof status.id !== "string" ||
      !("name" in status) ||
      typeof status.name !== "string" ||
      !("color" in status) ||
      typeof status.color !== "string" ||
      !("position" in status) ||
      typeof status.position !== "number"
    ) {
      throw new Error("The projects API returned an invalid project status.");
    }

    return { id: status.id, name: status.name, color: status.color, position: status.position };
  });

  return {
    id: value.id,
    name: value.name,
    description: value.description,
    state: value.state,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    workspace: { id: value.workspace.id, name: value.workspace.name },
    taskCount: value.taskCount,
    canManage: value.canManage,
    statuses,
  };
}

function parseWorkspace(value: unknown): WorkspaceSummary {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("slug" in value) ||
    typeof value.slug !== "string" ||
    !("role" in value) ||
    (value.role !== "OWNER" && value.role !== "ADMIN" && value.role !== "MEMBER")
  ) {
    throw new Error("The workspaces API returned an invalid workspace.");
  }

  return { id: value.id, name: value.name, slug: value.slug, role: value.role };
}

function parseProjectResponse(value: unknown): ProjectResponse {
  if (typeof value !== "object" || value === null || !("project" in value)) {
    throw new Error("The projects API returned an invalid response.");
  }

  return { project: parseProject(value.project) };
}

function parseProjectsResponse(value: unknown): ProjectsResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("projects" in value) ||
    !Array.isArray(value.projects)
  ) {
    throw new Error("The projects API returned an invalid response.");
  }

  return { projects: value.projects.map(parseProject) };
}

function parseWorkspaceResponse(value: unknown): WorkspaceResponse {
  if (typeof value !== "object" || value === null || !("workspace" in value)) {
    throw new Error("The workspaces API returned an invalid response.");
  }

  return { workspace: parseWorkspace(value.workspace) };
}

function parseWorkspaceMember(value: unknown): TaskWorkspaceMember {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("email" in value) ||
    typeof value.email !== "string"
  ) {
    throw new Error("The project members API returned an invalid workspace member.");
  }
  return { id: value.id, name: value.name, email: value.email };
}

function parseProjectMember(value: unknown): ProjectMemberSummary {
  if (
    typeof value !== "object" ||
    value === null ||
    !("userId" in value) ||
    typeof value.userId !== "string" ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("email" in value) ||
    typeof value.email !== "string" ||
    !("projectRole" in value) ||
    (value.projectRole !== "ADMIN" && value.projectRole !== "MEMBER") ||
    !("joinedAt" in value) ||
    typeof value.joinedAt !== "string"
  ) {
    throw new Error("The projects API returned an invalid project member.");
  }

  return {
    userId: value.userId,
    name: value.name,
    email: value.email,
    projectRole: value.projectRole,
    joinedAt: value.joinedAt,
  };
}

function parseProjectMembersResponse(value: unknown): ProjectMembersResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("members" in value) ||
    !Array.isArray(value.members) ||
    !("workspaceMembers" in value) ||
    !Array.isArray(value.workspaceMembers)
  ) {
    throw new Error("The projects API returned an invalid project members response.");
  }

  return {
    members: value.members.map(parseProjectMember),
    workspaceMembers: value.workspaceMembers.map(parseWorkspaceMember),
  };
}

function parseProjectMemberResponse(value: unknown): ProjectMemberResponse {
  if (typeof value !== "object" || value === null || !("member" in value)) {
    throw new Error("The projects API returned an invalid project member response.");
  }
  return { member: parseProjectMember(value.member) };
}

export const projectApi = {
  async list() {
    return parseProjectsResponse(await request("/projects"));
  },
  async currentWorkspace() {
    return parseWorkspaceResponse(await request("/workspaces/current"));
  },
  async get(projectId: string) {
    return parseProjectResponse(await request(`/projects/${encodeURIComponent(projectId)}`));
  },
  async listMembers(projectId: string) {
    return parseProjectMembersResponse(
      await request(`/projects/${encodeURIComponent(projectId)}/members`),
    );
  },
  async addMember(
    projectId: string,
    input: { userId: string; projectRole: ProjectMemberRole },
  ) {
    return parseProjectMemberResponse(
      await request(`/projects/${encodeURIComponent(projectId)}/members`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  },
  async updateMemberRole(
    projectId: string,
    userId: string,
    projectRole: ProjectMemberRole,
  ) {
    return parseProjectMemberResponse(
      await request(
        `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
        { method: "PATCH", body: JSON.stringify({ projectRole }) },
      ),
    );
  },
  async removeMember(projectId: string, userId: string): Promise<void> {
    await request(
      `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  },
  async create(input: { name: string; description?: string }) {
    return parseProjectResponse(
      await request("/projects", { method: "POST", body: JSON.stringify(input) }),
    );
  },
  async update(
    projectId: string,
    input: { name?: string; description?: string | null; state?: ProjectLifecycle },
  ) {
    return parseProjectResponse(
      await request(`/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    );
  },
  async remove(projectId: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
    }
    if (!response.ok) {
      const body: unknown = await response.json();
      throw new ProjectApiError(
        getErrorMessage(body) ?? "Could not delete the project.",
        response.status,
      );
    }
  },
};
