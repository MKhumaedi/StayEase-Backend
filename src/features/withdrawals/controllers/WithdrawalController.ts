import { Request, Response } from 'express';
import { withdrawalService } from '../services/WithdrawalService';
import { WithdrawalStatus } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export class WithdrawalController {
  // Tenant endpoint: Get current balance and bank details
  async getTenantBalance(req: any, res: Response): Promise<void> {
    try {
      const tenantId = req.userId;
      const user = await prisma.user.findUnique({
        where: { id: tenantId },
        include: { tenantProfile: true }
      });

      if (!user) {
        res.status(404).json({ error: 'Tenant user not found' });
        return;
      }

      let bankName = user.tenantProfile?.bankName || '';
      let accountNumber = '';
      let accountName = user.name;

      if (user.tenantProfile?.bankAccount) {
        try {
          const parsed = JSON.parse(user.tenantProfile.bankAccount);
          accountNumber = parsed.accountNo || parsed.accountNumber || '';
          if (parsed.accountName) {
            accountName = parsed.accountName;
          }
        } catch (_) {
          accountNumber = user.tenantProfile.bankAccount;
        }
      }

      res.json({
        success: true,
        credits: Number(user.credits),
        bankDetails: {
          bankName,
          accountNumber,
          accountName
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // Tenant endpoint: Request a withdrawal
  async requestWithdrawal(req: any, res: Response): Promise<void> {
    try {
      const tenantId = req.userId;
      const { amount, fee, bankName, accountName, accountNumber, notes } = req.body;

      if (!amount || isNaN(Number(amount))) {
        res.status(400).json({ error: 'Jumlah penarikan tidak valid' });
        return;
      }

      if (!bankName || !accountName || !accountNumber) {
        res.status(400).json({ error: 'Informasi rekening bank tujuan tidak lengkap' });
        return;
      }

      const withdrawal = await withdrawalService.requestWithdrawal({
        tenantId,
        amount: Number(amount),
        fee: Number(fee || 0),
        bankName,
        accountName,
        accountNumber,
        notes
      });

      res.status(201).json({
        success: true,
        message: 'Permintaan penarikan berhasil diajukan',
        withdrawal
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  // Tenant endpoint: List their own withdrawals
  async listTenantWithdrawals(req: any, res: Response): Promise<void> {
    try {
      const tenantId = req.userId;
      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 10);
      const status = req.query.status as WithdrawalStatus;

      const items = await withdrawalService.listTenantWithdrawals(tenantId, page, limit, status);
      res.json({
        success: true,
        items
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // Admin endpoint: List all withdrawals
  async listAllWithdrawals(req: any, res: Response): Promise<void> {
    try {
      if (req.userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: Admins only' });
        return;
      }

      const page = Number(req.query.page || 1);
      const limit = Number(req.query.limit || 10);
      const status = req.query.status as WithdrawalStatus;
      const tenantId = req.query.tenantId as string;

      const result = await withdrawalService.listAllWithdrawals(page, limit, { tenantId, status });
      res.json({
        success: true,
        ...result
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // Admin endpoint: Approve withdrawal (PENDING -> APPROVED)
  async approveWithdrawal(req: any, res: Response): Promise<void> {
    try {
      if (req.userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: Admins only' });
        return;
      }

      const { id } = req.params;
      const adminId = req.userId;

      const withdrawal = await withdrawalService.approveWithdrawal(id, adminId);
      res.json({
        success: true,
        message: 'Withdrawal approved successfully',
        withdrawal
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  // Admin endpoint: Reject withdrawal (PENDING/APPROVED -> REJECTED)
  async rejectWithdrawal(req: any, res: Response): Promise<void> {
    try {
      if (req.userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: Admins only' });
        return;
      }

      const { id } = req.params;
      const { notes } = req.body;
      const adminId = req.userId;

      const withdrawal = await withdrawalService.rejectWithdrawal(id, notes, adminId);
      res.json({
        success: true,
        message: 'Withdrawal rejected successfully',
        withdrawal
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  // Admin endpoint: Mark withdrawal as paid (APPROVED/PENDING -> PAID)
  async markAsPaid(req: any, res: Response): Promise<void> {
    try {
      if (req.userRole !== 'ADMIN') {
        res.status(403).json({ error: 'Forbidden: Admins only' });
        return;
      }

      const { id } = req.params;
      const { referenceNumber } = req.body;
      const adminId = req.userId;

      if (!referenceNumber) {
        res.status(400).json({ error: 'Reference/transfer receipt number is required' });
        return;
      }

      const withdrawal = await withdrawalService.markAsPaid(id, referenceNumber, adminId);
      res.json({
        success: true,
        message: 'Withdrawal successfully marked as PAID and balance deducted',
        withdrawal
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}

export const withdrawalController = new WithdrawalController();
