import fs from 'fs';
import path from 'path';

// Define directories for persistent JSON store
const DATA_DIR = path.join(process.cwd(), 'backend', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  module: string;
  details: string;
  timestamp: string;
}

export interface SystemSettings {
  platformName: string;
  logo: string;
  contactEmail: string;
  currency: string;
  taxPercentage: number;
  commissionPercentage: number;
  maintenanceMode: boolean;
}

const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit-logs.json');
const SYSTEM_SETTINGS_FILE = path.join(DATA_DIR, 'system-settings.json');

const DEFAULT_SETTINGS: SystemSettings = {
  platformName: 'StayEase',
  logo: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=150&q=80',
  contactEmail: 'support@stayease.com',
  currency: 'USD',
  taxPercentage: 11,
  commissionPercentage: 15,
  maintenanceMode: false
};

export class AuditService {
  static getLogs(): AuditLog[] {
    try {
      if (fs.existsSync(AUDIT_LOGS_FILE)) {
        const raw = fs.readFileSync(AUDIT_LOGS_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('Failed to read audit logs:', err);
    }
    return [];
  }

  static log(userId: string, userName: string, action: string, module: string, details: string) {
    try {
      const logs = this.getLogs();
      const newLog: AuditLog = {
        id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId,
        userName,
        action,
        module,
        details,
        timestamp: new Date().toISOString()
      };
      logs.unshift(newLog);
      // Keep only last 1000 logs to prevent bloat
      if (logs.length > 1000) {
        logs.pop();
      }
      fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
      console.log(`[AUDIT LOG] ${userName} (${userId}) performed ${action} on ${module}: ${details}`);
    } catch (err) {
      console.error('Failed to write audit log:', err);
    }
  }
}

export class SettingsService {
  static getSettings(): SystemSettings {
    try {
      if (fs.existsSync(SYSTEM_SETTINGS_FILE)) {
        const raw = fs.readFileSync(SYSTEM_SETTINGS_FILE, 'utf8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('Failed to read system settings:', err);
    }
    return DEFAULT_SETTINGS;
  }

  static updateSettings(updates: Partial<SystemSettings>): SystemSettings {
    const current = this.getSettings();
    const updated = { ...current, ...updates };
    try {
      fs.writeFileSync(SYSTEM_SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save system settings:', err);
    }
    return updated;
  }
}
