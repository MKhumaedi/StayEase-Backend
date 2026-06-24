import crypto from 'crypto';

interface RequestSignature {
  hash: string;
  timestamp: number;
}

export class DuplicateRequestService {
  private static instance: DuplicateRequestService;
  private requestHistory: Map<string, RequestSignature> = new Map();

  private constructor() {
    // Cleanup every 30 seconds
    setInterval(() => this.cleanup(), 30000);
  }

  public static getInstance(): DuplicateRequestService {
    if (!DuplicateRequestService.instance) {
      DuplicateRequestService.instance = new DuplicateRequestService();
    }
    return DuplicateRequestService.instance;
  }

  private generateHash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  public isDuplicate(clientId: string, path: string, body: any, windowMs: number = 1500): boolean {
    const now = Date.now();
    const bodyStr = typeof body === 'object' ? JSON.stringify(body) : String(body);
    const uniqueKey = `${clientId}:${path}`;
    const cargoHash = this.generateHash(bodyStr);

    const prev = this.requestHistory.get(uniqueKey);
    if (prev && prev.hash === cargoHash && now - prev.timestamp < windowMs) {
      return true;
    }

    this.requestHistory.set(uniqueKey, { hash: cargoHash, timestamp: now });
    return false;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requestHistory.entries()) {
      if (now - record.timestamp > 60000) {
        this.requestHistory.delete(key);
      }
    }
  }
}

export const duplicateRequestService = DuplicateRequestService.getInstance();
