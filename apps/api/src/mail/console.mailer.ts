import { Logger } from '@nestjs/common';
import type { Mailer, MailMessage } from './mailer';

/**
 * Development-only transport: prints emails (including their one-time links) to the log.
 * Config validation refuses this transport when NODE_ENV=production.
 */
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('ConsoleMailer');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      `\n--- email (dev only) ---\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n-----------------------`,
    );
  }
}
