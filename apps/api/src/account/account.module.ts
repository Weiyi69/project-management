import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EmailModule } from "../email/email.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RateLimitModule } from "../rate-limits/rate-limit.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";
import { ProfilePhotoUploadInterceptor } from "./profile-photo-upload.interceptor";

@Module({
  imports: [AuthModule, EmailModule, PrismaModule, RateLimitModule, RealtimeModule],
  controllers: [AccountController],
  providers: [AccountService, ProfilePhotoUploadInterceptor],
})
export class AccountModule {}
