import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { test } from "node:test";
import { PrismaService } from "../prisma/prisma.service";
import { GlobalSearchService } from "./global-search.service";

function makeService(prisma: Record<string, unknown>): GlobalSearchService {
  return new GlobalSearchService(prisma as unknown as PrismaService);
}

test("searches projects and tasks by normalized case-insensitive partial match", async () => {
  const calls: Array<{ model: string; args: Record<string, unknown> }> = [];
  const service = makeService({
    project: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "project", args });
        return [];
      },
    },
    task: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "task", args });
        return [];
      },
    },
  });

  assert.deepEqual(await service.search("user-1", "  StraSSe \t plan  "), {
    projects: [],
    tasks: [],
  });
  assert.equal(calls.length, 2);

  const projectArgs = calls.find(({ model }) => model === "project")?.args as {
    where: {
      workspace: { members: { some: { userId: string } } };
      OR: Array<{ name?: { contains: string; mode: string }; description?: { contains: string; mode: string } }>;
    };
    take: number;
  };
  assert.equal(projectArgs.where.workspace.members.some.userId, "user-1");
  assert.deepEqual(projectArgs.where.OR, [
    { name: { contains: "StraSSe plan", mode: "insensitive" } },
    { description: { contains: "StraSSe plan", mode: "insensitive" } },
  ]);
  assert.equal(projectArgs.take, 8);

  const taskArgs = calls.find(({ model }) => model === "task")?.args as {
    where: {
      project: { workspace: { members: { some: { userId: string } } } };
      OR: Array<{ title?: { contains: string; mode: string }; description?: { contains: string; mode: string } }>;
    };
    take: number;
  };
  assert.equal(taskArgs.where.project.workspace.members.some.userId, "user-1");
  assert.deepEqual(taskArgs.where.OR, [
    { title: { contains: "StraSSe plan", mode: "insensitive" } },
    { description: { contains: "StraSSe plan", mode: "insensitive" } },
  ]);
  assert.equal(taskArgs.take, 8);
});

test("does not query the database for fewer than two normalized characters", async () => {
  let queries = 0;
  const service = makeService({
    project: { findMany: async () => { queries += 1; return []; } },
    task: { findMany: async () => { queries += 1; return []; } },
  });

  assert.deepEqual(await service.search("user-1", "  x "), { projects: [], tasks: [] });
  assert.equal(queries, 0);
});

test("rejects missing, non-string, control-character, and overlong queries", async () => {
  const service = makeService({});
  for (const query of [undefined, ["two"], "bad\u0000query", "x".repeat(101)]) {
    await assert.rejects(
      service.search("user-1", query),
      (error: unknown) => error instanceof BadRequestException,
    );
  }
});
