import fs from 'fs';
import path from 'path';

export interface PaymentActivityLog {
  userId: string;
  bookingId: string;
  action: 'UPLOAD_PROOF' | 'APPROVE_PAYMENT' | 'REJECT_PAYMENT' | 'CHECK_IN' | 'CHECK_OUT';
  timestamp: string;
}

const FILE_PATH = path.join(process.cwd(), 'backend', 'data', 'payment-audit-trail.json');

function ensureDirExists() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class AuditTrailService {
  static getLogs(): PaymentActivityLog[] {
    try {
      ensureDirExists();
      if (!fs.existsSync(FILE_PATH)) return [];
      const data = fs.readFileSync(FILE_PATH, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  static log(userId: string, bookingId: string, action: PaymentActivityLog['action']): void {
    try {
      const logs = this.getLogs();
      const newEntry: PaymentActivityLog = {
        userId,
        bookingId,
        action,
        timestamp: new Date().toISOString()
      };
      logs.unshift(newEntry);
      if (logs.length > 1000) logs.pop();
      fs.writeFileSync(FILE_PATH, JSON.stringify(logs, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[AuditTrail] Save failed:', err.message);
    }
  }
}
