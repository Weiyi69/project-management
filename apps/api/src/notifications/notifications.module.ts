import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EmailModule } from "../email/email.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsWorkerService } from "./notifications-worker.service";

@Module({
  imports: [AuthModule, EmailModule, PrismaModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsWorkerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
