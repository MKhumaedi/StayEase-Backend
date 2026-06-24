import dotenv from 'dotenv';
dotenv.config();

export interface EmailConfig {
  emailEnabled: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  resendApiKey?: string;
  isSMTPConfigured: boolean;
  isResendConfigured: boolean;
}

const parsePort = (portStr?: string): number | undefined => {
  if (!portStr) return undefined;
  const parsed = parseInt(portStr, 10);
  return isNaN(parsed) ? undefined : parsed;
};

// Centralized configuration parsing
export const getEmailConfig = (): EmailConfig => {
  const emailEnabled = process.env.EMAIL_ENABLED === 'true';
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parsePort(process.env.SMTP_PORT);
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpFrom = process.env.SMTP_FROM || 'StayEase <noreply@stayease.com>';
  const resendApiKey = process.env.RESEND_API_KEY;

  const isSMTPConfigured = !!(smtpHost && smtpPort && smtpUser && smtpPassword);
  const isResendConfigured = !!resendApiKey;

  return {
    emailEnabled,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    smtpFrom,
    resendApiKey,
    isSMTPConfigured,
    isResendConfigured
  };
};

export const config = getEmailConfig();
