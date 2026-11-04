import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { ProjectLifecycle, ProjectMemberRole } from "../generated/prisma/enums";

export class CreateProjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/, { message: "Project name must include a visible character." })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateProjectDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/, { message: "Project name must include a visible character." })
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ProjectLifecycle)
  state?: ProjectLifecycle;
}

export class AddProjectMemberDto {
  @IsUUID()
  userId!: string;

  @IsEnum(ProjectMemberRole)
  projectRole!: ProjectMemberRole;
}

export class UpdateProjectMemberRoleDto {
  @IsEnum(ProjectMemberRole)
  projectRole!: ProjectMemberRole;
}
