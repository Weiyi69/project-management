import { IsEmail, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/\S/, { message: "Name must include a visible character." })
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
