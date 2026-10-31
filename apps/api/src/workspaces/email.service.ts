import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendWorkspaceInvitation(input: {
    email: string;
    inviterName: string;
    workspaceName: string;
    role: "ADMIN" | "MEMBER";
    invitationUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;
    if (!host || !from) {
      throw new ServiceUnavailableException(
        "Invitation email is not configured. Set SMTP_HOST and SMTP_FROM, then try again.",
      );
    }
    if (process.env.SMTP_USER && !process.env.SMTP_PASSWORD) {
      throw new ServiceUnavailableException(
        "SMTP_PASSWORD is required when SMTP_USER is configured.",
      );
    }

    const port = Number(process.env.SMTP_PORT ?? "587");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ServiceUnavailableException("SMTP_PORT must be a valid TCP port.");
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      ...(process.env.SMTP_USER
        ? {
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD ?? "",
            },
          }
        : {}),
    });
    const roleLabel = input.role === "ADMIN" ? "an admin" : "a member";

    try {
      await transporter.sendMail({
        from,
        to: input.email,
        subject: `You're invited to join ${input.workspaceName} on ORBIT`,
        text: `${input.inviterName} invited you to join ${input.workspaceName} as ${roleLabel}.\n\nAccept your invitation: ${input.invitationUrl}\n\nThis invitation expires on ${input.expiresAt.toISOString()}.`,
        html: `<p>${this.escapeHtml(input.inviterName)} invited you to join <strong>${this.escapeHtml(input.workspaceName)}</strong> as ${roleLabel}.</p><p><a href="${this.escapeHtml(input.invitationUrl)}">Accept your invitation</a></p><p>This invitation expires on ${this.escapeHtml(input.expiresAt.toUTCString())}.</p>`,
      });
    } catch (error) {
      this.logger.error(
        "Failed to send workspace invitation email.",
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        "The invitation could not be emailed. Check the SMTP configuration and try again.",
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
