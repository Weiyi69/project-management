import type {
  MyTasksResponse,
  ProjectLabelSummary,
  ProjectTasksResponse,
  TaskCommentSummary,
  TaskDetail,
  TaskPriority,
  TaskResponse,
  TaskSummary,
  TaskWorkspaceMember,
} from "@orbit/contracts";

export class TaskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TaskApiError";
  }
}

function messageFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("message" in body)) return undefined;
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

  if (response.status === 204) return undefined;
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new TaskApiError(messageFrom(body) ?? "Could not complete the task request.", response.status);
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLabel(value: unknown): ProjectLabelSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.color !== "string" ||
    typeof value.taskCount !== "number"
  ) {
    throw new Error("The tasks API returned an invalid label.");
  }
  return { id: value.id, name: value.name, color: value.color, taskCount: value.taskCount };
}

function parseTask(value: unknown): TaskSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.title !== "string" ||
    !(typeof value.description === "string" || value.description === null) ||
    typeof value.statusId !== "string" ||
    typeof value.statusName !== "string" ||
    typeof value.statusColor !== "string" ||
    !["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(value.priority)) ||
    !(value.assignee === null ||
      (isRecord(value.assignee) &&
        typeof value.assignee.id === "string" &&
        typeof value.assignee.name === "string" &&
        typeof value.assignee.email === "string")) ||
    typeof value.reporterId !== "string" ||
    !(typeof value.startDate === "string" || value.startDate === null) ||
    !(typeof value.dueDate === "string" || value.dueDate === null) ||
    typeof value.position !== "number" ||
    typeof value.version !== "number" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.labels) ||
    !Array.isArray(value.dependencies) ||
    typeof value.commentCount !== "number"
  ) {
    throw new Error("The tasks API returned an invalid task.");
  }

  const labels = value.labels.map((label) => {
    if (
      !isRecord(label) ||
      typeof label.id !== "string" ||
      typeof label.name !== "string" ||
      typeof label.color !== "string"
    ) {
      throw new Error("The tasks API returned an invalid task label.");
    }
    return { id: label.id, name: label.name, color: label.color };
  });
  const dependencies = value.dependencies.map((dependency) => {
    if (
      !isRecord(dependency) ||
      typeof dependency.id !== "string" ||
      typeof dependency.title !== "string" ||
      typeof dependency.statusName !== "string"
    ) {
      throw new Error("The tasks API returned an invalid task dependency.");
    }
    return { id: dependency.id, title: dependency.title, statusName: dependency.statusName };
  });

  return {
    id: value.id,
    projectId: value.projectId,
    title: value.title,
    description: value.description,
    statusId: value.statusId,
    statusName: value.statusName,
    statusColor: value.statusColor,
    priority: value.priority as TaskPriority,
    assignee:
      value.assignee === null
        ? null
        : {
            id: value.assignee.id as string,
            name: value.assignee.name as string,
            email: value.assignee.email as string,
          },
    reporterId: value.reporterId,
    startDate: value.startDate,
    dueDate: value.dueDate,
    position: value.position,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    labels,
    dependencies,
    commentCount: value.commentCount,
  };
}

function parseComment(value: unknown): TaskCommentSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.body !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.author) ||
    typeof value.author.id !== "string" ||
    typeof value.author.name !== "string" ||
    typeof value.canEdit !== "boolean"
  ) {
    throw new Error("The tasks API returned an invalid comment.");
  }
  return {
    id: value.id,
    body: value.body,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    author: { id: value.author.id, name: value.author.name },
    canEdit: value.canEdit,
  };
}

function parseTaskResponse(value: unknown): TaskResponse {
  if (!isRecord(value) || !("task" in value)) {
    throw new Error("The tasks API returned an invalid response.");
  }
  const summary = parseTask(value.task);
  if (
    !isRecord(value.task) ||
    !Array.isArray(value.task.comments) ||
    !Array.isArray(value.task.availableDependencies)
  ) {
    throw new Error("The tasks API returned an invalid task detail.");
  }
  const availableDependencies = value.task.availableDependencies.map((dependency) => {
    if (
      !isRecord(dependency) ||
      typeof dependency.id !== "string" ||
      typeof dependency.title !== "string" ||
      typeof dependency.statusName !== "string"
    ) {
      throw new Error("The tasks API returned an invalid dependency option.");
    }
    return { id: dependency.id, title: dependency.title, statusName: dependency.statusName };
  });
  const task: TaskDetail = {
    ...summary,
    comments: value.task.comments.map(parseComment),
    availableDependencies,
  };
  return { task };
}

function parseProjectTasks(value: unknown): ProjectTasksResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.members) ||
    !Array.isArray(value.labels)
  ) {
    throw new Error("The tasks API returned an invalid project task list.");
  }
  const members = value.members.map((member): TaskWorkspaceMember => {
    if (
      !isRecord(member) ||
      typeof member.id !== "string" ||
      typeof member.name !== "string" ||
      typeof member.email !== "string"
    ) {
      throw new Error("The tasks API returned an invalid workspace member.");
    }
    return { id: member.id, name: member.name, email: member.email };
  });
  return {
    tasks: value.tasks.map(parseTask),
    members,
    labels: value.labels.map(parseLabel),
  };
}

function parseMyTasks(value: unknown): MyTasksResponse {
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    throw new Error("The tasks API returned an invalid assigned task list.");
  }

  return {
    tasks: value.tasks.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.statusIsCompleted !== "boolean" ||
        !isRecord(item.project) ||
        typeof item.project.id !== "string" ||
        typeof item.project.name !== "string" ||
        !isRecord(item.project.workspace) ||
        typeof item.project.workspace.id !== "string" ||
        typeof item.project.workspace.name !== "string"
      ) {
        throw new Error("The tasks API returned invalid assigned task metadata.");
      }
      const task = parseTask(item);
      if (item.project.id !== task.projectId) {
        throw new Error("The tasks API returned a task with inconsistent project metadata.");
      }
      return {
        ...task,
        statusIsCompleted: item.statusIsCompleted,
        project: {
          id: item.project.id,
          name: item.project.name,
          workspace: {
            id: item.project.workspace.id,
            name: item.project.workspace.name,
          },
        },
      };
    }),
  };
}

export const taskApi = {
  async listMyTasks(includeCompleted = false): Promise<MyTasksResponse> {
    const query = includeCompleted ? "?includeCompleted=true" : "";
    return parseMyTasks(await request(`/tasks/assigned${query}`));
  },
  async list(projectId: string): Promise<ProjectTasksResponse> {
    return parseProjectTasks(
      await request(`/projects/${encodeURIComponent(projectId)}/tasks`),
    );
  },
  async get(taskId: string): Promise<TaskDetail> {
    return parseTaskResponse(await request(`/tasks/${encodeURIComponent(taskId)}`)).task;
  },
  async create(
    projectId: string,
    input: {
      title: string;
      description?: string;
      statusId: string;
      priority?: TaskPriority;
      assigneeId?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      labelIds?: string[];
    },
  ): Promise<TaskDetail> {
    return parseTaskResponse(
      await request(`/projects/${encodeURIComponent(projectId)}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ).task;
  },
  async update(
    taskId: string,
    input: Partial<{
      title: string;
      description: string | null;
      statusId: string;
      priority: TaskPriority;
      assigneeId: string | null;
      startDate: string | null;
      dueDate: string | null;
      labelIds: string[];
    }>,
  ): Promise<TaskDetail> {
    return parseTaskResponse(
      await request(`/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ).task;
  },
  async remove(taskId: string): Promise<void> {
    await request(`/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  },
  async addComment(taskId: string, body: string): Promise<TaskCommentSummary> {
    const result = await request(`/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    if (!isRecord(result) || !("comment" in result)) {
      throw new Error("The tasks API returned an invalid comment response.");
    }
    return parseComment(result.comment);
  },
  async updateComment(commentId: string, body: string): Promise<TaskCommentSummary> {
    const result = await request(`/comments/${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    if (!isRecord(result) || !("comment" in result)) {
      throw new Error("The tasks API returned an invalid comment response.");
    }
    return parseComment(result.comment);
  },
  async removeComment(commentId: string): Promise<void> {
    await request(`/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
  },
  async addDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDetail> {
    return parseTaskResponse(
      await request(`/tasks/${encodeURIComponent(taskId)}/dependencies`, {
        method: "POST",
        body: JSON.stringify({ dependsOnTaskId }),
      }),
    ).task;
  },
  async removeDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDetail> {
    return parseTaskResponse(
      await request(
        `/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(dependsOnTaskId)}`,
        { method: "DELETE" },
      ),
    ).task;
  },
  async createLabel(projectId: string, input: { name: string; color: string }): Promise<ProjectLabelSummary> {
    const result = await request(`/projects/${encodeURIComponent(projectId)}/labels`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!isRecord(result) || !("label" in result)) {
      throw new Error("The tasks API returned an invalid label response.");
    }
    return parseLabel(result.label);
  },
  async updateLabel(
    projectId: string,
    labelId: string,
    input: { name?: string; color?: string },
  ): Promise<ProjectLabelSummary> {
    const result = await request(
      `/projects/${encodeURIComponent(projectId)}/labels/${encodeURIComponent(labelId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    if (!isRecord(result) || !("label" in result)) {
      throw new Error("The tasks API returned an invalid label response.");
    }
    return parseLabel(result.label);
  },
  async removeLabel(projectId: string, labelId: string): Promise<void> {
    await request(
      `/projects/${encodeURIComponent(projectId)}/labels/${encodeURIComponent(labelId)}`,
      { method: "DELETE" },
    );
  },
};
