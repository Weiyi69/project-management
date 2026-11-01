import "reflect-metadata";
import { config } from "dotenv";
import { resolve } from "node:path";
import { EmailService } from "./email.service";

config({ path: resolve(__dirname, "../../../../.env") });

async function main(): Promise<void> {
  if (process.env.RUN_GMAIL_SMOKE_TEST !== "true") {
    throw new Error("Set RUN_GMAIL_SMOKE_TEST=true to explicitly enable real email delivery.");
  }
  const recipient = process.env.GMAIL_SMOKE_TEST_RECIPIENT;
  if (!recipient) {
    throw new Error("Set GMAIL_SMOKE_TEST_RECIPIENT to a mailbox you control.");
  }

  await new EmailService().sendDeliverySmokeTest(recipient);
  console.log("Gmail SMTP smoke test email sent. Check the designated test mailbox.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Gmail SMTP smoke test failed.");
  process.exitCode = 1;
});
