export interface IEmailSender {
  sendAsync(
    toEmail: string,
    subject: string,
    body: string,
    actionUrl?: string,
  ): Promise<void>;
}
