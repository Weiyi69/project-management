import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

export class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/\S/, { message: "Name must include a visible character." })
  name!: string;
}

export class RequestEmailChangeDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

const preferenceTypes = [
  "TASK_ASSIGNED",
  "TASK_MENTIONED",
  "COMMENT_ADDED",
  "DUE_DATE_REMINDER",
  "PROJECT_UPDATED",
  "INVITATION_RECEIVED",
] as const;

export class NotificationPreferenceDto {
  @IsIn(preferenceTypes)
  type!: (typeof preferenceTypes)[number];

  @IsBoolean()
  inApp!: boolean;

  @IsBoolean()
  email!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ArrayMinSize(preferenceTypes.length)
  @ArrayUnique((item: NotificationPreferenceDto) => item.type)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  preferences!: NotificationPreferenceDto[];
}
