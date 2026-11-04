import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { clearSessionCookie, getSessionToken } from "../auth/auth-session";
import type { AuthenticatedRequest } from "../auth/auth.types";
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  NotificationPreferenceDto,
  RequestEmailChangeDto,
  UpdateNotificationPreferencesDto,
  UpdateProfileDto,
} from "./account.dto";
import { AccountService } from "./account.service";
import { ProfilePhotoUploadInterceptor } from "./profile-photo-upload.interceptor";

@ApiTags("personal account")
@UseGuards(AuthGuard)
@Controller("account")
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @ApiOperation({ summary: "Get the signed-in user's personal profile" })
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.account.getProfile(request.user!.id);
  }

  @Patch("profile")
  @ApiOperation({ summary: "Update the signed-in user's display name" })
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateProfileDto,
  ) {
    const updated = await this.account.updateProfile(request.user!.id, input);
    request.user!.name = updated.name;
    return updated;
  }

  @Post("email-change")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send an email verification code to a proposed new address" })
  requestEmailChange(
    @Req() request: AuthenticatedRequest,
    @Body() input: RequestEmailChangeDto,
  ) {
    return this.account.requestEmailChange(request.user!.id, input.email);
  }

  @Delete("email-change")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Cancel a pending email change" })
  cancelEmailChange(@Req() request: AuthenticatedRequest): Promise<void> {
    return this.account.cancelEmailChange(request.user!.id);
  }

  @Post("email-change/confirm")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Apply a new email address after code verification" })
  async confirmEmailChange(
    @Req() request: AuthenticatedRequest,
    @Body() input: ConfirmEmailChangeDto,
  ): Promise<void> {
    await this.account.confirmEmailChange(
      request.user!.id,
      input.code,
      getSessionToken(request.headers.cookie),
    );
  }

  @Post("profile-photo")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(ProfilePhotoUploadInterceptor)
  @ApiOperation({ summary: "Upload or replace a profile photo" })
  uploadProfilePhoto(@Req() request: Request & AuthenticatedRequest) {
    return this.account.uploadProfilePhoto(request.user!.id, request.file?.buffer);
  }

  @Get("profile-photo")
  @ApiOperation({ summary: "Get the signed-in user's profile photo" })
  async getProfilePhoto(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const photo = await this.account.getProfilePhoto(request.user!.id);
    if (!photo) {
      response.status(HttpStatus.NOT_FOUND).end();
      return;
    }
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.status(HttpStatus.OK).end(Buffer.from(photo));
  }

  @Delete("profile-photo")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove the signed-in user's profile photo" })
  removeProfilePhoto(@Req() request: AuthenticatedRequest): Promise<void> {
    return this.account.removeProfilePhoto(request.user!.id);
  }

  @Get("notifications")
  @ApiOperation({ summary: "Get personal notification channel preferences" })
  getNotificationPreferences(@Req() request: AuthenticatedRequest) {
    return this.account.getNotificationPreferences(request.user!.id);
  }

  @Put("notifications")
  @ApiOperation({ summary: "Save personal notification channel preferences" })
  updateNotificationPreferences(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateNotificationPreferencesDto,
  ) {
    return this.account.updateNotificationPreferences(request.user!.id, input.preferences);
  }

  @Post("password")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Change the current password and revoke other sessions" })
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() input: ChangePasswordDto,
  ): Promise<void> {
    return this.account.changePassword(
      request.user!.id,
      input,
      getSessionToken(request.headers.cookie),
    );
  }

  @Get("sessions")
  @ApiOperation({ summary: "List safe metadata for the signed-in user's active sessions" })
  listSessions(@Req() request: AuthenticatedRequest) {
    return this.account.listSessions(
      request.user!.id,
      getSessionToken(request.headers.cookie),
    );
  }

  @Delete("sessions/:sessionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke one of the signed-in user's sessions" })
  async revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const result = await this.account.revokeSession(
      request.user!.id,
      sessionId,
      getSessionToken(request.headers.cookie),
    );
    if (result.current) clearSessionCookie(response);
  }

  @Post("sessions/revoke-others")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke all active sessions except this browser session" })
  revokeOtherSessions(@Req() request: AuthenticatedRequest): Promise<void> {
    return this.account.revokeOtherSessions(
      request.user!.id,
      getSessionToken(request.headers.cookie),
    );
  }
}
