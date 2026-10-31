import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { ProjectsModule } from "./projects/projects.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { TasksModule } from "./tasks/tasks.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [AuthModule, ProjectsModule, TasksModule, WorkspacesModule, RealtimeModule, NotificationsModule],
  controllers: [HealthController],
})
export class AppModule {}
