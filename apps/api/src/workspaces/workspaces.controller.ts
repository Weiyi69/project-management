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
  InvitationSummary,
  PendingWorkspaceInvitation,
  WorkspaceMemberSummary,
  WorkspaceSummary,
} from "@orbit/contracts";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  CreateWorkspaceDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
} from "./workspace.dto";
import { WorkspacesService } from "./workspaces.service";

@ApiTags("workspaces")
@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get("invitations/preview/:token")
  @ApiOperation({ summary: "Preview a workspace invitation before signing in" })
  async previewInvitation(
    @Param("token") token: string,
  ): Promise<{ invitation: Awaited<ReturnType<WorkspacesService["previewInvitation"]>> }> {
    return { invitation: await this.workspaces.previewInvitation(token) };
  }

  @Post("invitations/accept")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept a workspace invitation for the signed-in email" })
  async acceptInvitation(
    @Req() request: AuthenticatedRequest,
    @Body() input: AcceptInvitationDto,
  ): Promise<{ workspace: WorkspaceSummary }> {
    return { workspace: await this.workspaces.acceptInvitation(request.user!.id, input.token) };
  }

  @Get("invitations/pending")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "List invitations addressed to the signed-in verified email" })
  async listPendingInvitations(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ invitations: PendingWorkspaceInvitation[] }> {
    return { invitations: await this.workspaces.listPendingInvitations(request.user!.id) };
  }

  @Post("invitations/:invitationId/accept")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Accept a pending invitation addressed to the signed-in email" })
  async acceptPendingInvitation(
    @Req() request: AuthenticatedRequest,
    @Param("invitationId", new ParseUUIDPipe()) invitationId: string,
  ): Promise<{ workspace: WorkspaceSummary }> {
    return {
      workspace: await this.workspaces.acceptPendingInvitation(request.user!.id, invitationId),
    };
  }

  @Post("invitations/:invitationId/decline")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Decline a pending invitation addressed to the signed-in email" })
  async declinePendingInvitation(
    @Req() request: AuthenticatedRequest,
    @Param("invitationId", new ParseUUIDPipe()) invitationId: string,
  ): Promise<void> {
    await this.workspaces.declinePendingInvitation(request.user!.id, invitationId);
  }

  @Get("workspaces")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "List workspaces available to the signed-in user" })
  async list(@Req() request: AuthenticatedRequest): Promise<{ workspaces: WorkspaceSummary[] }> {
    return { workspaces: await this.workspaces.list(request.user!.id) };
  }

  @Post("workspaces")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Create a workspace owned by the signed-in user" })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateWorkspaceDto,
  ): Promise<{ workspace: WorkspaceSummary }> {
    return { workspace: await this.workspaces.create(request.user!.id, input.name) };
  }

  @Get("workspaces/:workspaceId")
  @UseGuards(AuthGuard)
  async get(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
  ): Promise<{ workspace: WorkspaceSummary }> {
    return { workspace: await this.workspaces.get(workspaceId, request.user!.id) };
  }

  @Patch("workspaces/:workspaceId")
  @UseGuards(AuthGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Body() input: UpdateWorkspaceDto,
  ): Promise<{ workspace: WorkspaceSummary }> {
    return {
      workspace: await this.workspaces.update(workspaceId, request.user!.id, input.name),
    };
  }

  @Delete("workspaces/:workspaceId")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
  ): Promise<void> {
    await this.workspaces.delete(workspaceId, request.user!.id);
  }

  @Get("workspaces/:workspaceId/members")
  @UseGuards(AuthGuard)
  async listMembers(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
  ): Promise<{ members: WorkspaceMemberSummary[] }> {
    return { members: await this.workspaces.listMembers(workspaceId, request.user!.id) };
  }

  @Patch("workspaces/:workspaceId/members/:userId")
  @UseGuards(AuthGuard)
  async updateMemberRole(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateMemberRoleDto,
  ): Promise<{ member: WorkspaceMemberSummary }> {
    return {
      member: await this.workspaces.updateMemberRole(
        workspaceId,
        request.user!.id,
        userId,
        input.role,
      ),
    };
  }

  @Delete("workspaces/:workspaceId/members/:userId")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("userId", new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.workspaces.removeMember(workspaceId, request.user!.id, userId);
  }

  @Get("workspaces/:workspaceId/invitations")
  @UseGuards(AuthGuard)
  async listInvitations(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
  ): Promise<{ invitations: InvitationSummary[] }> {
    return { invitations: await this.workspaces.listInvitations(workspaceId, request.user!.id) };
  }

  @Post("workspaces/:workspaceId/invitations")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Body() input: CreateInvitationDto,
  ): Promise<{ invitation: InvitationSummary }> {
    return {
      invitation: await this.workspaces.createInvitation(
        workspaceId,
        request.user!.id,
        input,
      ),
    };
  }

  @Delete("workspaces/:workspaceId/invitations/:invitationId")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("invitationId", new ParseUUIDPipe()) invitationId: string,
  ): Promise<void> {
    await this.workspaces.revokeInvitation(workspaceId, request.user!.id, invitationId);
  }
}
