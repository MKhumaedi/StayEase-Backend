import { withdrawalRepository } from '../repositories/WithdrawalRepository';
import { prisma } from '../../../database/prisma';
import { WithdrawalStatus } from '@prisma/client';
import { NotificationEngine } from '../../notifications/services/NotificationEngine';
import { AuditService } from '../../admin/services/AdminServices';

export class WithdrawalService {
  async requestWithdrawal(params: {
    tenantId: string;
    amount: number;
    fee: number;
    bankName: string;
    accountName: string;
    accountNumber: string;
    notes?: string;
  }) {
    const { tenantId, amount, fee, bankName, accountName, accountNumber, notes } = params;

    // 1. Validate user existence
    const user = await prisma.user.findUnique({
      where: { id: tenantId },
      include: { tenantProfile: true }
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (amount <= 0) {
      throw new Error('Jumlah penarikan harus lebih besar dari 0');
    }

    // 2. Hitung Saldo Dinamis secara Real-Time dari Semua Transaksi Berhasil (CONFIRMED, CHECKED_IN, COMPLETED)
    const payments = await prisma.booking.findMany({
      where: {
        property: { tenantId },
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
      },
      select: { totalAmount: true, paymentProof: true }
    });

    let totalRevenue = 0;
    payments.forEach(b => {
      const amt = Number(b.totalAmount) || 0;
      totalRevenue += amt;
    });

    const serviceFees = Math.round(
      payments
        .filter(b => b.paymentProof?.proofUrl?.includes('midtrans') || !b.paymentProof)
        .reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0) * 0.02
    );
    const netSettled = totalRevenue - serviceFees;

    // Ambil seluruh riwayat penarikan
    const existingWithdrawals = await withdrawalRepository.findByTenantId(tenantId, 1, 100);
    const totalWithdrawnAmount = (Array.isArray(existingWithdrawals) ? existingWithdrawals : [])
      .filter((w: any) => w.status === 'PAID' || w.status === 'APPROVED' || w.status === 'PENDING')
      .reduce((sum: number, w: any) => sum + (Number(w.netAmount) || Number(w.amount) || 0), 0);

    const availableBalance = Math.max(0, netSettled - totalWithdrawnAmount);

    if (availableBalance < amount) {
      throw new Error(`Saldo tidak mencukupi. Saldo tersedia Anda: Rp ${availableBalance.toLocaleString('id-ID')}`);
    }

    const netAmount = amount - fee;
    if (netAmount <= 0) {
      throw new Error('Jumlah penarikan harus lebih besar dari biaya admin');
    }

    // 3. Create the withdrawal request (PENDING)
    const withdrawal = await withdrawalRepository.create({
      tenantId,
      amount,
      fee,
      netAmount,
      bankName,
      accountName,
      accountNumber,
      status: WithdrawalStatus.PENDING,
      notes
    });

    // Log the request creation
    AuditService.log(
      tenantId,
      user.name,
      'CREATE_WITHDRAWAL_REQUEST',
      'FINANCE',
      `Requested withdrawal of Rp ${amount.toLocaleString()} (Net: Rp ${netAmount.toLocaleString()}) to ${bankName} ${accountNumber}`
    );

    // Send a system notification to the tenant
    await NotificationEngine.createNotification({
      userId: tenantId,
      title: 'Permintaan Pencairan Diajukan',
      message: `Permintaan penarikan saldo sebesar Rp ${amount.toLocaleString()} sedang menunggu persetujuan admin.`,
      type: 'BOOKING'
    });

    return withdrawal;
  }

  async getWithdrawalById(id: string) {
    const withdrawal = await withdrawalRepository.findById(id);
    if (!withdrawal) {
      throw new Error('Withdrawal request not found');
    }
    return withdrawal;
  }

  async listTenantWithdrawals(tenantId: string, page = 1, limit = 10, status?: WithdrawalStatus) {
    return withdrawalRepository.findByTenantId(tenantId, page, limit, status);
  }

  async listAllWithdrawals(page = 1, limit = 10, filters?: { tenantId?: string; status?: WithdrawalStatus }) {
    return withdrawalRepository.findAll(page, limit, filters);
  }

  async approveWithdrawal(id: string, processedBy: string) {
    const withdrawal = await this.getWithdrawalById(id);
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new Error(`Cannot approve a withdrawal with status ${withdrawal.status}`);
    }

    const updated = await withdrawalRepository.update(id, {
      status: WithdrawalStatus.APPROVED,
      approvedAt: new Date(),
      processedBy
    });

    AuditService.log(
      processedBy,
      'Admin',
      'APPROVE_WITHDRAWAL_REQUEST',
      'FINANCE',
      `Approved withdrawal request ${id} of Rp ${Number(withdrawal.amount).toLocaleString()}`
    );

    await NotificationEngine.createNotification({
      userId: withdrawal.tenantId,
      title: 'Permintaan Pencairan Disetujui',
      message: `Permintaan penarikan saldo sebesar Rp ${Number(withdrawal.amount).toLocaleString()} telah disetujui dan sedang diproses transfer.`,
      type: 'BOOKING'
    });

    return updated;
  }

  async rejectWithdrawal(id: string, notes: string, processedBy: string) {
    const withdrawal = await this.getWithdrawalById(id);
    if (withdrawal.status !== WithdrawalStatus.PENDING && withdrawal.status !== WithdrawalStatus.APPROVED) {
      throw new Error(`Cannot reject a withdrawal with status ${withdrawal.status}`);
    }

    const updated = await withdrawalRepository.update(id, {
      status: WithdrawalStatus.REJECTED,
      notes: notes || 'Rejected by Admin',
      processedBy
    });

    AuditService.log(
      processedBy,
      'Admin',
      'REJECT_WITHDRAWAL_REQUEST',
      'FINANCE',
      `Rejected withdrawal request ${id} of Rp ${Number(withdrawal.amount).toLocaleString()}. Reason: ${notes}`
    );

    await NotificationEngine.createNotification({
      userId: withdrawal.tenantId,
      title: 'Permintaan Pencairan Ditolak',
      message: `Permintaan penarikan saldo sebesar Rp ${Number(withdrawal.amount).toLocaleString()} ditolak. Alasan: ${notes}`,
      type: 'BOOKING'
    });

    return updated;
  }

  async markAsPaid(id: string, referenceNumber: string, processedBy: string) {
    const withdrawal = await this.getWithdrawalById(id);
    if (withdrawal.status !== WithdrawalStatus.PENDING && withdrawal.status !== WithdrawalStatus.APPROVED) {
      throw new Error(`Cannot mark paid a withdrawal with status ${withdrawal.status}`);
    }

    const tenantId = withdrawal.tenantId;
    const amount = Number(withdrawal.amount);
    const netAmount = Number(withdrawal.netAmount);

    const user = await prisma.user.findUnique({ where: { id: tenantId } });
    if (!user) {
      throw new Error('Tenant user not found');
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: tenantId },
        data: {
          credits: {
            decrement: amount
          }
        }
      }).catch(() => null);

      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id },
        data: {
          status: WithdrawalStatus.PAID,
          referenceNumber,
          paidAt: new Date(),
          processedBy
        },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      });

      return { updatedUser, updatedWithdrawal };
    });

    AuditService.log(
      processedBy,
      'Admin',
      'MARK_WITHDRAWAL_PAID',
      'FINANCE',
      `Marked withdrawal request ${id} as paid. Reference: ${referenceNumber}.`
    );

    await NotificationEngine.createNotification({
      userId: tenantId,
      title: 'Pencairan Dana Berhasil Terkirim',
      message: `Dana pencairan sebesar Rp ${netAmount.toLocaleString()} telah berhasil ditransfer ke rekening ${withdrawal.bankName} (${withdrawal.accountNumber}). Ref: ${referenceNumber}.`,
      type: 'BOOKING'
    });

    return result.updatedWithdrawal;
  }
}

export const withdrawalService = new WithdrawalService();