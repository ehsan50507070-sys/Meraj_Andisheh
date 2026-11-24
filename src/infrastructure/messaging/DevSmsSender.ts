import type { ILogger } from '../../core/abstractions/ILogger';
import type { ISmsSender } from '../../core/abstractions/smsSender';

export class DevSmsSender implements ISmsSender {
  private readonly logger: ILogger;
  private readonly logPrefix: string;
  private readonly isDevelopment: boolean;

  constructor(logger: ILogger, logPrefix = 'DEV_SMS', isDevelopment = true) {
    this.logger = logger;
    this.logPrefix = logPrefix;
    this.isDevelopment = isDevelopment;
  }

  public async sendOtpAsync(
    phoneNumber: string,
    code: string,
    message: string,
  ): Promise<void> {
    if (!this.isDevelopment) {
      this.logger.info(`${this.logPrefix}: [${phoneNumber}] OTP_DISPATCHED`, {
        phoneNumber,
      });
      return;
    }

    this.logger.info(`${this.logPrefix}: [${phoneNumber}] ${message}`, {
      phoneNumber,
      otpCode: code,
    });
  }
}
