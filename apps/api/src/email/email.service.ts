import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

type AuthCodeEmailPurpose = "verification" | "password-reset";
type MailMessage = { to: string; subject: string; text: string; html: string };
const testOutbox: MailMessage[] = [];

export function takeTestEmails(recipient: string): MailMessage[] {
  const matching = testOutbox.filter((message) => message.to === recipient);
  for (let index = testOutbox.length - 1; index >= 0; index -= 1) {
    if (testOutbox[index]?.to === recipient) testOutbox.splice(index, 1);
  }
  return matching;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendAuthenticationCode(input: {
    email: string;
    code: string;
    purpose: AuthCodeEmailPurpose;
    expiresAt: Date;
  }): Promise<void> {
    const verification = input.purpose === "verification";
    await this.sendMail({
      to: input.email,
      subject: verification ? "Your ORBIT verification code" : "Your ORBIT password reset code",
      text: `Your ORBIT ${verification ? "email verification" : "password reset"} code is ${input.code}.\n\nThis code expires at ${input.expiresAt.toUTCString()} and can only be used once. If you did not request this, you can ignore this email.`,
      html: `<p>Your ORBIT ${
        verification ? "email verification" : "password reset"
      } code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${input.code}</p><p>This code expires at ${this.escapeHtml(
        input.expiresAt.toUTCString(),
      )} and can only be used once. If you did not request this, you can ignore this email.</p>`,
    });
  }

  async sendWorkspaceInvitation(input: {
    email: string;
    inviterName: string;
    workspaceName: string;
    role: "ADMIN" | "MEMBER";
    invitationUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    const roleLabel = input.role === "ADMIN" ? "an admin" : "a member";
    await this.sendMail({
      to: input.email,
      subject: `You're invited to join ${input.workspaceName} on ORBIT`,
      text: `${input.inviterName} invited you to join ${input.workspaceName} as ${roleLabel}.\n\nAccept your invitation: ${input.invitationUrl}\n\nThis invitation expires on ${input.expiresAt.toISOString()}.`,
      html: `<p>${this.escapeHtml(input.inviterName)} invited you to join <strong>${this.escapeHtml(
        input.workspaceName,
      )}</strong> as ${roleLabel}.</p><p><a href="${this.escapeHtml(
        input.invitationUrl,
      )}">Accept your invitation</a></p><p>This invitation expires on ${this.escapeHtml(
        input.expiresAt.toUTCString(),
      )}.</p>`,
    });
  }

  async sendDeliverySmokeTest(email: string): Promise<void> {
    await this.sendMail({
      to: email,
      subject: "ORBIT Gmail SMTP delivery test",
      text: "This message confirms that ORBIT can deliver email using the configured SMTP server.",
      html: "<p>This message confirms that ORBIT can deliver email using the configured SMTP server.</p>",
    });
  }

  private async sendMail(message: MailMessage): Promise<void> {
    if (process.env.ORBIT_EMAIL_MODE === "memory") {
      if (process.env.NODE_ENV !== "test") {
        throw new ServiceUnavailableException("The in-memory email transport is available only in tests.");
      }
      testOutbox.push(message);
      return;
    }

    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;
    if (!host || !from) {
      this.logger.error("Email delivery is not configured.");
      throw new ServiceUnavailableException(
        "Email delivery is not configured. Set SMTP_HOST and SMTP_FROM.",
      );
    }
    if (process.env.SMTP_USER && !process.env.SMTP_PASSWORD) {
      this.logger.error("SMTP authentication is missing its configured password.");
      throw new ServiceUnavailableException("SMTP_PASSWORD is required when SMTP_USER is configured.");
    }

    const port = Number(process.env.SMTP_PORT ?? "587");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this.logger.error("SMTP_PORT is not a valid TCP port.");
      throw new ServiceUnavailableException("SMTP_PORT must be a valid TCP port.");
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" } }
        : {}),
    });

    try {
      await transporter.sendMail({ from, ...message });
    } catch {
      this.logger.error("Email delivery failed. Verify SMTP configuration and connectivity.");
      throw new ServiceUnavailableException(
        "Email delivery is temporarily unavailable. Please try again later.",
      );
    } finally {
      transporter.close();
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character]!;
    });
  }
}
