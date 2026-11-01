import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { RateLimitModule } from "../rate-limits/rate-limit.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

@Module({
  imports: [EmailModule, PrismaModule, RateLimitModule, RealtimeModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
})
export class AuthModule {}
