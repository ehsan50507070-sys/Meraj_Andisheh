import type { IEmailSender } from '../../core/abstractions/emailSender';
import type { ILogger } from '../../core/abstractions/ILogger';

export class DevEmailSender implements IEmailSender {
  private readonly logger: ILogger;
  private readonly logPrefix: string;

  constructor(logger: ILogger, logPrefix = 'DEV_EMAIL') {
    this.logger = logger;
    this.logPrefix = logPrefix;
  }

  public async sendAsync(
    toEmail: string,
    subject: string,
    body: string,
    actionUrl?: string,
  ): Promise<void> {
    const linkText = actionUrl ? ` | ${actionUrl}` : '';
    this.logger.info(`${this.logPrefix}: [${toEmail}] ${subject} — ${body}${linkText}`, {
      toEmail,
      subject,
      actionUrl: actionUrl ?? null,
    });
  }
}
