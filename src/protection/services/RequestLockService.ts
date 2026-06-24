export class RequestLockService {
  private static instance: RequestLockService;
  private locks: Map<string, { expiresAt: number }> = new Map();

  private constructor() {
    // Periodically clean expired locks
    setInterval(() => this.cleanup(), 10000);
  }

  public static getInstance(): RequestLockService {
    if (!RequestLockService.instance) {
      RequestLockService.instance = new RequestLockService();
    }
    return RequestLockService.instance;
  }

  public acquire(key: string, ttlMs: number = 5000): boolean {
    const now = Date.now();
    const existing = this.locks.get(key);

    if (existing && existing.expiresAt > now) {
      return false; // Still locked
    }

    this.locks.set(key, { expiresAt: now + ttlMs });
    return true;
  }

  public release(key: string): void {
    this.locks.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}

export const requestLockService = RequestLockService.getInstance();
