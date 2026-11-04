import { Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AccountModule } from "./account/account.module";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { ProjectsModule } from "./projects/projects.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { GlobalSearchModule } from "./search/global-search.module";
import { TasksModule } from "./tasks/tasks.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({
  imports: [
    AuthModule,
    AccountModule,
    ProjectsModule,
    TasksModule,
    WorkspacesModule,
    RealtimeModule,
    GlobalSearchModule,
    NotificationsModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
