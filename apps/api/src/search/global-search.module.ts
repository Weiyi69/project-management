import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { GlobalSearchController } from "./global-search.controller";
import { GlobalSearchService } from "./global-search.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [GlobalSearchController],
  providers: [GlobalSearchService],
})
export class GlobalSearchModule {}
