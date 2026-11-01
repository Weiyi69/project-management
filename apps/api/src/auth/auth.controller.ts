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
import type { Request, Response } from "express";
import { AuthGuard } from "./auth.guard";
import { clearSessionCookie, getSessionToken, setSessionCookie } from "./auth-session";
import { EmailCodeDto, EmailOnlyDto, LoginDto, PasswordResetDto, RegisterDto } from "./auth.dto";
import { AuthService } from "./auth.service";
import type { AuthenticatedRequest } from "./auth.types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function clientAddress(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create an account and its starter workspace" })
  async register(
    @Body() input: RegisterDto,
    @Req() request: Request,
  ): Promise<{
    email: string;
    verificationRequired: true;
    resendCooldownSeconds: number;
  }> {
    const email = input.email.trim().toLowerCase();
    await this.authService.enforceRateLimit("register-ip", clientAddress(request), 10, HOUR);
    await this.authService.enforceRateLimit("register-email", email, 5, HOUR);
    return this.authService.register({ ...input, email });
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify an email address using its one-time code" })
  async verifyEmail(
    @Body() input: EmailCodeDto,
    @Req() request: Request,
  ): Promise<{ verified: true }> {
    const email = input.email.trim().toLowerCase();
    await this.authService.enforceRateLimit("verify-ip", clientAddress(request), 20, 15 * MINUTE);
    await this.authService.enforceRateLimit("verify-email", email, 10, 15 * MINUTE);
    return this.authService.verifyEmail({ ...input, email });
  }

  @Post("resend-verification")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send another email verification code" })
  async resendVerification(
    @Body() input: EmailOnlyDto,
    @Req() request: Request,
  ): Promise<{ message: string; resendCooldownSeconds: number }> {
    const email = input.email.trim().toLowerCase();
    await this.authService.enforceRateLimit("resend-verification-ip", clientAddress(request), 10, HOUR);
    await this.authService.enforceRateLimit("resend-verification-email", email, 5, HOUR);
    return this.authService.resendVerification(email);
  }

  @Post("password-reset/request")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Request a password reset email" })
  async requestPasswordReset(
    @Body() input: EmailOnlyDto,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    const email = input.email.trim().toLowerCase();
    await this.authService.enforceRateLimit("password-reset-request-ip", clientAddress(request), 10, HOUR);
    await this.authService.enforceRateLimit("password-reset-request-email", email, 5, HOUR);
    return this.authService.requestPasswordReset(email);
  }

  @Post("password-reset/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset a password using its one-time email code" })
  async resetPassword(
    @Body() input: PasswordResetDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ reset: true }> {
    const email = input.email.trim().toLowerCase();
    await this.authService.enforceRateLimit("password-reset-confirm-ip", clientAddress(request), 20, 15 * MINUTE);
    await this.authService.enforceRateLimit("password-reset-confirm-email", email, 10, 15 * MINUTE);
    const result = await this.authService.resetPassword({ ...input, email });
    clearSessionCookie(response);
    return result;
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sign in and create a browser session" })
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: NonNullable<AuthenticatedRequest["user"]> }> {
    const email = input.email.trim().toLowerCase();
    await this.authService.enforceRateLimit("login-ip", clientAddress(request), 20, 15 * MINUTE);
    await this.authService.enforceRateLimit("login-email", email, 10, 15 * MINUTE);
    const result = await this.authService.login({ ...input, email });
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
