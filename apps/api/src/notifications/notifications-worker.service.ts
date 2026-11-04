import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

const WORKER_INTERVAL_MS = 15_000;

@Injectable()
export class NotificationsWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsWorkerService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly notifications: NotificationsService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.runOnce(), WORKER_INTERVAL_MS);
    this.timer.unref();
    void this.runOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.notifications.createDueDateReminders(now);
      await this.notifications.processPendingEmailDeliveries();
    } catch (error) {
      this.logger.error(
        "Notification worker cycle failed.",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
