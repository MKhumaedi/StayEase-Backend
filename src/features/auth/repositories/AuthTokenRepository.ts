import { prisma } from '../../../database/prisma';

export class AuthTokenRepository {
  async createVerificationToken(userId: string, token: string, expiresAt: Date) {
    return prisma.emailVerification.create({
      data: { userId, token, expiresAt }
    });
  }

  async findVerificationToken(token: string) {
    return prisma.emailVerification.findFirst({
      where: { token, deletedAt: null }
    });
  }

  async removeVerificationToken(token: string) {
    return prisma.emailVerification.updateMany({
      where: { token },
      data: { deletedAt: new Date() }
    });
  }

  async restoreVerificationToken(token: string) {
    return prisma.emailVerification.updateMany({
      where: { token },
      data: { deletedAt: null }
    });
  }

  async createPasswordResetToken(userId: string, token: string, expiresAt: Date) {
    return prisma.passwordReset.create({
      data: { userId, token, expiresAt }
    });
  }

  async findPasswordResetToken(token: string) {
    return prisma.passwordReset.findFirst({
      where: { token, deletedAt: null }
    });
  }

  async removePasswordResetToken(token: string) {
    return prisma.passwordReset.updateMany({
      where: { token },
      data: { deletedAt: new Date() }
    });
  }

  async restorePasswordResetToken(token: string) {
    return prisma.passwordReset.updateMany({
      where: { token },
      data: { deletedAt: null }
    });
  }
}

export const authTokenRepository = new AuthTokenRepository();
