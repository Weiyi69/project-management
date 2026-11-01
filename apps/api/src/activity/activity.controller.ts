import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { WorkspaceActivitySummary } from "@orbit/contracts";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { ActivityService } from "./activity.service";

@ApiTags("activity")
@Controller("workspaces/:workspaceId/activity")
@UseGuards(AuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @ApiOperation({ summary: "List recent project and task activity in a workspace" })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
  ): Promise<{ activities: WorkspaceActivitySummary[] }> {
    return {
      activities: await this.activity.listWorkspaceActivity(workspaceId, request.user!.id),
    };
  }
}
