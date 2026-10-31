import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { EmailService } from "./email.service";
import { WorkspaceAccessService } from "./workspace-access.service";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({
  imports: [AuthModule, PrismaModule, RealtimeModule],
  controllers: [WorkspacesController],
  providers: [EmailService, WorkspaceAccessService, WorkspacesService],
  exports: [WorkspaceAccessService],
})
export class WorkspacesModule {}
