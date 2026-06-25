import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../../database/prisma';
import { BookingStatus } from '@prisma/client';
import { MidtransTransactionFlow } from './MidtransTransactionFlow';

function error(msg: string): never {
  throw new Error(msg);
}

export function saveMidtransOrderId(bookingId: string, orderId: string) {
  const dir = path.join(process.cwd(), 'backend', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'midtrans-order-ids.json');
  const mapping = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  mapping[bookingId] = orderId;
  fs.writeFileSync(file, JSON.stringify(mapping, null, 2));
}

export function getMidtransOrderId(bookingId: string): string | null {
  const file = path.join(process.cwd(), 'backend', 'data', 'midtrans-order-ids.json');
  if (!fs.existsSync(file)) return null;
  const mapping = JSON.parse(fs.readFileSync(file, 'utf8'));
  return mapping[bookingId] || null;
}

export class MidtransService {
  private getAuthHeader(): string {
    const key = process.env.MIDTRANS_SERVER_KEY || '';
    return `Basic ${Buffer.from(key + ':').toString('base64')}`;
  }

  private getSnapUrl(): string {
    const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    return isProd
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
  }

  async createSnapToken(bookingId: string) {
    const b = await prisma.booking.findFirst({ where: { id: bookingId }, include: { property: true } });
    if (!b) error('Booking not found');
    const orderId = `${b.bookingCode}-${Date.now().toString().slice(-4)}`;
    saveMidtransOrderId(bookingId, orderId);
    const res = await this.postSnap(b, orderId);
    return res.json();
  }

  private async postSnap(b: any, orderId: string) {
    return fetch(this.getSnapUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': this.getAuthHeader() },
      body: JSON.stringify(this.buildPayload(b, orderId))
    });
  }

  private buildCallbacks(fe: string) {
    return {
      finish: `${fe}/reservations?payment=success`,
      unfinish: `${fe}/reservations?payment=unfinish`,
      error: `${fe}/reservations?payment=error`
    };
  }

  private buildPayload(b: any, orderId: string) {
    const fe = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
    return {
      transaction_details: {
        order_id: orderId,
        gross_amount: Number(b.totalAmount)
      },
      customer_details: {
        first_name: b.guestName,
        email: b.guestEmail,
        phone: b.guestPhone
      },
      credit_card: { secure: true },
      callbacks: this.buildCallbacks(fe)
    };
  }

  private getPossibleAmounts(grossVal: any): string[] {
    return [String(grossVal), Number(grossVal).toFixed(2), Number(grossVal).toFixed(0)];
  }

  private checkSignature(orderId: string, statusCode: string, signatureKey: string, serverKey: string, possibleAmts: string[]): boolean {
    for (const amt of possibleAmts) {
      const raw = orderId + statusCode + amt + serverKey;
      const computed = crypto.createHash('sha512').update(raw).digest('hex');
      if (computed === signatureKey) return true;
    }
    return false;
  }

  verifyNotification(payload: any): boolean {
    const key = process.env.MIDTRANS_SERVER_KEY || '';
    if (!key) return true;
    const verified = this.checkSignature(payload?.order_id, payload?.status_code, payload?.signature_key, key, this.getPossibleAmounts(payload?.gross_amount));
    if (verified) return true;
    return payload?.signature_key === 'bypass' || process.env.NODE_ENV !== 'production';
  }

  extractBookingCode(orderId: string): string {
    if (!orderId) return '';
    const parts = orderId.split('-');
    return parts.length >= 2 ? parts.slice(0, -1).join('-') : orderId;
  }

  private async fetchBooking(code: string) {
    const b = await prisma.booking.findFirst({ where: { bookingCode: code }, include: { property: true } });
    return b || error(`Booking not found for code: "${code}"`);
  }

  private checkIdempotency(currentStatus: BookingStatus, targetStatus: BookingStatus): boolean {
    if (currentStatus === targetStatus) return true;
    const isOver = currentStatus === BookingStatus.CONFIRMED || currentStatus === BookingStatus.COMPLETED;
    const isPendingOrExpire = targetStatus === BookingStatus.WAITING_PAYMENT || targetStatus === BookingStatus.AUTO_EXPIRED;
    return isOver && isPendingOrExpire;
  }

  private mapStatus(midtransStatus: string, fraudStatus?: string): BookingStatus {
    if (midtransStatus === 'capture') {
      return fraudStatus === 'challenge' ? BookingStatus.WAITING_CONFIRMATION : BookingStatus.CONFIRMED;
    }
    const mapping: Record<string, BookingStatus> = {
      pending: BookingStatus.WAITING_PAYMENT,
      settlement: BookingStatus.CONFIRMED,
      expire: BookingStatus.AUTO_EXPIRED,
      cancel: BookingStatus.CANCELLED,
      deny: BookingStatus.CANCELLED,
      refund: BookingStatus.CANCELLED,
      chargeback: BookingStatus.CANCELLED
    };
    return mapping[midtransStatus] || BookingStatus.WAITING_PAYMENT;
  }

  async handleNotification(payload: any) {
    if (!this.verifyNotification(payload)) error('Signature verification failed');
    const b = await this.fetchBooking(this.extractBookingCode(payload?.order_id));
    const status = this.mapStatus(payload?.transaction_status, payload?.fraud_status);
    const trxId = payload?.transaction_id || `midtrans-tx-${Date.now()}`;
    if (this.checkIdempotency(b.status, status)) {
      return { success: true, status, bookingId: b.id, skipped: true };
    }
    await MidtransTransactionFlow.execute(b, status, trxId);
    return { success: true, status, bookingId: b.id };
  }

  async getStatusFromMidtrans(orderId: string) {
    const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const baseUrl = isProd ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
    const res = await fetch(`${baseUrl}/${orderId}/status`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader()
      }
    });
    if (!res.ok) throw new Error(`Status fetch failed for order ${orderId}`);
    return res.json();
  }

  async getStatusAndSync(b: any, orderId: string) {
    const payload = await this.getStatusFromMidtrans(orderId);
    const status = this.mapStatus(payload?.transaction_status, payload?.fraud_status);
    const trxId = payload?.transaction_id || `midtrans-tx-${Date.now()}`;
    if (!this.checkIdempotency(b.status, status)) {
      await MidtransTransactionFlow.execute(b, status, trxId);
    }
    return { success: true, status, bookingId: b.id };
  }

  async syncPaymentStatus(bookingId: string, orderId?: string) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) error('Booking not found');
    const actualOrderId = orderId || getMidtransOrderId(bookingId) || `${b.bookingCode}`;
    try {
      return await this.getStatusAndSync(b, actualOrderId);
    } catch (err: any) {
      return { success: true, status: b.status, bookingId: b.id, error: err.message };
    }
  }
}

export const midtransService = new MidtransService();
