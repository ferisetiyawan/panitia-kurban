import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WaNotifierService {
  private readonly logger = new Logger(WaNotifierService.name);
  private readonly baseUrl = process.env.WA_BOT_URL;
  private readonly apiKey = process.env.WA_BOT_API_KEY;
  private readonly targetPhone = process.env.WA_NOTIFY_PHONE;

  send(message: string): void {
    if (!this.targetPhone) {
      this.logger.warn('WA_NOTIFY_PHONE not set, skipping');
      return;
    }
    this.sendTo(this.targetPhone, message);
  }

  async sendTo(phone: string, message: string): Promise<boolean> {
    if (!this.baseUrl || !this.apiKey) {
      this.logger.warn('WA notifier not configured, skipping');
      return false;
    }
    try {
      const res = await fetch(`${this.baseUrl}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ to: phone, message }),
      });
      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`WA send to ${phone} failed ${res.status}: ${text}`);
        return false;
      }
      return true;
    } catch (e) {
      const err = e as Error;
      this.logger.error(`[wa-notifier.sendTo] ${err.stack || err.message}`);
      return false;
    }
  }
}
