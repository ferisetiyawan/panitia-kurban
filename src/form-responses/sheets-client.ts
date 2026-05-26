import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { google, sheets_v4 } from 'googleapis';

@Injectable()
export class SheetsClient implements OnModuleInit {
  private readonly logger = new Logger(SheetsClient.name);
  private sheets?: sheets_v4.Sheets;

  onModuleInit() {
    const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyBase64) {
      this.logger.warn(
        'GOOGLE_SERVICE_ACCOUNT_KEY not set — SheetsClient disabled',
      );
      return;
    }
    try {
      const keyJson = Buffer.from(keyBase64, 'base64').toString('utf-8');
      const credentials = JSON.parse(keyJson);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
      this.sheets = google.sheets({ version: 'v4', auth });
    } catch (e) {
      const err = e as Error;
      console.error('[sheets-client init]', err.stack || err.message);
      this.logger.error(
        'SheetsClient init failed — disabled (will throw on use)',
      );
    }
  }

  async readRange(spreadsheetId: string, range: string): Promise<string[][]> {
    if (!this.sheets) {
      throw new Error(
        'SheetsClient not initialized (missing service account key)',
      );
    }
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const raw = res.data.values ?? [];
    return raw.map(row =>
      row.map(cell => (cell == null ? '' : String(cell))),
    );
  }
}
