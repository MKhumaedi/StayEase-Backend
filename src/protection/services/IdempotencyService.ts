interface IdempotencyRecord {
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  responseStatus?: number;
  responseBody?: any;
  responseHeaders?: any;
  createdAt: number;
}

export class IdempotencyService {
  private static instance: IdempotencyService;
  private store: Map<string, IdempotencyRecord> = new Map();

  private constructor() {
    // GC expired entries (TTL 1 hour)
    setInterval(() => this.cleanup(), 60000);
  }

  public static getInstance(): IdempotencyService {
    if (!IdempotencyService.instance) {
      IdempotencyService.instance = new IdempotencyService();
    }
    return IdempotencyService.instance;
  }

  public get(key: string): IdempotencyRecord | undefined {
    return this.store.get(key);
  }

  public setPending(key: string): void {
    this.store.set(key, {
      status: 'PENDING',
      createdAt: Date.now()
    });
  }

  public resolve(key: string, statusCode: number, body: any, headers?: any): void {
    this.store.set(key, {
      status: 'COMPLETED',
      responseStatus: statusCode,
      responseBody: body,
      responseHeaders: headers,
      createdAt: Date.now()
    });
  }

  public fail(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const ttl = 60 * 60 * 1000; // 1 hour
    for (const [key, record] of this.store.entries()) {
      if (now - record.createdAt > ttl) {
        this.store.delete(key);
      }
    }
  }
}

export const idempotencyService = IdempotencyService.getInstance();
