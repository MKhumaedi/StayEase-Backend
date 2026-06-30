import { Response } from 'express';
import { bookingService } from '../services/BookingService';
import { bookingRepository } from '../repositories/BookingRepository';
import { CreateBookingSchema, UploadPaymentProofSchema, BookingSearchSchema } from '../validations/BookingValidation';
import { AuthenticatedRequest } from '../../../middlewares/AuthMiddleware';
import { NotificationEngine } from '../../notifications/services/NotificationEngine';
import { AuditTrailService } from '../../payment-proof/services/AuditTrailService';
import { midtransService } from '../../payments/services/MidtransService';
import { prisma } from '../../../database/prisma';
import { updateHousekeepingTask } from '../../../database/housekeeping_maintenance';

export class BookingController {
  async createBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (req.userRole !== 'USER' && req.userRole !== 'TRAVELER') {
        res.status(403).json({ error: 'Only traveler accounts can create reservations.' });
        return;
      }
      const validated = CreateBookingSchema.parse(req.body);
      if (req.userId !== validated.guestId) {
        res.status(403).json({ error: 'Guests cannot create bookings for other users.' });
        return;
      }
      const booking = await bookingService.initiateBooking(validated);
      
      // Dispatch notification
      await NotificationEngine.createNotification({
        userId: booking.guestId,
        title: 'Reservasi Dibuat',
        message: `Reservasi Anda dengan kode ${booking.bookingCode} telah berhasil dibuat. Silakan selesaikan pembayaran.`,
        type: 'BOOKING'
      });
      
      res.status(201).json(booking);
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async uploadPaymentProof(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const validated = UploadPaymentProofSchema.parse(req.body);
      const booking = await bookingService.confirmBookingPayment(req.params.id, validated.proofUrl);
      
      // Dispatch notifications
      await NotificationEngine.createNotification({
        userId: booking.guestId,
        title: 'Pembayaran Sukses',
        message: 'Pembayaran Sukses: Bukti transfer berhasil diunggah.',
        type: 'BOOKING'
      });
      
      if (booking.property?.tenantId) {
        await NotificationEngine.createNotification({
          userId: booking.property.tenantId,
          title: 'Bukti Pembayaran Baru',
          message: `Bukti transfer baru diunggah untuk booking ${booking.bookingCode}. Silakan lakukan verifikasi.`,
          type: 'BOOKING'
        });
      }

      AuditTrailService.log(req.userId || '', booking.id, 'UPLOAD_PROOF');
      res.json(booking);
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  private async syncBookingList(bookings: any[]) {
    const pending = bookings.filter((b: any) => b.status === 'WAITING_PAYMENT').slice(0, 5);
    await Promise.all(pending.map(async (b: any) => {
      try {
        await midtransService.syncPaymentStatus(b.id);
      } catch (e) {
        console.error('Proactive sync on listBookings failed:', e);
      }
    }));
  }

  private async fetchSearchedBookings(req: AuthenticatedRequest, validated: any) {
    return bookingRepository.search({
      status: validated.status as any, search: validated.search,
      page: validated.page, limit: validated.limit,
      guestId: req.userRole === 'USER' ? req.userId : (validated.guestId || undefined),
      tenantId: req.userRole === 'TENANT' ? req.userId : undefined,
      propertyId: validated.propertyId,
      startDate: validated.startDate,
      endDate: validated.endDate
    });
  }

  async listBookings(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const validated = BookingSearchSchema.parse(req.query);
      await bookingRepository.expireOldPendingBookings(30);
      let results = await this.fetchSearchedBookings(req, validated);
      await this.syncBookingList(results.data);
      results = await this.fetchSearchedBookings(req, validated);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json(results);
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async getBooking(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      let booking = await bookingRepository.findById(id);
      if (!booking) return res.status(404).json({ error: 'Not found' }) as any;
      const ok = req.userRole === 'ADMIN' || booking.guestId === req.userId || booking.property.tenantId === req.userId;
      if (!ok) return res.status(403).json({ error: 'Denied' }) as any;
      if (booking.status === 'WAITING_PAYMENT') {
        await midtransService.syncPaymentStatus(id).catch(() => {});
        booking = await bookingRepository.findById(id) || booking;
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json(booking);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async getBookingByCode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { code } = req.params;
      const booking = await bookingRepository.findByCode(code);
      if (!booking) {
        res.status(404).json({ error: 'Booking QR not recognized.' });
        return;
      }
      const ok = req.userRole === 'ADMIN' || booking.guestId === req.userId || booking.property.tenantId === req.userId;
      if (!ok) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json(booking);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async getReports(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const landlordId = req.userId;
      const stats = await bookingService.getReportStats(landlordId);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async updateStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({ error: 'Session required' });
        return;
      }

      const booking = await bookingRepository.findById(id);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }

      const isGuest = booking.guestId === userId;
      const isHost = booking.property.tenantId === userId;

      if (!isGuest && !isHost) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const updated = await bookingRepository.updateStatus(id, status as any);

      // Create notifications based on status change
      let title = '';
      let message = '';
      if (status === 'CONFIRMED') {
        title = 'Reservasi Dikonfirmasi';
        message = `Reservasi Anda dengan kode ${booking.bookingCode} telah dikonfirmasi.`;
      } else if (status === 'COMPLETED') {
        title = 'Reservasi Selesai';
        message = `Kunjungan Anda untuk reservasi ${booking.bookingCode} telah selesai. Silakan tulis ulasan.`;
      } else if (status === 'CANCELLED') {
        title = 'Reservasi Dibatalkan';
        message = `Reservasi Anda dengan kode ${booking.bookingCode} telah dibatalkan.`;
      }

      if (title && message) {
        await NotificationEngine.createNotification({
          userId: booking.guestId,
          title,
          message,
          type: 'BOOKING'
        });
      }

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async checkIn(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.userId;

      if (!tenantId) {
        res.status(401).json({ error: 'Session required' });
        return;
      }

      if (req.userRole !== 'TENANT') {
        res.status(403).json({ error: 'Only Host/Tenant can perform this action' });
        return;
      }

      const booking = await bookingRepository.findById(id);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }

      if (booking.property.tenantId !== tenantId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const updated = await bookingRepository.checkIn(id, tenantId);

      // Automatically update Room status to Occupied when checked in
      if (booking.roomId) {
        await prisma.room.update({
          where: { id: booking.roomId },
          data: { status: 'Occupied' }
        });
      }

      // Create log
      AuditTrailService.log(tenantId, id, 'CHECK_IN');

      // Create notification for traveler
      await NotificationEngine.createNotification({
        userId: booking.guestId,
        title: 'Check-In recorded successfully',
        message: 'Welcome. Your check-in has been successfully recorded.',
        type: 'BOOKING'
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async checkOut(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.userId;

      if (!tenantId) {
        res.status(401).json({ error: 'Session required' });
        return;
      }

      if (req.userRole !== 'TENANT') {
        res.status(403).json({ error: 'Only Host/Tenant can perform this action' });
        return;
      }

      const booking = await bookingRepository.findById(id);
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
        return;
      }

      if (booking.property.tenantId !== tenantId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Check-Out is only allowed if the booking status is CHECKED_IN
      if (booking.status !== 'CHECKED_IN') {
        res.status(400).json({ error: 'Checkout is only allowed for Checked-In bookings' });
        return;
      }

      const updated = await bookingRepository.checkOut(id, tenantId);

      // Automatically flag Room as DIRTY (UNAVAILABLE status) and trigger Housekeeping Task with a fresh checklist
      if (booking.roomId) {
        try {
          const defaultChecklist = [
            { text: 'Replace linens & beddings', done: false },
            { text: 'Sanitize bathroom and surfaces', done: false },
            { text: 'Restock refreshments & amenities', done: false },
            { text: 'Inspect and dust fixtures', done: false }
          ];
          await updateHousekeepingTask(booking.roomId, { status: 'DIRTY', checklist: defaultChecklist });
        } catch (hkError) {
          console.error('[BookingController] Failed to flag housekeeping as DIRTY:', hkError);
        }
      }

      // Create log
      AuditTrailService.log(tenantId, id, 'CHECK_OUT');

      // Create notification for traveler
      await NotificationEngine.createNotification({
        userId: booking.guestId,
        title: 'Check-Out recorded successfully',
        message: 'Thank you for staying with us.',
        type: 'BOOKING'
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }
}

export const bookingController = new BookingController();
