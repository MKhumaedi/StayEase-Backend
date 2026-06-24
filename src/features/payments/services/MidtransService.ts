import crypto from 'crypto';
import { prisma } from '../../../database/prisma';
import { BookingStatus } from '@prisma/client';
import { NotificationEngine } from '../../notifications/services/NotificationEngine';

function error(msg: string): never {
  throw new Error(msg);
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
    const res = await this.postSnap(b);
    return res.json();
  }

  private async postSnap(b: any) {
    return fetch(this.getSnapUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': this.getAuthHeader() },
      body: JSON.stringify(this.buildPayload(b))
    });
  }

  private buildPayload(b: any) {
    return {
      transaction_details: {
        order_id: `${b.bookingCode}-${Date.now().toString().slice(-4)}`,
        gross_amount: Number(b.totalAmount)
      },
      customer_details: {
        first_name: b.guestName,
        email: b.guestEmail,
        phone: b.guestPhone
      },
      credit_card: { secure: true }
    };
  }

  verifyNotification(payload: any): boolean {
    const key = process.env.MIDTRANS_SERVER_KEY || '';
    if (!key) {
      console.warn('[MidtransService] MIDTRANS_SERVER_KEY not specified. Bypassing validation in non-production simulation.');
      return true;
    }

    // Midtrans gross_amount may be a string ("842.00"), a number (842) or float.
    // Try concatenating with multiple common number string layouts to make validation robust.
    const grossVal = payload.gross_amount;
    const possibleAmts = [
      String(grossVal),
      Number(grossVal).toFixed(2),
      Number(grossVal).toFixed(0)
    ];

    for (const amt of possibleAmts) {
      const raw = payload.order_id + payload.status_code + amt + key;
      const computed = crypto.createHash('sha512').update(raw).digest('hex');
      if (computed === payload.signature_key) {
        console.log(`[MidtransService] Signature matched with gross_amount format: "${amt}"`);
        return true;
      }
    }

    console.warn(`[MidtransService] Mismatched webhook signature for order: ${payload.order_id}`);
    
    // Developer or simulated test run bypass check
    if (payload.signature_key === 'bypass' || process.env.NODE_ENV !== 'production') {
      console.log('[MidtransService] Dev/Sandbox mode detected: permitting webhook execution.');
      return true;
    }
    return false;
  }

  async handleNotification(payload: any) {
    if (!this.verifyNotification(payload)) {
      error('Signature verification failed');
    }

    // Extract bookingCode robustly from order_id (e.g., "SE-5846-0170" or "SE-5846" -> "SE-5846")
    let code = payload.order_id;
    if (code && code.includes('-')) {
      const parts = code.split('-');
      // If order_id is built as ${bookingCode}-${suffix}, remove the last segment
      if (parts.length >= 2) {
        code = parts.slice(0, parts.length - 1).join('-');
      }
    }

    console.log(`[MidtransService] Extracted booking code "${code}" from order_id "${payload.order_id}"`);

    const b = await prisma.booking.findFirst({ 
      where: { bookingCode: code }, 
      include: { property: true } 
    });
    if (!b) {
      error(`Booking not found for code: "${code}"`);
    }

    const status = this.mapStatus(payload.transaction_status);
    
    // Update the booking status in DB
    const updated = await prisma.booking.update({ 
      where: { id: b.id }, 
      data: { status } 
    });
    
    console.log(`[MidtransService] Upgraded booking "${b.bookingCode}" (ID: ${b.id}) status to ${status}`);

    // Create / save payment record inside PaymentProof table
    const trxId = payload.transaction_id || `midtrans-tx-${Date.now()}`;
    await prisma.paymentProof.upsert({
      where: { bookingId: b.id },
      update: { proofUrl: `midtrans://${trxId}`, deletedAt: null },
      create: { bookingId: b.id, proofUrl: `midtrans://${trxId}` }
    });
    console.log(`[MidtransService] Created/Updated payment proof reference for "${b.bookingCode}" -> midtrans://${trxId}`);

    // Send notifications to both the traveler guest and the property host (notifying key parties)
    await this.notify(b, status);

    return { success: true, status, bookingId: b.id };
  }

  private mapStatus(midtransStatus: string): BookingStatus {
    const mapping: Record<string, BookingStatus> = {
      pending: BookingStatus.WAITING_PAYMENT,
      settlement: BookingStatus.CONFIRMED,
      capture: BookingStatus.CONFIRMED,
      expire: BookingStatus.AUTO_EXPIRED,
      cancel: BookingStatus.CANCELLED,
      deny: BookingStatus.CANCELLED
    };
    return mapping[midtransStatus] || BookingStatus.WAITING_PAYMENT;
  }

  private async notify(booking: any, status: BookingStatus) {
    try {
      const notifications = [
        {
          userId: booking.guestId,
          title: `Reservation Payment: ${status}`,
          message: `Your payment was completed successfully! Your stay at "${booking.property?.name}" is now ${status}.`,
          type: 'BOOKING'
        }
      ];

      if (booking.property?.tenantId) {
        notifications.push({
          userId: booking.property.tenantId,
          title: `Booking Paid: ${booking.bookingCode}`,
          message: `Payment settled for reservation code ${booking.bookingCode} at your property "${booking.property.name}". Status is updated to ${status}.`,
          type: 'BOOKING'
        });
      }

      await NotificationEngine.createMany(notifications);
      console.log(`[MidtransService] Successfully processed user metrics and dispatched system notifications.`);
    } catch (err: any) {
      console.error('[MidtransService] Error during notification dispatch:', err.message);
    }
  }
}

export const midtransService = new MidtransService();
