import { prisma } from '../../../database/prisma';

export interface NotificationPayload {
  userId: string;
  title: string;
  message: string;
  type: string; // e.g. 'BOOKING', 'REVIEW', 'MAINTENANCE', 'PRICE', 'MARKETING'
}

export class NotificationEngine {
  /**
   * Creates an active dynamic notification if the recipient's preference settings permit.
   */
  static async createNotification(payload: NotificationPayload) {
    try {
      // Find recipient settings
      const settings = await prisma.userSettings.findUnique({
        where: { userId: payload.userId }
      });

      // Default preferences fallback if none loaded
      const userSettings = settings || {
        bookingNotifications: true,
        inventoryNotifications: true,
        reviewNotifications: true,
        marketingNotifications: false,
        emailNotifications: true
      };

      const type = payload.type.toUpperCase();

      // Check preferences before execution
      if (type === 'BOOKING' && !userSettings.bookingNotifications) {
        console.log(`[NotificationEngine] BOOKING notification skipped for user ${payload.userId} per preference settings.`);
        return null;
      }
      if ((type === 'PRICE' || type === 'MAINTENANCE' || type === 'PROPERTY') && !userSettings.inventoryNotifications) {
        console.log(`[NotificationEngine] PROPERTY/INVENTORY notification skipped for user ${payload.userId} per preference settings.`);
        return null;
      }
      if (type === 'REVIEW' && !userSettings.reviewNotifications) {
        console.log(`[NotificationEngine] REVIEW notification skipped for user ${payload.userId} per preference settings.`);
        return null;
      }
      if (type === 'MARKETING' && !userSettings.marketingNotifications) {
        console.log(`[NotificationEngine] MARKETING notification skipped for user ${payload.userId} per preference settings.`);
        return null;
      }

      // Log email subscription status
      if (!userSettings.emailNotifications) {
        console.log(`[NotificationEngine] Note: User ${payload.userId} has disabled Email alerts schema.`);
      }

      return await prisma.notification.create({
        data: {
          userId: payload.userId,
          title: payload.title,
          message: payload.message,
          type: payload.type,
          isRead: false
        }
      });
    } catch (err) {
      console.error('[NotificationEngine/createNotification] Fail-safe fallback default trigger:', err);
      return await prisma.notification.create({
        data: {
          userId: payload.userId,
          title: payload.title,
          message: payload.message,
          type: payload.type,
          isRead: false
        }
      });
    }
  }

  /**
   * Batch creates notifications filtering out any that violate user settings.
   */
  static async createMany(payloads: NotificationPayload[]) {
    const created: any[] = [];
    for (const payload of payloads) {
      const entry = await this.createNotification(payload);
      if (entry) {
        created.push(entry);
      }
    }
    return created;
  }
}
