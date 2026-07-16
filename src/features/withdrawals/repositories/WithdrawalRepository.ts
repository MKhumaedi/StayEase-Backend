import { prisma } from '../../../database/prisma';
import { WithdrawalStatus, Prisma } from '@prisma/client';

export class WithdrawalRepository {
  async findById(id: string) {
    return prisma.withdrawal.findUnique({
      where: { id },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            credits: true,
          }
        }
      }
    });
  }

  async findByTenantId(tenantId: string, page = 1, limit = 10, status?: WithdrawalStatus) {
    const where: Prisma.WithdrawalWhereInput = { tenantId };
    if (status) {
      where.status = status;
    }

    return prisma.withdrawal.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
  }

  async findAll(page = 1, limit = 10, filters?: { tenantId?: string; status?: WithdrawalStatus }) {
    const where: Prisma.WithdrawalWhereInput = {};
    if (filters?.tenantId) {
      where.tenantId = filters.tenantId;
    }
    if (filters?.status) {
      where.status = filters.status;
    }

    const total = await prisma.withdrawal.count({ where });
    const items = await prisma.withdrawal.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            credits: true,
          }
        }
      }
    });

    return { total, items, page, limit };
  }

  async create(data: {
    tenantId: string;
    amount: number;
    fee: number;
    netAmount: number;
    bankName: string;
    accountName: string;
    accountNumber: string;
    status?: WithdrawalStatus;
    notes?: string;
  }) {
    return prisma.withdrawal.create({
      data: {
        tenantId: data.tenantId,
        amount: data.amount,
        fee: data.fee,
        netAmount: data.netAmount,
        bankName: data.bankName,
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        status: data.status || WithdrawalStatus.PENDING,
        notes: data.notes,
      },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            email: true,
            credits: true,
          }
        }
      }
    });
  }

  async update(id: string, data: {
    status?: WithdrawalStatus;
    referenceNumber?: string;
    approvedAt?: Date | null;
    paidAt?: Date | null;
    processedBy?: string | null;
    notes?: string;
  }) {
    return prisma.withdrawal.update({
      where: { id },
      data,
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            email: true,
            credits: true,
          }
        }
      }
    });
  }
}

export const withdrawalRepository = new WithdrawalRepository();
