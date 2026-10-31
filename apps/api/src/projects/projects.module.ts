import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { WorkspacesModule } from "../workspaces/workspaces.module";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
