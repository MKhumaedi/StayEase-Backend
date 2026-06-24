import { prisma } from '../../../database/prisma';

export class NotificationRepository {
  async getByUserId(userId: string) {
    return prisma.notification.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, deletedAt: null },
      data: { isRead: true },
    });
  }

  async delete(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { deletedAt: new Date() },
    });
  }

  async deleteAll(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}

export const notificationRepository = new NotificationRepository();
