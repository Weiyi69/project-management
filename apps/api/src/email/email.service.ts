import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

type AuthCodeEmailPurpose = "verification" | "password-reset" | "email-change";
type MailMessage = { to: string; subject: string; text: string; html: string };
const testOutbox: MailMessage[] = [];

export class EmailDeliveryError extends ServiceUnavailableException {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly failureCode: string,
  ) {
    super(message);
  }
}

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
    const emailChange = input.purpose === "email-change";
    const purpose = verification ? "email verification" : emailChange ? "email change" : "password reset";
    await this.sendMail({
      to: input.email,
      subject: `Your ORBIT ${purpose} code`,
      text: `Your ORBIT ${purpose} code is ${input.code}.\n\nThis code expires at ${input.expiresAt.toUTCString()} and can only be used once. If you did not request this, you can ignore this email.`,
      html: `<p>Your ORBIT ${purpose} code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${input.code}</p><p>This code expires at ${this.escapeHtml(
        input.expiresAt.toUTCString(),
      )} and can only be used once. If you did not request this, you can ignore this email.</p>`,
    });
  }

  async sendNotification(input: {
    email: string;
    type: string;
    taskTitle: string | null;
    projectName: string | null;
    actorName: string | null;
    dueDate?: Date | null;
  }): Promise<void> {
    const actor = input.actorName ?? "Someone";
    const task = input.taskTitle ?? "a task";
    const descriptions: Record<string, string> = {
      TASK_ASSIGNED: `${actor} assigned you ${task}.`,
      TASK_MENTIONED: `${actor} mentioned you on ${task}.`,
      COMMENT_ADDED: `${actor} commented on ${task}.`,
      DUE_DATE_REMINDER: input.dueDate && input.dueDate.getTime() <= Date.now()
        ? `${task} is overdue.`
        : `${task} is due soon.`,
      PROJECT_UPDATED: `${actor} updated ${input.projectName ?? "a project"}.`,
      INVITATION_RECEIVED: `${actor} invited you to a workspace.`,
    };
    const description = descriptions[input.type] ?? "You have a new ORBIT notification.";
    await this.sendMail({
      to: input.email,
      subject: "You have a new ORBIT notification",
      text: `${description}${input.projectName ? `\nProject: ${input.projectName}` : ""}\n\nSign in to ORBIT to view the update.`,
      html: `<p>${this.escapeHtml(description)}</p>${
        input.projectName ? `<p>Project: ${this.escapeHtml(input.projectName)}</p>` : ""
      }<p>Sign in to ORBIT to view the update.</p>`,
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
      throw new EmailDeliveryError(
        "Email delivery is not configured. Set SMTP_HOST and SMTP_FROM.",
        false,
        "SMTP_NOT_CONFIGURED",
      );
    }
    if (process.env.SMTP_USER && !process.env.SMTP_PASSWORD) {
      this.logger.error("SMTP authentication is missing its configured password.");
      throw new EmailDeliveryError(
        "SMTP_PASSWORD is required when SMTP_USER is configured.",
        false,
        "SMTP_AUTH_NOT_CONFIGURED",
      );
    }

    const port = Number(process.env.SMTP_PORT ?? "587");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this.logger.error("SMTP_PORT is not a valid TCP port.");
      throw new EmailDeliveryError("SMTP_PORT must be a valid TCP port.", false, "SMTP_INVALID_PORT");
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" } }
        : {}),
    });

    try {
      await transporter.sendMail({ from, ...message });
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      const details = error && typeof error === "object"
        ? error as { code?: unknown; responseCode?: unknown }
        : {};
      const code = typeof details.code === "string" ? details.code : "SMTP_ERROR";
      const responseCode = typeof details.responseCode === "number" ? details.responseCode : undefined;
      const retryable = responseCode !== undefined
        ? responseCode >= 400 && responseCode < 500
        : ["ETIMEDOUT", "ECONNECTION", "ECONNRESET", "EAI_AGAIN", "ESOCKET"].includes(code);
      this.logger.error("Email delivery failed. Verify SMTP configuration and connectivity.");
      throw new EmailDeliveryError(
        "Email delivery is temporarily unavailable. Please try again later.",
        retryable,
        code.slice(0, 64),
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
