export interface ISmsSender {
  sendOtpAsync(phoneNumber: string, code: string, message: string): Promise<void>;
}
