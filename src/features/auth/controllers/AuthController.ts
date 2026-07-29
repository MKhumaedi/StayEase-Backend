import { Request, Response } from 'express';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { authService } from '../services/AuthService';
import { userRepository } from '../repositories/UserRepository';
import { getSupabaseAdmin } from '../services/supabase';
import { prisma } from '../../../database/prisma';
import multer from 'multer';
import { 
  RegisterSchema, 
  LoginSchema, 
  VerifySchema, 
  ResetPasswordRequestSchema, 
  ResetPasswordSubmitSchema 
} from '../validations/AuthValidation';

export function transformUser(user: any) {
  if (!user) return user;
  const transformed = { ...user };
  if (transformed.tenantProfile) {
    let bankAccountName = '';
    let bankAccountNo = '';
    try {
      const parsed = JSON.parse(transformed.tenantProfile.bankAccount || '{}');
      bankAccountName = parsed.accountName || '';
      bankAccountNo = parsed.accountNo || '';
    } catch (_) {
      bankAccountNo = transformed.tenantProfile.bankAccount || '';
    }
    transformed.tenantProfile = {
      ...transformed.tenantProfile,
      bankAccountName,
      bankAccountNo
    };
  }
  return transformed;
}

const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: {
    fileSize: 1 * 1024 * 1024 // 1MB Limit
  },
  fileFilter: (req: any, file: any, cb: any) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (!allowedMimeTypes.includes(mime) || !allowedExtensions.includes(ext)) {
      return cb(new Error('Format gambar tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP.'), false);
    }

    cb(null, true);
  }
});

export class AuthController {
  async updateRole(req: Request, res: Response): Promise<void> {
    try {
      const { email, role } = req.body;
      if (!email || !role) {
        res.status(400).json({ error: 'Email and role are required' });
        return;
      }
      if (role !== 'USER' && role !== 'TENANT') {
        res.status(400).json({ error: 'Invalid role' });
        return;
      }
      const user = await userRepository.findByEmail(email);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const updatedUser = await userRepository.update(user.id, { role });
      res.status(200).json({ success: true, user: transformUser(updatedUser) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || err });
    }
  }

  async register(req: Request, res: Response): Promise<void> {
    try {
      const parsed = RegisterSchema.parse(req.body);
      const result = await authService.register(parsed.name, parsed.email, parsed.role as any, parsed.password, (parsed as any).id);
      res.status(201).json({
        success: true,
        user: transformUser(result.user),
        message: result.message
      });
    } catch (err: any) {
      console.error('[AuthController/register] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async getConfig(req: Request, res: Response): Promise<void> {
    try {
      const { getSupabaseUrl } = await import('../services/supabase');
      res.status(200).json({
        supabaseUrl: getSupabaseUrl(),
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
      });
    } catch (err: any) {
      console.error('[AuthController/getConfig] Error:', err);
      res.status(500).json({ error: err.message || err });
    }
  }

  async verifySupabase(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.body;
      if (!userId) {
        res.status(400).json({ error: 'User ID is required' });
        return;
      }
      
      const user = await userRepository.findById(userId);
      if (!user) {
        // Fallback or ignore if not registered yet
        res.status(404).json({ error: 'User not found' });
        return;
      }
      
      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      
      if (error || !data?.user) {
        res.status(400).json({ error: error?.message || 'Failed to fetch user from Supabase' });
        return;
      }
      
      if (!data.user.email_confirmed_at) {
        res.status(400).json({ error: 'Email not verified' });
        return;
      }
      
      // Update Prisma locally
      const updatedUser = await userRepository.update(userId, { isVerified: true });
      res.status(200).json({ success: true, user: transformUser(updatedUser) });
    } catch (err: any) {
      console.error('[AuthController/verifySupabase] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async getVerificationReport(req: Request, res: Response): Promise<void> {
    try {
      const prismaUsers = await prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, isVerified: true, createdAt: true }
      });

      let supabaseUsers: any[] = [];
      let supabaseError: string | null = null;

      try {
        const supabaseAdmin = getSupabaseAdmin();
        const { data, error } = await supabaseAdmin.auth.admin.listUsers();
        if (error) {
          supabaseError = error.message;
        } else {
          supabaseUsers = data.users || [];
        }
      } catch (err: any) {
        supabaseError = err.message || err;
      }

      // Build comparative user list
      const report = prismaUsers.map(pu => {
        const su = supabaseUsers.find(u => u.id === pu.id || u.email?.toLowerCase() === pu.email.toLowerCase());
        const emailConfirmedAt = su ? su.email_confirmed_at : null;
        const isConfirmedInSupabase = !!emailConfirmedAt;
        const match = pu.isVerified === isConfirmedInSupabase;

        return {
          userId: pu.id,
          email: pu.email,
          name: pu.name,
          role: pu.role,
          prismaVerified: pu.isVerified,
          supabaseVerified: isConfirmedInSupabase,
          supabaseConfirmedAt: emailConfirmedAt,
          isSynchronized: match,
          createdLocal: pu.createdAt
        };
      });

      // Count stats
      const totalLocal = prismaUsers.length;
      const totalSupabase = supabaseUsers.length;
      const synchronizedCount = report.filter(r => r.isSynchronized).length;
      const outOfSyncCount = totalLocal - synchronizedCount;

      res.status(200).json({
        success: true,
        summary: {
          totalLocalUsers: totalLocal,
          totalSupabaseUsers: totalSupabase,
          fullySynchronizedCount: synchronizedCount,
          outOfSyncCount,
          supabaseError
        },
        users: report
      });
    } catch (err: any) {
      console.error('[AuthController/getVerificationReport] Error:', err);
      res.status(500).json({ error: err.message || err });
    }
  }

  async resendVerification(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;
      const result = await authService.resendVerification(email);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[AuthController/resendVerification] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const parsed = LoginSchema.parse(req.body);
      const result = await authService.login(parsed.email, parsed.password);
      res.status(200).json({
        ...result,
        user: transformUser(result.user)
      });
    } catch (err: any) {
      console.error('[AuthController/login] Error:', err);
      res.status(401).json({ error: err.message || err });
    }
  }

  async verify(req: Request, res: Response): Promise<void> {
    try {
      const parsed = VerifySchema.parse(req.body);
      const user = await authService.verifyEmailToken(parsed.token);
      res.status(200).json({ success: true, user: transformUser(user) });
    } catch (err: any) {
      console.error('[AuthController/verify] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async requestReset(req: Request, res: Response): Promise<void> {
    try {
      const parsed = ResetPasswordRequestSchema.parse(req.body);
      const result = await authService.requestPasswordReset(parsed.email, parsed.redirectTo);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[AuthController/requestReset] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async validateResetToken(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }
      const result = await authService.validatePasswordResetToken(token);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[AuthController/validateResetToken] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async completeReset(req: Request, res: Response): Promise<void> {
    try {
      const parsed = ResetPasswordSubmitSchema.parse(req.body);
      const result = await authService.completePasswordReset(parsed.token, parsed.password);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[AuthController/completeReset] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async getMe(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const user = await userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.status(200).json({ success: true, user: transformUser(user) });
    } catch (err: any) {
      console.error('[AuthController/getMe] Error:', err);
      res.status(500).json({ error: err.message || err });
    }
  }

  async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { 
        name, 
        avatarUrl,
        companyName,
        taxId,
        phoneNumber,
        address,
        bankName,
        bankAccountName,
        bankAccountNo
      } = req.body;

      if (!name || name.trim().length < 2) {
        res.status(400).json({ error: 'Name must be at least 2 characters long' });
        return;
      }

      const user = await userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Handle Tenant profile details if the active user role clearance is TENANT
      if (user.role === 'TENANT') {
        const payloadBankAccount = JSON.stringify({
          accountName: bankAccountName || '',
          accountNo: bankAccountNo || ''
        });

        await prisma.tenantProfile.upsert({
          where: { userId },
          create: {
            userId,
            companyName: companyName || '',
            taxId: taxId || '',
            phoneNumber: phoneNumber || '',
            address: address || '',
            bankName: bankName || '',
            bankAccount: payloadBankAccount,
            isVerified: false
          },
          update: {
            companyName: companyName !== undefined ? companyName : undefined,
            taxId: taxId !== undefined ? taxId : undefined,
            phoneNumber: phoneNumber !== undefined ? phoneNumber : undefined,
            address: address !== undefined ? address : undefined,
            bankName: bankName !== undefined ? bankName : undefined,
            bankAccount: (bankAccountName !== undefined || bankAccountNo !== undefined) ? payloadBankAccount : undefined
          }
        });
      }

      const updated = await userRepository.update(userId, { name, avatarUrl });
      res.status(200).json({ success: true, user: transformUser(updated) });
    } catch (err: any) {
      console.error('[AuthController/updateProfile] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async uploadAvatar(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        res.status(400).json({ error: 'Silakan pilih gambar terlebih dahulu.' });
        return;
      }

      const file = req.file;

      // Validate maximum file size (1 MB)
      if (file.size > 1 * 1024 * 1024) {
        res.status(400).json({ error: 'Ukuran gambar maksimal 1 MB.' });
        return;
      }

      // Validate MIME type & file extension
      const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      const ext = path.extname(file.originalname || '').toLowerCase();
      const mime = (file.mimetype || '').toLowerCase();

      if (!allowedMimeTypes.includes(mime) || !allowedExtensions.includes(ext)) {
        res.status(400).json({ error: 'Format gambar tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP.' });
        return;
      }

      // Validate Magic Bytes to prevent MIME spoofing / executable upload / corrupted images
      const buffer = file.buffer;
      const isJpeg = buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
      const isPng = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      const isWebp = buffer.length >= 12 && 
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // 'RIFF'
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50; // 'WEBP'

      if (!isJpeg && !isPng && !isWebp) {
        res.status(400).json({ error: 'Format gambar tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP.' });
        return;
      }

      const supabase = getSupabaseAdmin();

      // Ensure the storage bucket exists
      try {
        await supabase.storage.createBucket('avatars', {
          public: true,
          fileSizeLimit: 1 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
        });
      } catch (err) {
        // Ignore if exists
      }

      // Storage path: avatars/{userId}/avatar.webp
      const storagePath = `avatars/${userId}/avatar.webp`;
      
      const { data, error } = await supabase.storage
        .from('avatars')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype || 'image/webp',
          upsert: true
        });

      if (error) {
        throw new Error(error.message);
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(storagePath);

      // Save to user database
      const updatedUser = await userRepository.update(userId, { avatarUrl: publicUrl });
      
      res.status(200).json({ 
        success: true, 
        avatarUrl: publicUrl,
        user: transformUser(updatedUser)
      });
    } catch (err: any) {
      console.error('[AuthController/uploadAvatar] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async updateAvatarViaUrl(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { url } = req.body;
      if (!url) {
        res.status(400).json({ error: 'URL is required' });
        return;
      }

      // 1. Validate URL malformedness
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch (_) {
        res.status(400).json({ error: 'Malformed URL provided.' });
        return;
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        res.status(400).json({ error: 'Only HTTP and HTTPS protocols are allowed.' });
        return;
      }

      // 2. Validate image content (fetch headers)
      try {
        const fetchRes = await fetch(url, { method: 'HEAD' });
        const contentType = fetchRes.headers.get('content-type') || '';
        if (!fetchRes.ok) {
          throw new Error('Url is unreachable');
        }
        if (!contentType.startsWith('image/')) {
          res.status(400).json({ error: 'The URL does not point to a valid image.' });
          return;
        }
      } catch (err) {
        // Fallback to GET
        try {
          const fetchRes = await fetch(url);
          const contentType = fetchRes.headers.get('content-type') || '';
          if (!fetchRes.ok || !contentType.startsWith('image/')) {
            res.status(400).json({ error: 'Failed to access the image or it is not a valid image format.' });
            return;
          }
        } catch (fetchErr: any) {
          res.status(400).json({ error: 'Could not access or validate image. Please ensure the link is active and public.' });
          return;
        }
      }

      // Save URL to database
      const updatedUser = await userRepository.update(userId, { avatarUrl: url });
      res.status(200).json({ 
        success: true, 
        avatarUrl: url,
        user: transformUser(updatedUser)
      });
    } catch (err: any) {
      console.error('[AuthController/updateAvatarViaUrl] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { settings } = req.body;
      const updated = await userRepository.update(userId, { settings });
      res.status(200).json({ success: true, user: transformUser(updated) });
    } catch (err: any) {
      console.error('[AuthController/updateSettings] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'Current password and new password are required' });
        return;
      }

      // Password rules validations:
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long' });
        return;
      }
      if (!/[A-Z]/.test(newPassword)) {
        res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
        return;
      }
      if (!/[a-z]/.test(newPassword)) {
        res.status(400).json({ error: 'Password must contain at least one lowercase letter' });
        return;
      }
      if (!/[0-9]/.test(newPassword)) {
        res.status(400).json({ error: 'Password must contain at least one number' });
        return;
      }

      const user = await userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Verify current password locally
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        res.status(400).json({ error: 'Incorrect current password' });
        return;
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);

      // Async sync to Supabase auth provider
      try {
        const supabaseAdmin = getSupabaseAdmin();
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
        if (error) {
          console.warn('[AuthController/changePassword] Supabase update warning:', error.message);
        }
      } catch (sysRoleErr) {
        console.warn('[AuthController/changePassword] Supabase service key update omitted or errored, continuing locally:', sysRoleErr);
      }

      // Update locally in Prisma
      await userRepository.update(userId, { password: hashedNewPassword });

      res.status(200).json({ success: true, message: 'Password changed successfully' });
    } catch (err: any) {
      console.error('[AuthController/changePassword] Error:', err);
      res.status(400).json({ error: err.message || err });
    }
  }

  async becomeHost(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { requireApproval, companyName, phoneNumber, address } = req.body;

      const user = await userRepository.findById(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Check if user is already TENANT, HOST, or ADMIN
      if (user.role === 'TENANT' || user.role === 'HOST' || user.role === 'ADMIN') {
        res.status(400).json({ error: 'User is already a host or administrator.' });
        return;
      }

      if (requireApproval) {
        // Check for existing host application to prevent duplicates
        const existingApplication = await prisma.hostApplication.findUnique({
          where: { userId }
        });

        if (existingApplication) {
          res.status(400).json({ error: 'Duplicate host application is not allowed.' });
          return;
        }

        // Create HostApplication with status = PENDING
        const hostApp = await prisma.hostApplication.create({
          data: {
            userId,
            status: 'PENDING'
          }
        });

        res.status(200).json({ 
          success: true, 
          message: 'Host application submitted successfully.',
          hostApplication: hostApp,
          user: transformUser(user) 
        });
        return;
      } else {
        // Dynamic role handling: update USER -> TENANT, and create TenantProfile automatically
        
        // 1. Create TenantProfile
        await prisma.tenantProfile.upsert({
          where: { userId },
          create: {
            userId,
            companyName: companyName || `${user.name} Properties`,
            phoneNumber: phoneNumber || '',
            address: address || '',
            bankName: '',
            bankAccount: '{}',
            isVerified: true
          },
          update: {
            isVerified: true
          }
        });

        // 2. Update role to TENANT
        const updatedUser = await userRepository.update(userId, { role: 'TENANT' });

        res.status(200).json({
          success: true,
          message: 'Upgraded to Host successfully.',
          user: transformUser(updatedUser)
        });
        return;
      }
    } catch (err: any) {
      console.error('[AuthController/becomeHost] Error:', err);
      res.status(500).json({ error: err.message || err });
    }
  }

  async callback(req: Request, res: Response): Promise<void> {
    const code = req.query.code as string;
    if (!code) {
      res.redirect('/login?error=No+authorization+code+found');
      return;
    }
    res.send(`
      <html>
        <body>
          <script>
            window.location.href = '/auth/callback-oauth' + window.location.search;
          </script>
          <p>Redirecting to secure callback handler...</p>
        </body>
      </html>
    `);
  }

  async callbackExchange(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.body;
      if (!id) {
        res.status(400).json({ error: 'User ID is required' });
        return;
      }
      const user = await this.verifyAndUpsertOAuthUser(id);
      const token = this.generateSessionToken(user);
      res.status(200).json({ user: transformUser(user), token });
    } catch (err: any) {
      console.error('[AuthController/callbackExchange] Error:', err);
      res.status(500).json({ error: err.message || 'Authentication exchange failed' });
    }
  }

  async verifyAndUpsertOAuthUser(id: string) {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
    if (error || !data?.user) {
      throw new Error(error?.message || 'Failed to fetch user from Supabase');
    }
    const supabaseUser = data.user;
    const email = supabaseUser.email;
    if (!email) {
      throw new Error('No email found in Supabase user data');
    }
    const name = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || email.split('@')[0];
    const avatarUrl = supabaseUser.user_metadata?.avatar_url || supabaseUser.user_metadata?.picture || null;
    return this.upsertLocalOAuthUser(id, email, name, avatarUrl);
  }

  async upsertLocalOAuthUser(id: string, email: string, name: string, avatarUrl: string | null) {
    const localUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { tenantProfile: true }
    });
    if (localUser) {
      return this.updateExistingLocalUser(localUser, id, avatarUrl);
    }
    return this.createNewLocalUser(id, email, name, avatarUrl);
  }

  async updateExistingLocalUser(localUser: any, id: string, avatarUrl: string | null) {
    const settings = (localUser.settings as any) || {};
    return prisma.user.update({
      where: { id: localUser.id },
      data: {
        lastLoginAt: new Date(),
        avatarUrl: localUser.avatarUrl || avatarUrl,
        settings: { ...settings, provider: 'google', providerId: id },
        isVerified: true
      },
      include: { tenantProfile: true }
    });
  }

  async createNewLocalUser(id: string, email: string, name: string, avatarUrl: string | null) {
    const data = {
      id, email: email.toLowerCase(), password: '', name, role: Role.USER,
      isVerified: true, avatarUrl, settings: { provider: 'google', providerId: id },
      lastLoginAt: new Date()
    };
    return prisma.user.create({ data, include: { tenantProfile: true } });
  }

  generateSessionToken(user: any) {
    const jwtSecret = process.env.JWT_SECRET || 'stayease-secret-key-9021';
    return jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: '24h' }
    );
  }
}

export const authController = new AuthController();
