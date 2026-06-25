import { prisma } from '../../../database/prisma';
import { BookingStatus, RoomStatus } from '@prisma/client';
import { emailService } from '../../email/EmailService';
import fs from 'fs';
import path from 'path';

function appendJsonLog(filename: string, entry: any) {
  const dir = path.join(process.cwd(), 'backend', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  list.push(entry);
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

function getPaymentMeta(b: any, trxId: string, pId: string, method: string) {
  const url = method === 'midtrans' ? `midtrans://${trxId}` : (b.paymentProof?.proofUrl || '');
  return { id: pId, url, status: 'PAID', method, updatedAt: new Date().toISOString() };
}

function writeHostBalances(hostId: string, amount: number) {
  const file = path.join(process.cwd(), 'backend', 'data', 'host-balances.json');
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  let bal = list.find((item: any) => item.hostId === hostId);
  if (!bal) {
    bal = { hostId, balance: 0 };
    list.push(bal);
  }
  bal.balance = Number(bal.balance) + amount;
  bal.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

function writeHostRevenues(hostId: string, amount: number) {
  const file = path.join(process.cwd(), 'backend', 'data', 'host-revenues.json');
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  let rev = list.find((item: any) => item.hostId === hostId);
  if (!rev) {
    rev = { hostId, totalRevenue: 0 };
    list.push(rev);
  }
  rev.totalRevenue = Number(rev.totalRevenue) + amount;
  rev.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

function logFinanceTrx(b: any, trxId: string, pId: string, method: string) {
  const gross = Number(b.totalAmount);
  const fee = Math.round(gross * 0.02);
  appendJsonLog('finance-transactions.json', {
    bookingId: b.id, paymentId: pId, propertyId: b.propertyId,
    hostId: b.property?.tenantId, travelerId: b.guestId, grossAmount: gross,
    platformFee: fee, hostRevenue: gross - fee, tax: 0,
    paymentMethod: method, paymentStatus: 'PAID', transactionStatus: 'SETTLED',
    settlementTime: new Date().toISOString(), midtransOrderId: b.bookingCode,
    midtransTransactionId: trxId
  });
}

function logDashboardSummary(b: any, gross: number, net: number) {
  appendJsonLog('dashboard-summary.json', {
    bookingId: b.id, hostId: b.property?.tenantId, grossAmount: gross,
    netRevenue: net, status: 'CONFIRMED', updatedAt: new Date().toISOString()
  });
}

function logFinanceReports(b: any, gross: number, fee: number, net: number) {
  appendJsonLog('finance-reports.json', {
    bookingId: b.id, hostId: b.property?.tenantId, amount: gross,
    fee, net, createdAt: new Date().toISOString()
  });
}

function logLedger(b: any, pId: string, gross: number) {
  appendJsonLog('ledger.json', {
    id: `LEDGER-${Date.now()}`, bookingId: b.id, paymentId: pId, type: 'CREDIT',
    description: `Payment for ${b.bookingCode}`, amount: gross,
    timestamp: new Date().toISOString()
  });
}

function logDashboardAndReports(b: any, pId: string) {
  const gross = Number(b.totalAmount), fee = Math.round(gross * 0.02), net = gross - fee;
  logDashboardSummary(b, gross, net);
  logFinanceReports(b, gross, fee, net);
  logLedger(b, pId, gross);
}

function logReservationPayments(bId: string) {
  appendJsonLog('reservation-payments.json', { bookingId: bId, status: 'PAID', timestamp: new Date() });
}

function logSuccessLogs(b: any, trxId: string, pId: string, method: string) {
  logReservationPayments(b.id);
  logFinanceTrx(b, trxId, pId, method);
  const hostId = b.property?.tenantId, net = Number(b.totalAmount) * 0.98;
  if (hostId) {
    writeHostBalances(hostId, net);
    writeHostRevenues(hostId, net);
  }
  logDashboardAndReports(b, pId);
}

async function updateDbBookingAndPayment(tx: any, b: any, meta: any, status: BookingStatus) {
  await tx.paymentProof.upsert({
    where: { bookingId: b.id },
    update: { proofUrl: JSON.stringify(meta), deletedAt: null },
    create: { bookingId: b.id, proofUrl: JSON.stringify(meta) }
  });
  await tx.booking.update({ where: { id: b.id }, data: { status } });
}

async function blockRoomDates(tx: any, rId: string, start: string, end: string) {
  const cur = new Date(start + 'T00:00:00'), stop = new Date(end + 'T00:00:00');
  while (cur < stop) {
    const dStr = cur.toISOString().split('T')[0];
    await tx.roomAvailability.upsert({
      where: { roomId_date: { roomId: rId, date: dStr } },
      update: { isBlocked: true },
      create: { roomId: rId, date: dStr, isBlocked: true }
    });
    cur.setDate(cur.getDate() + 1);
  }
}

async function updateDbRoomAndDates(tx: any, b: any) {
  if (!b.roomId) return;
  await tx.room.update({ where: { id: b.roomId }, data: { status: 'Occupied' as RoomStatus } });
  await blockRoomDates(tx, b.roomId, b.startDate, b.endDate);
}

async function createDbNotifications(tx: any, b: any) {
  await tx.notification.create({
    data: { userId: b.guestId, title: 'Booking Confirmed', message: `Your stay at "${b.property?.name || 'StayEase'}" is now CONFIRMED.`, type: 'BOOKING' }
  });
  if (b.property?.tenantId) {
    await tx.notification.create({
      data: { userId: b.property.tenantId, title: 'Booking Paid: ' + b.bookingCode, message: `Booking ${b.bookingCode} has been paid and confirmed.`, type: 'BOOKING' }
    });
  }
}

async function sendConfirmationEmail(b: any) {
  const sub = 'StayEase Booking Confirmation - ' + b.bookingCode;
  const html = `<h3>Booking Confirmed!</h3><p>Dear ${b.guestName}, your booking for ${b.property?.name || 'StayEase'} is confirmed.</p>`;
  await emailService.sendEmail(b.guestEmail, sub, html).catch(err => {
    console.error('[Email] Failed to send confirmation email:', err.message);
  });
}

export class PaymentSyncService {
  static async fetchBookingAndMeta(bookingId: string, trxId: string, method: 'midtrans' | 'manual') {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { property: true } });
    if (!b) throw new Error('Booking not found');
    const pId = `pay-mt-${Date.now()}`;
    const meta = getPaymentMeta(b, trxId, pId, method);
    return { b, pId, meta };
  }

  static async performTxUpdates(b: any, meta: any, status: BookingStatus): Promise<boolean> {
    return await prisma.$transaction(async (tx) => {
      const currentBooking = await tx.booking.findUnique({ where: { id: b.id } });
      if (!currentBooking) throw new Error('Booking not found');
      
      if (currentBooking.status === status || currentBooking.status === BookingStatus.CONFIRMED || currentBooking.status === BookingStatus.COMPLETED) {
        return false;
      }

      await updateDbBookingAndPayment(tx, b, meta, status);
      if (status === BookingStatus.CONFIRMED) {
        await updateDbRoomAndDates(tx, b);
        await createDbNotifications(tx, b);
      }
      return true;
    });
  }

  static async syncPayment(bookingId: string, status: BookingStatus, trxId: string, method: 'midtrans' | 'manual') {
    const { b, pId, meta } = await this.fetchBookingAndMeta(bookingId, trxId, method);
    const didUpdate = await this.performTxUpdates(b, meta, status);
    if (didUpdate && status === BookingStatus.CONFIRMED) {
      logSuccessLogs(b, trxId, pId, method);
      await sendConfirmationEmail(b);
    }
  }
}
