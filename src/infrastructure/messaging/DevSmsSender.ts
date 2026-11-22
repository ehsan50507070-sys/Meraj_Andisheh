import type { ILogger } from '../../core/abstractions/ILogger';
import type { ISmsSender } from '../../core/abstractions/smsSender';

export class DevSmsSender implements ISmsSender {
  private readonly logger: ILogger;
  private readonly logPrefix: string;

  constructor(logger: ILogger, logPrefix = 'DEV_SMS') {
    this.logger = logger;
    this.logPrefix = logPrefix;
  }

  public async sendOtpAsync(
    phoneNumber: string,
    code: string,
    message: string,
  ): Promise<void> {
    this.logger.info(`${this.logPrefix}: [${phoneNumber}] ${message}`, {
      phoneNumber,
      otpCode: code,
    });
  }
}
