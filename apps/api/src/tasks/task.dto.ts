import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsHexColor,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { TaskPriority } from "../generated/prisma/enums";

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: "Task title must include a visible character." })
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsUUID()
  statusId!: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID("all", { each: true })
  labelIds?: string[];
}

export class UpdateTaskDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: "Task title must include a visible character." })
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  statusId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsUUID()
  assigneeId?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsDateString()
  startDate?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsDateString()
  dueDate?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID("all", { each: true })
  labelIds?: string[];
}

export class CreateTaskCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/, { message: "Comment must include a visible character." })
  body!: string;
}

export class UpdateTaskCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/, { message: "Comment must include a visible character." })
  body!: string;
}

export class CreateTaskDependencyDto {
  @IsUUID()
  dependsOnTaskId!: string;
}

export class CreateProjectLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/\S/, { message: "Label name must include a visible character." })
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class UpdateProjectLabelDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/\S/, { message: "Label name must include a visible character." })
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsHexColor()
  color?: string;
}
