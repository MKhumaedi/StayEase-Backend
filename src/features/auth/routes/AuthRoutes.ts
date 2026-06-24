import { Router } from 'express';
import { authController, upload } from '../controllers/AuthController';
import { requireAuth } from '../../../middlewares/AuthMiddleware';
import { DuplicateSubmissionGuard, RequestGuard } from '../../../protection';

const router = Router();

router.post('/register', DuplicateSubmissionGuard as any, RequestGuard('register', (req) => req.body.email || '') as any, (req, res) => authController.register(req, res));
router.post('/login', DuplicateSubmissionGuard as any, RequestGuard('login', (req) => req.body.email || '') as any, (req, res) => authController.login(req, res));

router.get('/config', (req, res) => authController.getConfig(req, res));
router.get(['/callback', '/callback/'], (req, res) => authController.callback(req, res));
router.post('/callback-exchange', (req, res) => authController.callbackExchange(req, res));
router.get('/verification-report', (req, res) => authController.getVerificationReport(req, res));
router.post('/verify-supabase', (req, res) => authController.verifySupabase(req, res));
router.post('/verify', (req, res) => authController.verify(req, res));
router.post('/resend-verification', (req, res) => authController.resendVerification(req, res));
router.post('/update-role', (req, res) => authController.updateRole(req, res));
router.post('/become-host', requireAuth as any, (req, res) => authController.becomeHost(req, res));
router.post('/reset-password/request', (req, res) => authController.requestReset(req, res));
router.post('/reset-password/complete', (req, res) => authController.completeReset(req, res));

// Secure Account Management routes
router.get('/me', requireAuth as any, (req, res) => authController.getMe(req, res));
router.put('/profile', requireAuth as any, (req, res) => authController.updateProfile(req, res));
router.post('/profile/avatar/upload', requireAuth as any, upload.single('avatar'), (req, res) => authController.uploadAvatar(req, res));
router.post('/profile/avatar/url', requireAuth as any, (req, res) => authController.updateAvatarViaUrl(req, res));
router.put('/settings', requireAuth as any, (req, res) => authController.updateSettings(req, res));
router.put('/change-password', requireAuth as any, (req, res) => authController.changePassword(req, res));

export default router;
