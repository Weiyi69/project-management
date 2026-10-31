import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  ProjectResponse,
  ProjectsResponse,
} from "@orbit/contracts";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { CreateProjectDto, UpdateProjectDto } from "./project.dto";
import { ProjectsService } from "./projects.service";

@ApiTags("projects")
@UseGuards(AuthGuard)
@Controller()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get("projects")
  @ApiOperation({ summary: "List projects in the signed-in user's workspaces" })
  async listProjects(
    @Req() request: AuthenticatedRequest,
    @Headers("x-workspace-id") workspaceId?: string,
  ): Promise<ProjectsResponse> {
    return {
      projects: await this.projectsService.listProjects(request.user!.id, workspaceId),
    };
  }

  @Post("projects")
  @ApiOperation({ summary: "Create a project in the user's current workspace" })
  async createProject(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateProjectDto,
    @Headers("x-workspace-id") workspaceId?: string,
  ): Promise<ProjectResponse> {
    return {
      project: await this.projectsService.createProject(request.user!.id, input, workspaceId),
    };
  }

  @Get("projects/:projectId")
  @ApiOperation({ summary: "Get a project accessible to the signed-in user" })
  async getProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ): Promise<ProjectResponse> {
    return { project: await this.projectsService.getProject(request.user!.id, projectId) };
  }

  @Patch("projects/:projectId")
  @ApiOperation({ summary: "Update project details or lifecycle state" })
  async updateProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body() input: UpdateProjectDto,
  ): Promise<ProjectResponse> {
    return {
      project: await this.projectsService.updateProject(request.user!.id, projectId, input),
    };
  }

  @Delete("projects/:projectId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Permanently delete a project and its project data" })
  async deleteProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ): Promise<void> {
    await this.projectsService.deleteProject(request.user!.id, projectId);
  }
}
