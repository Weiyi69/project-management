import { Module } from "@nestjs/common";
import { ActivityModule } from "../activity/activity.module";
import { AuthModule } from "../auth/auth.module";
import { EmailModule } from "../email/email.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspaceAccessService } from "./workspace-access.service";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({
  imports: [ActivityModule, AuthModule, EmailModule, NotificationsModule, PrismaModule, RealtimeModule],
  controllers: [WorkspacesController],
  providers: [WorkspaceAccessService, WorkspacesService],
  exports: [WorkspaceAccessService],
})
export class WorkspacesModule {}
