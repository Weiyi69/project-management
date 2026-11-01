import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { AnalyticsService } from "./analytics.service";

@UseGuards(AuthGuard)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("workspaces/:workspaceId")
  getWorkspace(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
  ) {
    return this.analytics.getWorkspaceAnalytics(request.user!.id, workspaceId);
  }

  @Get("workspaces/:workspaceId/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="workspace-analytics.csv"')
  exportWorkspace(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
  ) {
    return this.analytics.exportWorkspaceCsv(request.user!.id, workspaceId);
  }

  @Get("projects/:projectId")
  getProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ) {
    return this.analytics.getProjectAnalytics(request.user!.id, projectId);
  }

  @Get("projects/:projectId/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="project-analytics.csv"')
  exportProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ) {
    return this.analytics.exportProjectCsv(request.user!.id, projectId);
  }
}
