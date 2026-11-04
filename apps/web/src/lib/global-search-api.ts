import type { GlobalSearchResponse } from "@orbit/contracts";

export class GlobalSearchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GlobalSearchApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !("message" in value)) return undefined;
  if (typeof value.message === "string") return value.message;
  if (Array.isArray(value.message) && value.message.every((part) => typeof part === "string")) {
    return value.message.join(" ");
  }
  return undefined;
}

function parseResponse(value: unknown): GlobalSearchResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.tasks) ||
    value.projects.length > 8 ||
    value.tasks.length > 8
  ) {
    throw new Error("The search API returned an invalid response.");
  }

  const projects = value.projects.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      !(typeof candidate.description === "string" || candidate.description === null) ||
      !isRecord(candidate.workspace) ||
      typeof candidate.workspace.id !== "string" ||
      typeof candidate.workspace.name !== "string"
    ) {
      throw new Error("The search API returned an invalid project result.");
    }
    return {
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      workspace: { id: candidate.workspace.id, name: candidate.workspace.name },
    };
  });

  const tasks = value.tasks.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.projectId !== "string" ||
      typeof candidate.title !== "string" ||
      !(typeof candidate.description === "string" || candidate.description === null) ||
      !isRecord(candidate.project) ||
      typeof candidate.project.id !== "string" ||
      typeof candidate.project.name !== "string"
    ) {
      throw new Error("The search API returned an invalid task result.");
    }
    return {
      id: candidate.id,
      projectId: candidate.projectId,
      title: candidate.title,
      description: candidate.description,
      project: { id: candidate.project.id, name: candidate.project.name },
    };
  });

  return { projects, tasks };
}

export const globalSearchApi = {
  async search(query: string, signal?: AbortSignal): Promise<GlobalSearchResponse> {
    let response: Response;
    try {
      response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
      throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
    }

    const body: unknown = await response.json();
    if (!response.ok) {
      throw new GlobalSearchApiError(
        readErrorMessage(body) ?? "Could not search projects and tasks.",
        response.status,
      );
    }
    return parseResponse(body);
  },
};
