import { BookingStatus } from '@prisma/client';
import { PaymentSyncService } from './PaymentSyncService';

export class MidtransTransactionFlow {
  static async execute(b: any, status: BookingStatus, trxId: string) {
    console.log(`[Flow] Beginning transaction for booking: ${b.bookingCode}`);
    const method = b.paymentProof?.proofUrl?.startsWith('midtrans://') || !b.paymentProof ? 'midtrans' : 'manual';
    await PaymentSyncService.syncPayment(b.id, status, trxId, method);
  }
}
