import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/\S/, { message: "Workspace name must include a visible character." })
  name!: string;
}

export class UpdateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/\S/, { message: "Workspace name must include a visible character." })
  name!: string;
}

export class CreateInvitationDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(["ADMIN", "MEMBER"])
  role!: "ADMIN" | "MEMBER";
}

export class UpdateMemberRoleDto {
  @IsIn(["ADMIN", "MEMBER"])
  role!: "ADMIN" | "MEMBER";
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;
}
