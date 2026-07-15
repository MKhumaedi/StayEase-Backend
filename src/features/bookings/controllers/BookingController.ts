import { Response } from 'express';
import { bookingService } from '../services/BookingService';
import { bookingRepository } from '../repositories/BookingRepository';
import { CreateBookingSchema, UploadPaymentProofSchema, BookingSearchSchema, BookingSearchInput } from '../validations/BookingValidation';
import { ExportService } from '../services/ExportService';
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

  private async fetchSearchedBookings(req: AuthenticatedRequest, validated: BookingSearchInput) {
    return bookingRepository.search({
      status: validated.status,
      search: validated.search,
      page: validated.page,
      limit: validated.limit,
      guestId: (req.userRole === 'USER' || req.userRole === 'TRAVELER') ? req.userId : (validated.guestId || undefined),
      tenantId: req.userRole === 'TENANT' ? req.userId : (validated.tenantId || undefined),
      propertyId: validated.propertyId,
      startDate: validated.startDate,
      endDate: validated.endDate,
      checkoutRequested: validated.checkoutRequested,
      checkedOutAtNull: validated.checkedOutAtNull
    });
  }

  async listBookings(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      const validated: BookingSearchInput = BookingSearchSchema.parse(req.query);
      await bookingRepository.expireOldPendingBookings(30);
      let results = await this.fetchSearchedBookings(req, validated);
      
      const hasPendingPayment = results.data.some((b: any) => b.status === 'WAITING_PAYMENT');
      if (hasPendingPayment) {
        await this.syncBookingList(results.data);
        results = await this.fetchSearchedBookings(req, validated);
      }
      
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      if (process.env.NODE_ENV !== 'production') {
        const duration = Date.now() - startTime;
        console.log(`[PERF] listBookings took ${duration}ms (hasPendingPayment: ${hasPendingPayment})`);
      }

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
      console.log(`[getBookingByCode] Received raw code: "${code}"`);

      // Normalize multiple formats
      let normalizedCode = '';
      if (code) {
        const decoded = decodeURIComponent(code).trim();
        
        // JSON support
        if (decoded.startsWith('{') && decoded.endsWith('}')) {
          try {
            const parsed = JSON.parse(decoded);
            if (parsed && typeof parsed === 'object') {
              if (parsed.bookingCode) {
                normalizedCode = parsed.bookingCode.trim();
              } else if (parsed.code) {
                normalizedCode = parsed.code.trim();
              }
            }
          } catch (e) {
            console.error(`[getBookingByCode] Failed JSON parse:`, e);
          }
        }

        // URL format support
        if (!normalizedCode) {
          const urlMatch = decoded.match(/\/checkin\/([A-Za-z0-9-]+)/i);
          if (urlMatch && urlMatch[1]) {
            normalizedCode = urlMatch[1].trim();
          }
        }

        // Invoice multi-line plain text support
        if (!normalizedCode) {
          const lineMatch = decoded.match(/Booking Code:\s*([A-Za-z0-9-]+)/i);
          if (lineMatch && lineMatch[1]) {
            normalizedCode = lineMatch[1].trim();
          }
        }

        // Generic BK-SE-XXXX match
        if (!normalizedCode) {
          const bkSeMatch = decoded.match(/(BK-SE-\d+)/i);
          if (bkSeMatch && bkSeMatch[1]) {
            normalizedCode = bkSeMatch[1].trim();
          }
        }

        // Generic SE-XXXX match
        if (!normalizedCode) {
          const seMatch = decoded.match(/(SE-\d+)/i);
          if (seMatch && seMatch[1]) {
            normalizedCode = seMatch[1].trim();
          }
        }

        // Default fallback
        if (!normalizedCode) {
          normalizedCode = decoded;
        }
      }

      const finalCode = normalizedCode.toUpperCase();
      console.log(`[getBookingByCode] Final normalized code lookup: "${finalCode}"`);

      // === TEMPORARY DEBUG LOGS START ===
      console.log("[BACKEND DEBUG] Incoming Authorization header:", req.headers.authorization);
      console.log("[BACKEND DEBUG] req.userId:", req.userId);
      console.log("[BACKEND DEBUG] req.userRole:", req.userRole);
      console.log("[BACKEND DEBUG] req.body:", req.body);
      console.log("[BACKEND DEBUG] bookingCode param:", code);
      // === TEMPORARY DEBUG LOGS END ===

      const booking = await bookingRepository.findByCode(finalCode);
      if (!booking) {
        const msg = `Booking QR not recognized. (Parsed lookup: "${finalCode}" from raw: "${code}")`;
        console.warn(`[getBookingByCode] Warning: ${msg}`);
        // === TEMPORARY DEBUG LOGS START ===
        console.log("[BACKEND DEBUG] Final response status: 404");
        // === TEMPORARY DEBUG LOGS END ===
        res.status(404).json({ error: msg });
        return;
      }

      const ok = req.userRole === 'ADMIN' || booking.guestId === req.userId || booking.property.tenantId === req.userId;
      if (!ok) {
        // === TEMPORARY DEBUG LOGS START ===
        console.log("[BACKEND DEBUG] Access denied comparison details:", {
          guestId: booking.guestId,
          reqUserId: req.userId,
          tenantId: booking.property?.tenantId,
          reqUserRole: req.userRole
        });
        console.log("[BACKEND DEBUG] Final response status: 403");
        // === TEMPORARY DEBUG LOGS END ===
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // === TEMPORARY DEBUG LOGS START ===
      console.log("[BACKEND DEBUG] Final response status: 200 (Success)");
      // === TEMPORARY DEBUG LOGS END ===
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json(booking);
    } catch (err: any) {
      console.error(`[getBookingByCode] Error:`, err);
      res.status(400).json({ error: err.message });
    }
  }

  async getReports(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const landlordId = req.userId;
      const { propertyId, period, startDate, endDate } = req.query as {
        propertyId?: string;
        period?: string;
        startDate?: string;
        endDate?: string;
      };
      const stats = await bookingService.getReportStats(
        landlordId,
        propertyId,
        period,
        startDate,
        endDate
      );
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  async exportReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const landlordId = req.userId;
      if (!landlordId) {
        res.status(401).json({ error: 'Session required' });
        return;
      }
      
      const { format, period, startDate, endDate, propertyId, reportType } = req.query as {
        format?: 'csv' | 'xlsx';
        period?: string;
        startDate?: string;
        endDate?: string;
        propertyId?: string;
        reportType?: 'revenue' | 'booking' | 'occupancy' | 'operational';
      };

      if (!format || (format !== 'csv' && format !== 'xlsx')) {
        res.status(400).json({ error: 'Invalid or missing export format (must be csv or xlsx)' });
        return;
      }

      const exportService = new ExportService();
      const { filename, buffer, mimeType } = await exportService.generateReport(
        landlordId,
        format,
        period || 'this_year',
        startDate,
        endDate,
        propertyId,
        reportType || 'revenue'
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.end(buffer);
    } catch (err: any) {
      console.error('[exportReport] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to export report' });
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

      // Guard: "Tidak mengubah booking yang sudah CHECKED_OUT."
      if (booking.status === 'CHECKED_OUT' || booking.status === 'COMPLETED') {
        res.status(400).json({ error: 'Tidak boleh mengubah booking yang sudah CHECKED_OUT.' });
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

  async requestCheckout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
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

      // Guard: "Tidak mengubah booking yang sudah CHECKED_OUT."
      if (booking.status === 'CHECKED_OUT' || booking.status === 'COMPLETED') {
        res.status(400).json({ error: 'Tidak boleh mengubah booking yang sudah CHECKED_OUT.' });
        return;
      }

      // Validation: "Tidak boleh Check-Out jika status belum CHECKED_IN."
      if (booking.status !== 'CHECKED_IN') {
        res.status(400).json({ error: 'Tidak boleh Check-Out jika status belum CHECKED_IN.' });
        return;
      }

      // Update via Service
      const updated = await bookingService.requestCheckout(id);

      // Create notification for host/tenant
      await NotificationEngine.createNotification({
        userId: booking.property.tenantId,
        title: 'Guest Check-Out Request',
        message: `Guest ${booking.guestName} has requested check-out for booking ${booking.bookingCode}.`,
        type: 'BOOKING'
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async confirmCheckout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
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

      const isHost = booking.property.tenantId === userId;
      const isAdmin = req.userRole === 'ADMIN';

      if (!isHost && !isAdmin) {
        res.status(403).json({ error: 'Only Host/Tenant or Admin can perform this action' });
        return;
      }

      // Finalize Check-Out using service transaction
      const updated = await bookingService.confirmCheckout(id, userId);

      // Trigger Housekeeping Task with a fresh checklist
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
      AuditTrailService.log(userId, id, 'CHECK_OUT');

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

  async checkOut(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
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

      // Guard: "Tidak mengubah booking yang sudah CHECKED_OUT."
      if (booking.status === 'CHECKED_OUT' || booking.status === 'COMPLETED') {
        res.status(400).json({ error: 'Tidak boleh mengubah booking yang sudah CHECKED_OUT.' });
        return;
      }

      const isGuest = booking.guestId === userId;
      const isHost = booking.property.tenantId === userId;
      const isAdmin = req.userRole === 'ADMIN';

      if (!isGuest && !isHost && !isAdmin) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // If they are a Tenant or Admin and the booking is CHECKED_IN, they can confirm checkout.
      const isConfirming = (isHost || isAdmin) && booking.status === 'CHECKED_IN';

      if (isConfirming) {
        return this.confirmCheckout(req, res);
      } else {
        return this.requestCheckout(req, res);
      }
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }
}

export const bookingController = new BookingController();
