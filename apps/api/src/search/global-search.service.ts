import { BadRequestException, Injectable } from "@nestjs/common";
import type { GlobalSearchResponse } from "@orbit/contracts";
import { PrismaService } from "../prisma/prisma.service";

const SEARCH_RESULT_LIMIT = 8;
const MAX_QUERY_LENGTH = 100;

@Injectable()
export class GlobalSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, rawQuery: unknown): Promise<GlobalSearchResponse> {
    const query = this.normalizeQuery(rawQuery);
    if (Array.from(query).length < 2) {
      return { projects: [], tasks: [] };
    }

    const membership = { workspace: { members: { some: { userId } } } };
    const [projects, tasks] = await Promise.all([
      this.prisma.project.findMany({
        where: {
          ...membership,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          workspace: { select: { id: true, name: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: SEARCH_RESULT_LIMIT,
      }),
      this.prisma.task.findMany({
        where: {
          project: {
            ...membership,
          },
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          projectId: true,
          title: true,
          description: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
        take: SEARCH_RESULT_LIMIT,
      }),
    ]);

    return { projects, tasks };
  }

  private normalizeQuery(rawQuery: unknown): string {
    if (typeof rawQuery !== "string") {
      throw new BadRequestException("A search query is required.");
    }

    const query = rawQuery.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(query)) {
      throw new BadRequestException("The search query contains invalid characters.");
    }
    if (Array.from(query).length > MAX_QUERY_LENGTH) {
      throw new BadRequestException(`The search query must be ${MAX_QUERY_LENGTH} characters or fewer.`);
    }
    return query;
  }
}
