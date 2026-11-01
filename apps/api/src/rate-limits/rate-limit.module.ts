import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RateLimitService } from "./rate-limit.service";

@Module({
  imports: [PrismaModule],
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
