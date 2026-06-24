import { prisma } from '../../../database/prisma';
import { Role } from '@prisma/client';

async function ensureUserSettingsAndMap(user: any) {
  if (!user) return user;
  
  let settingsRecord = user.settingsRecord;
  if (!settingsRecord) {
    try {
      settingsRecord = await prisma.userSettings.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          timezone: 'UTC',
          dateFormat: 'DD/MM/YYYY',
          theme: 'System',
          emailNotifications: true,
          bookingNotifications: true,
          inventoryNotifications: true,
          reviewNotifications: true,
          marketingNotifications: false,
        },
        update: {},
      });
    } catch (err) {
      console.error('[ensureUserSettingsAndMap] Failed to upsert userSettings:', err);
    }
  }

  if (settingsRecord) {
    user.settings = {
      timezone: settingsRecord.timezone,
      dateFormat: settingsRecord.dateFormat,
      theme: settingsRecord.theme,
      emailNotifications: settingsRecord.emailNotifications,
      bookingNotifications: settingsRecord.bookingNotifications,
      propertyNotifications: settingsRecord.inventoryNotifications,
      reviewNotifications: settingsRecord.reviewNotifications,
      marketingEmails: settingsRecord.marketingNotifications,
    };
  } else if (!user.settings) {
    user.settings = {
      timezone: 'UTC',
      dateFormat: 'DD/MM/YYYY',
      theme: 'System',
      emailNotifications: true,
      bookingNotifications: true,
      propertyNotifications: true,
      reviewNotifications: true,
      marketingEmails: false,
    };
  }
  
  return user;
}

export class UserRepository {
  async findByEmail(email: string) {
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      include: { tenantProfile: true, settingsRecord: true, hostApplication: true }
    });
    return ensureUserSettingsAndMap(user);
  }

  async findById(id: string) {
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { tenantProfile: true, settingsRecord: true, hostApplication: true }
    });
    return ensureUserSettingsAndMap(user);
  }

  async create(user: { email: string; name: string; password?: string; role?: Role; isVerified?: boolean; avatarUrl?: string }) {
    const newUser = await prisma.user.create({
      data: {
        email: user.email.toLowerCase(),
        name: user.name,
        password: user.password || '',
        role: user.role || Role.USER,
        isVerified: user.isVerified || false,
        avatarUrl: user.avatarUrl
      },
      include: { tenantProfile: true, settingsRecord: true, hostApplication: true }
    });
    return ensureUserSettingsAndMap(newUser);
  }

  async update(id: string, updates: any) {
    if (updates.settings !== undefined) {
      const s = updates.settings;
      if (s && typeof s === 'object') {
        try {
          await prisma.userSettings.upsert({
            where: { userId: id },
            create: {
              userId: id,
              timezone: s.timezone || 'UTC',
              dateFormat: s.dateFormat || 'DD/MM/YYYY',
              theme: s.theme || 'System',
              emailNotifications: s.emailNotifications !== undefined ? s.emailNotifications : true,
              bookingNotifications: s.bookingNotifications !== undefined ? s.bookingNotifications : true,
              inventoryNotifications: s.propertyNotifications !== undefined ? s.propertyNotifications : (s.inventoryNotifications !== undefined ? s.inventoryNotifications : true),
              reviewNotifications: s.reviewNotifications !== undefined ? s.reviewNotifications : true,
              marketingNotifications: s.marketingEmails !== undefined ? s.marketingEmails : (s.marketingNotifications !== undefined ? s.marketingNotifications : false)
            },
            update: {
              timezone: s.timezone !== undefined ? s.timezone : undefined,
              dateFormat: s.dateFormat !== undefined ? s.dateFormat : undefined,
              theme: s.theme !== undefined ? s.theme : undefined,
              emailNotifications: s.emailNotifications !== undefined ? s.emailNotifications : undefined,
              bookingNotifications: s.bookingNotifications !== undefined ? s.bookingNotifications : undefined,
              inventoryNotifications: s.propertyNotifications !== undefined ? s.propertyNotifications : (s.inventoryNotifications !== undefined ? s.inventoryNotifications : undefined),
              reviewNotifications: s.reviewNotifications !== undefined ? s.reviewNotifications : undefined,
              marketingNotifications: s.marketingEmails !== undefined ? s.marketingEmails : (s.marketingNotifications !== undefined ? s.marketingNotifications : undefined)
            }
          });
        } catch (settingsUpdateErr) {
          console.error('[UserRepository] error upserting UserSettings on update:', settingsUpdateErr);
        }
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updates,
      include: { tenantProfile: true, settingsRecord: true, hostApplication: true }
    });
    return ensureUserSettingsAndMap(updated);
  }

  async delete(id: string) {
    return prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  async restore(id: string) {
    return prisma.user.update({
      where: { id },
      data: { deletedAt: null }
    });
  }

  private buildWhere(search?: string, role?: Role) {
    const where: any = { deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (role) where.role = role;
    return where;
  }

  async findAll(page = 1, limit = 10, search?: string, role?: Role) {
    const where = this.buildWhere(search, role);
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { tenantProfile: true, settingsRecord: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);
    const mappedData = await Promise.all(data.map(u => ensureUserSettingsAndMap(u)));
    return { data: mappedData, total };
  }
}

export const userRepository = new UserRepository();
