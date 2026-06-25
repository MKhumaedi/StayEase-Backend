import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { NotificationEngine } from '../../notifications/services/NotificationEngine';
import { AuditTrailService } from '../../payment-proof/services/AuditTrailService';
import { BookingStatus } from '@prisma/client';
import { MidtransTransactionFlow } from '../../payments/services/MidtransTransactionFlow';
import { midtransService } from '../../payments/services/MidtransService';

function parseMeta(rawUrl: string, guestId: string, date: Date) {
  let meta = { 
    url: rawUrl, originalName: 'uploaded_proof.webp', webpName: 'uploaded_proof.webp', 
    size: 0, status: 'PENDING', uploadedBy: guestId, createdAt: date.toISOString(), updatedAt: date.toISOString() 
  };
  if (rawUrl.trim().startsWith('{')) {
    try { meta = JSON.parse(rawUrl); } catch {}
  }
  return meta;
}

function checkAccess(booking: any, userId: string, role: string): boolean {
  return booking && (booking.property.tenantId === userId || role === 'ADMIN');
}

async function notifyApprove(guestId: string, hostId: string, code: string) {
  await NotificationEngine.createNotification({
    userId: guestId,
    title: 'Pembayaran Disetujui',
    message: 'Pembayaran Anda telah diverifikasi dan reservasi berhasil dikonfirmasi.',
    type: 'BOOKING'
  });
  await NotificationEngine.createNotification({
    userId: hostId,
    title: 'Pembayaran Terverifikasi',
    message: `Pembayaran reservasi ${code} berhasil dikonfirmasi.`,
    type: 'BOOKING'
  });
}

async function notifyReject(guestId: string, code: string, reason: string) {
  await NotificationEngine.createNotification({
    userId: guestId,
    title: 'Pembayaran Ditolak',
    message: `Bukti transfer ditolak. Silakan unggah ulang bukti pembayaran. Alasan: ${reason}`,
    type: 'BOOKING'
  });
}

export class TenantPaymentsController {
  async fetchTenantBookings(tenantId: string) {
    return prisma.booking.findMany({
      where: { property: { tenantId }, deletedAt: null },
      include: { property: true, paymentProof: true },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async syncPendingPayments(bookings: any[]) {
    const pending = bookings.filter((b: any) => b.status === 'WAITING_PAYMENT').slice(0, 5);
    await Promise.all(pending.map(async (b: any) => {
      try {
        await midtransService.syncPaymentStatus(b.id);
      } catch (e) {
        console.error('Proactive sync on listPayments failed:', e);
      }
    }));
  }

  async listPayments(req: any, res: Response): Promise<void> {
    try {
      let bookings = await this.fetchTenantBookings(req.userId);
      await this.syncPendingPayments(bookings);
      bookings = await this.fetchTenantBookings(req.userId);
      res.json(bookings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async approvePayment(req: any, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const b = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { property: true, paymentProof: true }
      });
      if (!b || !b.paymentProof) {
        res.status(404).json({ error: 'Booking or Proof not found' });
        return;
      }
      if (!checkAccess(b, req.userId, req.userRole)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      await MidtransTransactionFlow.execute(b, BookingStatus.CONFIRMED, b.paymentProof.id);
      AuditTrailService.log(req.userId, bookingId, 'APPROVE_PAYMENT');
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async rejectPayment(req: any, res: Response): Promise<void> {
    try {
      const { bookingId } = req.params;
      const { reason } = req.body;
      if (!reason) {
        res.status(400).json({ error: 'Rejection reason is required' });
        return;
      }
      const b = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { property: true, paymentProof: true }
      });
      if (!b || !b.paymentProof) {
        res.status(404).json({ error: 'Booking or Proof not found' });
        return;
      }
      if (!checkAccess(b, req.userId, req.userRole)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const meta = parseMeta(b.paymentProof.proofUrl, b.guestId, b.paymentProof.createdAt);
      meta.status = 'REJECTED';
      meta.updatedAt = new Date().toISOString();
      (meta as any).rejectionReason = reason;

      await prisma.$transaction([
        prisma.booking.update({ where: { id: bookingId }, data: { status: 'WAITING_PAYMENT' } }),
        prisma.paymentProof.update({ where: { bookingId }, data: { proofUrl: JSON.stringify(meta) } })
      ]);

      await notifyReject(b.guestId, b.bookingCode, reason);
      AuditTrailService.log(req.userId, bookingId, 'REJECT_PAYMENT');
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}

export const tenantPaymentsController = new TenantPaymentsController();
