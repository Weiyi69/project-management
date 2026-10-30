import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AuthGuard } from "./auth.guard";
import { clearSessionCookie, getSessionToken, setSessionCookie } from "./auth-session";
import { LoginDto, RegisterDto } from "./auth.dto";
import { AuthService } from "./auth.service";
import type { AuthenticatedRequest } from "./auth.types";

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create an account and its starter workspace" })
  async register(
    @Body() input: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: NonNullable<AuthenticatedRequest["user"]> }> {
    const result = await this.authService.register(input);
    setSessionCookie(response, result.sessionToken);
    return { user: result.user };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in and create a browser session" })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: NonNullable<AuthenticatedRequest["user"]> }> {
    const result = await this.authService.login(input);
    setSessionCookie(response, result.sessionToken);
    return { user: result.user };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the current browser session" })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    await this.authService.logout(getSessionToken(request.headers.cookie));
    clearSessionCookie(response);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "Return the current authenticated user" })
  getCurrentUser(@Req() request: AuthenticatedRequest): {
    user: NonNullable<AuthenticatedRequest["user"]>;
  } {
    return { user: request.user! };
  }
}
