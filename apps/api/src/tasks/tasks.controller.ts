import {
  Body,
  Controller,
  Delete,
  Get,
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
  ProjectLabelSummary,
  ProjectTasksResponse,
  TaskCommentSummary,
  TaskDetail,
} from "@orbit/contracts";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import {
  CreateProjectLabelDto,
  CreateTaskCommentDto,
  CreateTaskDependencyDto,
  CreateTaskDto,
  UpdateProjectLabelDto,
  UpdateTaskCommentDto,
  UpdateTaskDto,
} from "./task.dto";
import { TasksService } from "./tasks.service";

@ApiTags("tasks")
@UseGuards(AuthGuard)
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get("projects/:projectId/tasks")
  @ApiOperation({ summary: "List project tasks and task workspace options" })
  async listProjectTasks(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ): Promise<ProjectTasksResponse> {
    return this.tasks.listProjectTasks(request.user!.id, projectId);
  }

  @Post("projects/:projectId/tasks")
  @ApiOperation({ summary: "Create a task in a project" })
  async createTask(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body() input: CreateTaskDto,
  ): Promise<{ task: TaskDetail }> {
    return { task: await this.tasks.createTask(request.user!.id, projectId, input) };
  }

  @Get("projects/:projectId/labels")
  async listLabels(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ): Promise<{ labels: ProjectLabelSummary[] }> {
    return { labels: await this.tasks.listLabels(request.user!.id, projectId) };
  }

  @Post("projects/:projectId/labels")
  async createLabel(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body() input: CreateProjectLabelDto,
  ): Promise<{ label: ProjectLabelSummary }> {
    return { label: await this.tasks.createLabel(request.user!.id, projectId, input) };
  }

  @Patch("projects/:projectId/labels/:labelId")
  async updateLabel(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("labelId", new ParseUUIDPipe()) labelId: string,
    @Body() input: UpdateProjectLabelDto,
  ): Promise<{ label: ProjectLabelSummary }> {
    return { label: await this.tasks.updateLabel(request.user!.id, projectId, labelId, input) };
  }

  @Delete("projects/:projectId/labels/:labelId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLabel(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("labelId", new ParseUUIDPipe()) labelId: string,
  ): Promise<void> {
    await this.tasks.deleteLabel(request.user!.id, projectId, labelId);
  }

  @Get("tasks/:taskId")
  async getTask(
    @Req() request: AuthenticatedRequest,
    @Param("taskId", new ParseUUIDPipe()) taskId: string,
  ): Promise<{ task: TaskDetail }> {
    return { task: await this.tasks.getTask(request.user!.id, taskId) };
  }

  @Patch("tasks/:taskId")
  async updateTask(
    @Req() request: AuthenticatedRequest,
    @Param("taskId", new ParseUUIDPipe()) taskId: string,
    @Body() input: UpdateTaskDto,
  ): Promise<{ task: TaskDetail }> {
    return { task: await this.tasks.updateTask(request.user!.id, taskId, input) };
  }

  @Delete("tasks/:taskId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTask(
    @Req() request: AuthenticatedRequest,
    @Param("taskId", new ParseUUIDPipe()) taskId: string,
  ): Promise<void> {
    await this.tasks.deleteTask(request.user!.id, taskId);
  }

  @Post("tasks/:taskId/comments")
  async createComment(
    @Req() request: AuthenticatedRequest,
    @Param("taskId", new ParseUUIDPipe()) taskId: string,
    @Body() input: CreateTaskCommentDto,
  ): Promise<{ comment: TaskCommentSummary }> {
    return { comment: await this.tasks.createComment(request.user!.id, taskId, input.body) };
  }

  @Patch("comments/:commentId")
  async updateComment(
    @Req() request: AuthenticatedRequest,
    @Param("commentId", new ParseUUIDPipe()) commentId: string,
    @Body() input: UpdateTaskCommentDto,
  ): Promise<{ comment: TaskCommentSummary }> {
    return { comment: await this.tasks.updateComment(request.user!.id, commentId, input.body) };
  }

  @Delete("comments/:commentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @Req() request: AuthenticatedRequest,
    @Param("commentId", new ParseUUIDPipe()) commentId: string,
  ): Promise<void> {
    await this.tasks.deleteComment(request.user!.id, commentId);
  }

  @Post("tasks/:taskId/dependencies")
  async addDependency(
    @Req() request: AuthenticatedRequest,
    @Param("taskId", new ParseUUIDPipe()) taskId: string,
    @Body() input: CreateTaskDependencyDto,
  ): Promise<{ task: TaskDetail }> {
    return {
      task: await this.tasks.addDependency(request.user!.id, taskId, input.dependsOnTaskId),
    };
  }

  @Delete("tasks/:taskId/dependencies/:dependsOnTaskId")
  async removeDependency(
    @Req() request: AuthenticatedRequest,
    @Param("taskId", new ParseUUIDPipe()) taskId: string,
    @Param("dependsOnTaskId", new ParseUUIDPipe()) dependsOnTaskId: string,
  ): Promise<{ task: TaskDetail }> {
    return {
      task: await this.tasks.removeDependency(request.user!.id, taskId, dependsOnTaskId),
    };
  }
}
