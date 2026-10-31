import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { NotificationsService } from "./notifications.service";

@UseGuards(AuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.notifications.list(request.user!.id);
  }

  @Patch(":notificationId/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Req() request: AuthenticatedRequest,
    @Param("notificationId", new ParseUUIDPipe()) notificationId: string,
  ): Promise<void> {
    await this.notifications.markRead(request.user!.id, notificationId);
  }

  @Patch("read-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.notifications.markAllRead(request.user!.id);
  }
}
