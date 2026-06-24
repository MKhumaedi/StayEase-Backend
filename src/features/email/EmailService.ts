import nodemailer from 'nodemailer';
import { config } from './EmailConfig';

export interface EmailResult {
  success: boolean;
  message: string;
  skipped: boolean;
}

export class EmailService {
  private transporter: any = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    if (!config.emailEnabled) {
      console.warn('[EmailService] EMAIL_ENABLED=false. Skipping mail server connection setup.');
      return;
    }

    if (config.isSMTPConfigured) {
      try {
        console.log('[EmailService] Initializing nodemailer SMTP connection with:', config.smtpHost);
        this.transporter = nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpPort === 465, // true for 465, false for 587/other
          auth: {
            user: config.smtpUser,
            pass: config.smtpPassword,
          },
        });
      } catch (err: any) {
        console.error('[EmailService] SMTP Transporter initialization failed:', err.message || err);
        this.transporter = null;
      }
    } else if (config.isResendConfigured) {
      console.log('[EmailService] SMTP not configured. Using Resend web API transporter.');
    } else {
      console.warn('[EmailService] SMTP credentials and Resend API keys are missing. Email service is inactive.');
    }
  }

  /**
   * Primary robust method to send any HTML-formatted message
   */
  async sendEmail(to: string, subject: string, html: string): Promise<EmailResult> {
    const skipResponse = (reason: string): EmailResult => {
      const msg = `Email service is not configured. ${reason}`;
      console.warn(`[EmailService] SKIPPED: ${msg}`);
      return { success: true, message: msg, skipped: true };
    };

    if (!config.emailEnabled) {
      return skipResponse('EMAIL_ENABLED flag is false.');
    }

    if (!to) {
      console.error('[EmailService] Cannot send email without recipient address.');
      return { success: false, message: 'No recipient email specified', skipped: false };
    }

    // 1. Try SMTP Transporter if available
    if (config.isSMTPConfigured && this.transporter) {
      try {
        console.log(`[EmailService] Delivering via SMTP to: ${to}`);
        await this.transporter.sendMail({
          from: config.smtpFrom,
          to,
          subject,
          html,
        });
        return { success: true, message: 'Email sent successfully via SMTP.', skipped: false };
      } catch (err: any) {
        console.error(`[EmailService] SMTP Delivery to ${to} failed, falling back if possible:`, err.message || err);
      }
    }

    // 2. Try Resend HTTP API as robust fallback or primary
    if (config.isResendConfigured) {
      try {
        console.log(`[EmailService] Delivering via Resend API to: ${to}`);
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: config.smtpFrom,
            to: [to],
            subject,
            html,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error(`[EmailService] Resend API returned status ${response.status}: ${text}`);
          throw new Error(`Resend API status ${response.status}`);
        }

        return { success: true, message: 'Email sent successfully via Resend API.', skipped: false };
      } catch (err: any) {
        console.error(`[EmailService] Resend Delivery to ${to} failed:`, err.message || err);
      }
    }

    // 3. Fallback gracefully if both transporters failed or were unconfigured
    return skipResponse('No valid SMTP or Resend credentials available.');
  }

  /**
   * Specific helper to send non-blocking onboarding registration verification email
   */
  async sendVerificationEmail(name: string, email: string, token: string, redirectTo: string): Promise<EmailResult> {
    const verifyLink = `${redirectTo}?token=${token}`;
    const subject = 'Verify your email address - StayEase';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #f1f5f9; border-radius: 16px;">
        <h2 style="color: #4f46e5; margin-bottom: 20px;">Welcome to StayEase</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>Thank you for registering on StayEase. Please verify your email address to complete your registration secure onboarding.</p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="${verifyLink}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; font-size: 14px; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        <p style="font-size: 12px; color: #64748b;">If the button above does not work, copy and paste this link into your browser:</p>
        <p style="font-size: 12px; font-family: monospace; word-break: break-all; color: #64748b; background-color: #f8fafc; padding: 10px; border-radius: 6px;">${verifyLink}</p>
        <div style="margin-top: 30px; border-t: 1px solid #f1f5f9; padding-top: 20px; font-size: 11px; color: #94a3b8;">
          This email was sent dynamically from StayEase platform.
        </div>
      </div>
    `;
    return this.sendEmail(email, subject, html);
  }

  /**
   * Specific helper to send password reset request email
   */
  async sendPasswordResetEmail(name: string, email: string, token: string, resetLink: string): Promise<EmailResult> {
    const fullResetUrl = `${resetLink}?token=${token}`;
    const subject = 'Reset your password - StayEase';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #f1f5f9; border-radius: 16px;">
        <h2 style="color: #e11d48; margin-bottom: 20px;">Reset Password Request</h2>
        <p>Hello <strong>${name}</strong>,</p>
        <p>We received a password reset request for your StayEase account. You can reset your password using the secure override button below:</p>
        <div style="margin: 30px 0; text-align: center;">
          <a href="${fullResetUrl}" style="background-color: #e11d48; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; font-size: 14px; display: inline-block;">
            Reset StayEase Password
          </a>
        </div>
        <p style="font-size: 12px; color: #64748b;">If you did not request this, please ignore this email. Your credentials remain completely unaltered.</p>
        <p style="font-size: 12px; font-family: monospace; word-break: break-all; color: #64748b; background-color: #f8fafc; padding: 10px; border-radius: 6px;">${fullResetUrl}</p>
        <div style="margin-top: 30px; border-t: 1px solid #f1f5f9; padding-top: 20px; font-size: 11px; color: #94a3b8;">
          This security-override payload expires shortly.
        </div>
      </div>
    `;
    return this.sendEmail(email, subject, html);
  }
}

export const emailService = new EmailService();
export default emailService;
