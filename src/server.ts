import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env files robustly from current or parent directories
dotenv.config();
const currentPath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentPath);
dotenv.config({ path: path.resolve(currentDir, '../.env') });
dotenv.config({ path: path.resolve(currentDir, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import express from 'express';
import fs from 'fs';
import { getSupabaseClient } from './features/auth/services/supabase';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import authRouter from './features/auth/routes/AuthRoutes';
import notificationRouter from './features/notifications/routes/NotificationRoutes';
import reviewRouter from './features/reviews/routes/ReviewRoutes';
import adminRouter from './features/admin/routes/AdminRoutes';
import paymentRouter from './features/payments/routes/PaymentRoutes';
import { propertyController } from './features/properties/controllers/PropertyController';
import { favoriteController } from './features/properties/controllers/FavoriteController';
import { bookingController } from './features/bookings/controllers/BookingController';
import { requireAuth } from './middlewares/AuthMiddleware';
import { prisma } from './database/prisma';
import { AuditService } from './features/admin/services/AdminServices';
import { propertyRepository } from './features/properties/repositories/PropertyRepository';
import {
  getHousekeepingTasks,
  updateHousekeepingTask,
  getMaintenanceRequests,
  createMaintenanceRequest,
  updateMaintenanceStatus
} from './database/housekeeping_maintenance';
import uploadRouter from './features/uploads/routes/UploadRoutes';
import tenantPaymentsRouter from './features/tenant-payments/routes/TenantPaymentsRoutes';
import { IdempotencyMiddleware, DuplicateSubmissionGuard, RequestGuard } from './protection';

async function setupDatabaseTriggers() {
  try {
    console.log('[DatabaseTriggers] Initializing StayEase email verification synchronization triggers on PostgreSQL...');

    // A. Create HostApplication table if not exists (dynamic database support)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public."HostApplication" (
          id text PRIMARY KEY,
          "userId" text UNIQUE NOT NULL,
          status text NOT NULL DEFAULT 'PENDING',
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          CONSTRAINT "HostApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE CASCADE
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "HostApplication_userId_idx" ON public."HostApplication" ("userId");
      `);
      console.log('[DatabaseTriggers] Successfully verified or created "HostApplication" table.');
    } catch (e: any) {
      console.error('[DatabaseTriggers] Error ensuring "HostApplication" table exists:', e.message);
    }

    // B. Create Favorite table if not exists
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public."Favorite" (
          id text PRIMARY KEY,
          "userId" text NOT NULL,
          "propertyId" text NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE CASCADE,
          CONSTRAINT "Favorite_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES public."Property"(id) ON DELETE CASCADE
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_userId_propertyId_key" ON public."Favorite" ("userId", "propertyId");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "Favorite_userId_idx" ON public."Favorite" ("userId");
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "Favorite_propertyId_idx" ON public."Favorite" ("propertyId");
      `);
      console.log('[DatabaseTriggers] Successfully verified or created "Favorite" table.');
    } catch (e: any) {
      console.error('[DatabaseTriggers] Error ensuring "Favorite" table exists:', e.message);
    }

    // 1. Create the helper function to synchronize verified status automatically
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION public.sync_auth_user_verified()
      RETURNS trigger AS $$
      BEGIN
        UPDATE public."User"
        SET "isVerified" = (NEW.email_confirmed_at IS NOT NULL)
        WHERE id::text = NEW.id::text;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);

    // 2. Set up trigger for update actions on auth.users
    try {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;');
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER on_auth_user_updated
        AFTER UPDATE OF email_confirmed_at ON auth.users
        FOR EACH ROW
        EXECUTE PROCEDURE public.sync_auth_user_verified();
      `);
      console.log('[DatabaseTriggers] Successfully registered UPDATE trigger on auth.users.');
    } catch (e: any) {
      console.warn('[DatabaseTriggers] Skipping auth schema triggers (Expected if running in local sandbox or restricted credential level):', e.message);
    }

    // 3. Set up trigger for insert actions on auth.users (to handle pre-confirmed users)
    try {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS on_auth_user_inserted ON auth.users;');
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER on_auth_user_inserted
        AFTER INSERT ON auth.users
        FOR EACH ROW
        EXECUTE PROCEDURE public.sync_auth_user_verified();
      `);
      console.log('[DatabaseTriggers] Successfully registered INSERT trigger on auth.users.');
    } catch (e: any) {
      console.warn('[DatabaseTriggers] Skipping insert trigger setup:', e.message);
    }

    // 4. Force a one-off synchronization at boot to reconcile any out-of-sync confirmed users
    try {
      const updatedRowsCount = await prisma.$executeRawUnsafe(`
        UPDATE public."User" u
        SET "isVerified" = true
        FROM auth.users au
        WHERE u.id::text = au.id::text
          AND au.email_confirmed_at IS NOT NULL
          AND u."isVerified" = false;
      `);
      console.log('[DatabaseTriggers] Reconciled existing user verifications. Total updated records:', updatedRowsCount);
    } catch (e: any) {
      console.warn('[DatabaseTriggers] Manual batch synchronization skipped:', e.message);
    }
  } catch (error: any) {
    console.error('[DatabaseTriggers] Unexpected error during trigger setup:', error);
  }
}

async function startServer() {
  const app = express();
  let PORT = Number(process.env.PORT || 5000);
  
  // Hardened port allocation: prevent dev conflicts when concurrently starts on PORT=3000
  if (process.env.NODE_ENV !== 'production' && PORT === 3000) {
    PORT = 5000;
  }

  app.use(express.json());

  // CORS Middleware
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    
    // Parse allowed origins from environment
    const configuredOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : [];

    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      ...configuredOrigins
    ];

    if (allowedOrigins.includes(origin) || process.env.CORS_ORIGIN === '*') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Idempotency-Key, X-Client-Platform');
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // GET /health check endpoint
  app.get('/health', async (req, res) => {
    let dbHealthy = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
      dbHealthy = false;
    }

    const isHealthy = dbHealthy;
    res.status(isHealthy ? 200 : 500).json({
      status: isHealthy ? 'healthy' : 'degraded',
      database: dbHealthy,
      server: true
    });
  });

  // Set up SQL triggers and sync state prior to servicing traffic
  await setupDatabaseTriggers();

  // API - Auth routes
  app.use('/api/auth', authRouter);

  // API - Admin routes
  app.use('/api/admin', adminRouter);

  // API - Notification routes
  app.use('/api/notifications', notificationRouter);

  // API - Review routes
  app.use('/api/reviews', reviewRouter);

  // API - Payment routes
  app.use('/api/payments', paymentRouter);

  // API - Upload routes
  app.use('/api/uploads', uploadRouter);

  // API - Tenant payments routes
  app.use('/api/tenant/payments', tenantPaymentsRouter);

  // Support local uploads pathing dynamically
  const getUploadDir = () => {
    if (process.env.UPLOAD_DIR) {
      const customPath = process.env.UPLOAD_DIR;
      const p = path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      return p;
    }
    const possiblePaths = [
      path.join(process.cwd(), 'backend', 'src', 'uploads'),
      path.join(process.cwd(), 'uploads'),
      path.resolve(__dirname, '../../uploads'),
      path.resolve(__dirname, '../../../uploads')
    ];
    for (const p of possiblePaths) {
      try {
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        return p;
      } catch (e) {
        // continue
      }
    }
    return '/tmp';
  };
  app.use('/uploads', express.static(getUploadDir()));

  // API - Property routes
  app.get('/api/properties/filter-options', async (req, res) => {
    try {
      const dbProperties = await prisma.property.findMany({
        where: { deletedAt: null, status: { in: ['ACTIVE', 'PUBLISHED'] } },
        select: {
          city: true,
          location: true,
          amenities: true,
        }
      });

      const categories = await prisma.propertyCategory.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' }
      });
      const uniqueCities = Array.from(new Set(
        dbProperties.map(p => {
          if (p.city && p.city.trim() !== '') {
            return p.city.trim();
          }
          if (p.location && p.location.trim() !== '') {
            const parts = p.location.split(',');
            return parts[0].trim();
          }
          return '';
        })
      ))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      // Extract unique amenities
      const uniqueAmenities = Array.from(new Set(
        dbProperties.flatMap(p => p.amenities || [])
      )).filter(Boolean);

      // Dynamically calculate min/max room basePrice
      const roomAggr = await prisma.room.aggregate({
        where: {
          deletedAt: null,
          property: {
            deletedAt: null,
            status: { in: ['ACTIVE', 'PUBLISHED'] }
          }
        },
        _min: { basePrice: true },
        _max: { basePrice: true }
      });

      const propAggr = await prisma.property.aggregate({
        where: { deletedAt: null, status: { in: ['ACTIVE', 'PUBLISHED'] } },
        _min: { basePrice: true },
        _max: { basePrice: true }
      });

      const minPrice = roomAggr._min.basePrice ?? propAggr._min.basePrice ?? 50000;
      const maxPrice = roomAggr._max.basePrice ?? propAggr._max.basePrice ?? 5000000;

      res.json({
        cities: uniqueCities,
        categories: categories,
        amenities: uniqueAmenities,
        minPrice,
        maxPrice
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/properties', (req, res) => propertyController.listProperties(req, res));
  app.get('/api/properties/:id', (req, res) => propertyController.getProperty(req, res));
  app.get('/api/quotes', (req, res) => propertyController.getQuotes(req, res));
  app.post('/api/properties/calendar/bulk-update', (req, res) => propertyController.bulkUpdateCalendar(req, res));
  app.post('/api/properties', requireAuth as any, IdempotencyMiddleware as any, DuplicateSubmissionGuard as any, RequestGuard('property_create', (req) => req.body.name || '') as any, (req, res) => propertyController.createProperty(req, res));
  app.put('/api/properties/:id', requireAuth as any, IdempotencyMiddleware as any, DuplicateSubmissionGuard as any, RequestGuard('property_update', (req) => req.params.id) as any, (req, res) => propertyController.updateProperty(req, res));
  app.delete('/api/properties/:id', requireAuth as any, IdempotencyMiddleware as any, DuplicateSubmissionGuard as any, RequestGuard('property_delete', (req) => req.params.id) as any, (req, res) => propertyController.deleteProperty(req, res));

  // Local helper for date generation inside Peak Season routes
  function getDatesBetweenLocal(startDateStr: string, endDateStr: string): string[] {
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return [startDateStr];
    }
    const dates: string[] = [];
    const curr = new Date(start);
    while (curr <= end) {
      const yyyy = curr.getFullYear();
      const mm = String(curr.getMonth() + 1).padStart(2, '0');
      const dd = String(curr.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
      curr.setDate(curr.getDate() + 1);
    }
    return dates;
  }

  // Peak Season APIs for Tenants/Hosts
  app.get('/api/properties/:propertyId/peak-seasons', requireAuth as any, async (req: any, res) => {
    try {
      const tenantId = req.userId;
      const { propertyId } = req.params;
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return res.status(404).json({ error: 'Property not found.' });
      if (property.tenantId !== tenantId && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Access denied.' });
      }

      const seasons = await prisma.peakSeasonRate.findMany({
        where: { propertyId, deletedAt: null },
        include: {
          room: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json({ success: true, seasons });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/properties/:propertyId/peak-seasons', requireAuth as any, async (req: any, res) => {
    try {
      const tenantId = req.userId;
      const { propertyId } = req.params;
      const { name, roomId, startDate, endDate, rateMultiplier, adjustmentType, adjustmentValue, isActive, applyMode, dates, isClosed } = req.body;

      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return res.status(404).json({ error: 'Property not found.' });
      if (property.tenantId !== tenantId && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Access denied.' });
      }

      if (!name) return res.status(400).json({ error: 'Rule name is required.' });

      // Identify all dates this rule is being applied to
      let datesToCheck: string[] = [];
      if (applyMode === 'RANGE') {
        if (!startDate || !endDate) return res.status(400).json({ error: 'Start and end dates are required for range mode.' });
        datesToCheck = getDatesBetweenLocal(startDate, endDate);
      } else if (applyMode === 'MULTIPLE') {
        if (!dates || !Array.isArray(dates) || dates.length === 0) {
          return res.status(400).json({ error: 'At least one selected date is required.' });
        }
        datesToCheck = dates;
      } else { // SINGLE
        if (!startDate) return res.status(400).json({ error: 'Target date is required.' });
        datesToCheck = [startDate];
      }

      // Check overlap for every single targeted date against active rules
      const existing = await prisma.peakSeasonRate.findMany({
        where: { propertyId, deletedAt: null, isActive: true }
      });

      for (const dateStr of datesToCheck) {
        const match = existing.find(s => {
          const inRange = dateStr >= s.startDate && dateStr <= s.endDate;
          const sameRoom = s.roomId === roomId || s.roomId === null || roomId === null;
          return inRange && sameRoom;
        });
        if (match) {
          return res.status(400).json({ 
            error: `Overlapping rule detected! Date ${dateStr} is already covered by the rule "${match.name}".` 
          });
        }
      }

      // Create PeakSeasonRate entries in database
      const recordsToCreate = [];
      const cleanRoomId = (roomId === '' || roomId === 'all' || roomId === 'null' || !roomId) ? null : roomId;

      if (applyMode === 'MULTIPLE') {
        for (const dateStr of datesToCheck) {
          recordsToCreate.push({
            name,
            propertyId,
            roomId: cleanRoomId,
            startDate: dateStr,
            endDate: dateStr,
            rateMultiplier: Number(rateMultiplier),
            adjustmentType: adjustmentType || 'PERCENTAGE_INCREASE',
            adjustmentValue: Number(adjustmentValue),
            isActive: isActive !== false
          });
        }
      } else {
        recordsToCreate.push({
          name,
          propertyId,
          roomId: cleanRoomId,
          startDate,
          endDate,
          rateMultiplier: Number(rateMultiplier),
          adjustmentType: adjustmentType || 'PERCENTAGE_INCREASE',
          adjustmentValue: Number(adjustmentValue),
          isActive: isActive !== false
        });
      }

      await prisma.peakSeasonRate.createMany({
        data: recordsToCreate
      });

      // If Booking Closed is checked, block in RoomAvailability
      if (isClosed) {
        const roomsToBlock = cleanRoomId ? [{ id: cleanRoomId }] : await prisma.room.findMany({ where: { propertyId, deletedAt: null } });
        for (const r of roomsToBlock) {
          await propertyRepository.bulkUpdateAvailability(r.id, datesToCheck, true);
        }
      }

      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      AuditService.log(
        req.userId,
        user ? user.name : 'Host',
        'CREATE_PEAK_SEASON',
        'PEAK_SEASON',
        `Created peak season rule "${name}" with adjustment ${adjustmentType === 'PERCENTAGE_INCREASE' ? '+' + adjustmentValue + '%' : 'Rp' + adjustmentValue} for ${datesToCheck.length} day(s).`
      );

      res.status(201).json({ success: true, message: 'Peak season rule saved successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/properties/:propertyId/peak-seasons/:oldName', requireAuth as any, async (req: any, res) => {
    try {
      const tenantId = req.userId;
      const { propertyId, oldName } = req.params;
      const { name, roomId, startDate, endDate, rateMultiplier, adjustmentType, adjustmentValue, isActive, applyMode, dates, isClosed } = req.body;

      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return res.status(404).json({ error: 'Property not found.' });
      if (property.tenantId !== tenantId && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Access denied.' });
      }

      if (!name) return res.status(400).json({ error: 'Rule name is required.' });

      // Temporary soft delete old rules under this oldName to avoid false self-overlap matches
      await prisma.peakSeasonRate.updateMany({
        where: { propertyId, name: oldName, deletedAt: null },
        data: { deletedAt: new Date() }
      });

      // Gather dates for overlap check
      let datesToCheck: string[] = [];
      if (applyMode === 'RANGE') {
        if (!startDate || !endDate) {
          // Restore old rules
          await prisma.peakSeasonRate.updateMany({
            where: { propertyId, name: oldName, deletedAt: { not: null } },
            data: { deletedAt: null }
          });
          return res.status(400).json({ error: 'Start and end dates are required for range mode.' });
        }
        datesToCheck = getDatesBetweenLocal(startDate, endDate);
      } else if (applyMode === 'MULTIPLE') {
        if (!dates || !Array.isArray(dates) || dates.length === 0) {
          // Restore old rules
          await prisma.peakSeasonRate.updateMany({
            where: { propertyId, name: oldName, deletedAt: { not: null } },
            data: { deletedAt: null }
          });
          return res.status(400).json({ error: 'At least one selected date is required.' });
        }
        datesToCheck = dates;
      } else {
        if (!startDate) {
          // Restore old rules
          await prisma.peakSeasonRate.updateMany({
            where: { propertyId, name: oldName, deletedAt: { not: null } },
            data: { deletedAt: null }
          });
          return res.status(400).json({ error: 'Target date is required.' });
        }
        datesToCheck = [startDate];
      }

      const existing = await prisma.peakSeasonRate.findMany({
        where: { propertyId, deletedAt: null, isActive: true }
      });

      for (const dateStr of datesToCheck) {
        const match = existing.find(s => {
          const inRange = dateStr >= s.startDate && dateStr <= s.endDate;
          const sameRoom = s.roomId === roomId || s.roomId === null || roomId === null;
          return inRange && sameRoom;
        });
        if (match) {
          // Overlap detected! Rollback deletion of old rules by restoring them
          await prisma.peakSeasonRate.updateMany({
            where: { propertyId, name: oldName, deletedAt: { not: null } },
            data: { deletedAt: null }
          });
          return res.status(400).json({ 
            error: `Overlapping rule detected! Date ${dateStr} is already covered by "${match.name}".` 
          });
        }
      }

      // Overlap passed! Old records soft deleted can be safely left deleted, and we create the new records
      const recordsToCreate = [];
      const cleanRoomId = (roomId === '' || roomId === 'all' || roomId === 'null' || !roomId) ? null : roomId;

      if (applyMode === 'MULTIPLE') {
        for (const dateStr of datesToCheck) {
          recordsToCreate.push({
            name,
            propertyId,
            roomId: cleanRoomId,
            startDate: dateStr,
            endDate: dateStr,
            rateMultiplier: Number(rateMultiplier),
            adjustmentType: adjustmentType || 'PERCENTAGE_INCREASE',
            adjustmentValue: Number(adjustmentValue),
            isActive: isActive !== false
          });
        }
      } else {
        recordsToCreate.push({
          name,
          propertyId,
          roomId: cleanRoomId,
          startDate,
          endDate,
          rateMultiplier: Number(rateMultiplier),
          adjustmentType: adjustmentType || 'PERCENTAGE_INCREASE',
          adjustmentValue: Number(adjustmentValue),
          isActive: isActive !== false
        });
      }

      await prisma.peakSeasonRate.createMany({
        data: recordsToCreate
      });

      if (isClosed) {
        const roomsToBlock = cleanRoomId ? [{ id: cleanRoomId }] : await prisma.room.findMany({ where: { propertyId, deletedAt: null } });
        for (const r of roomsToBlock) {
          await propertyRepository.bulkUpdateAvailability(r.id, datesToCheck, true);
        }
      }

      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      AuditService.log(
        req.userId,
        user ? user.name : 'Host',
        'UPDATE_PEAK_SEASON',
        'PEAK_SEASON',
        `Updated peak season rule "${oldName}" to "${name}" successfully.`
      );

      res.json({ success: true, message: 'Rule updated successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/properties/:propertyId/peak-seasons/:name/toggle', requireAuth as any, async (req: any, res) => {
    try {
      const tenantId = req.userId;
      const { propertyId, name } = req.params;
      const { isActive } = req.body;

      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return res.status(404).json({ error: 'Property not found.' });
      if (property.tenantId !== tenantId && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Access denied.' });
      }

      await prisma.peakSeasonRate.updateMany({
        where: { propertyId, name, deletedAt: null },
        data: { isActive: !!isActive }
      });

      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      AuditService.log(
        req.userId,
        user ? user.name : 'Host',
        'TOGGLE_PEAK_SEASON',
        'PEAK_SEASON',
        `Toggled peak season rule "${name}" status to ${isActive ? 'ACTIVE' : 'INACTIVE'}.`
      );

      res.json({ success: true, message: 'Status updated successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/properties/:propertyId/peak-seasons/:name', requireAuth as any, async (req: any, res) => {
    try {
      const tenantId = req.userId;
      const { propertyId, name } = req.params;

      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return res.status(404).json({ error: 'Property not found.' });
      if (property.tenantId !== tenantId && req.userRole !== 'ADMIN') {
        return res.status(403).json({ error: 'Access denied.' });
      }

      await prisma.peakSeasonRate.updateMany({
        where: { propertyId, name, deletedAt: null },
        data: { deletedAt: new Date() }
      });

      const user = await prisma.user.findUnique({ where: { id: req.userId } });
      AuditService.log(
        req.userId,
        user ? user.name : 'Host',
        'DELETE_PEAK_SEASON',
        'PEAK_SEASON',
        `Deleted peak season rule "${name}".`
      );

      res.json({ success: true, message: 'Peak season rule deleted (soft delete).' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Favorites API
  app.get('/api/favorites', requireAuth as any, (req, res) => favoriteController.getFavorites(req, res));
  app.get('/api/favorites/count', requireAuth as any, (req, res) => favoriteController.getFavoritesCount(req, res));
  app.post('/api/favorites/toggle', requireAuth as any, (req, res) => favoriteController.toggleFavorite(req, res));

  app.get('/api/categories', async (req, res) => {
    try {
      const categories = await prisma.propertyCategory.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' }
      });
      res.json({ categories });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API - Booking routes
  app.post('/api/bookings', requireAuth as any, IdempotencyMiddleware as any, DuplicateSubmissionGuard as any, RequestGuard('booking_create', (req) => req.body.propertyId + '_' + req.body.startDate) as any, (req, res) => bookingController.createBooking(req, res));
  app.post('/api/bookings/:id/payment', requireAuth as any, IdempotencyMiddleware as any, DuplicateSubmissionGuard as any, RequestGuard('payment_upload', (req) => req.params.id) as any, (req, res) => bookingController.uploadPaymentProof(req, res));
  app.put('/api/bookings/:id/status', requireAuth as any, (req, res) => bookingController.updateStatus(req, res));
  app.post('/api/bookings/:id/check-in', requireAuth as any, (req, res) => bookingController.checkIn(req, res));
  app.post('/api/bookings/:id/check-out', requireAuth as any, (req, res) => bookingController.checkOut(req, res));
  app.get('/api/bookings/code/:code', requireAuth as any, (req, res) => bookingController.getBookingByCode(req, res));
  app.get('/api/bookings/:id', requireAuth as any, (req, res) => bookingController.getBooking(req, res));
  app.get('/api/bookings', requireAuth as any, (req, res) => bookingController.listBookings(req, res));
  app.get('/api/reports', requireAuth as any, (req, res) => bookingController.getReports(req, res));
  app.get('/api/reports/export', requireAuth as any, (req, res) => bookingController.exportReport(req, res));

  // Housekeeping APIs
  app.get('/api/housekeeping', requireAuth as any, async (req, res) => {
    const startTime = Date.now();
    try {
      const tenantId = req.userRole === 'TENANT' ? req.userId : undefined;
      const tasks = await getHousekeepingTasks(tenantId);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PERF] GET /api/housekeeping took ${Date.now() - startTime}ms`);
      }
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.put('/api/housekeeping/:roomId', requireAuth as any, async (req, res) => {
    const startTime = Date.now();
    try {
      const { roomId } = req.params;
      const { status, assignedTo, checklist } = req.body;
      const task = await updateHousekeepingTask(roomId, { status, assignedTo, checklist });
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PERF] PUT /api/housekeeping/${roomId} took ${Date.now() - startTime}ms`);
      }
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Maintenance APIs
  app.get('/api/maintenance', requireAuth as any, async (req, res) => {
    const startTime = Date.now();
    try {
      const tenantId = req.userRole === 'TENANT' ? req.userId : undefined;
      const requests = await getMaintenanceRequests(tenantId);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PERF] GET /api/maintenance took ${Date.now() - startTime}ms`);
      }
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.post('/api/maintenance', requireAuth as any, async (req, res) => {
    const startTime = Date.now();
    try {
      const { title, propertyName, roomNameName, priority, status } = req.body;
      const request = await createMaintenanceRequest({ title, propertyName, roomNameName, priority, status });
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PERF] POST /api/maintenance took ${Date.now() - startTime}ms`);
      }
      res.json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  app.put('/api/maintenance/:id/status', requireAuth as any, async (req, res) => {
    const startTime = Date.now();
    try {
      const { id } = req.params;
      const { status } = req.body;
      const request = await updateMaintenanceStatus(id, status);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[PERF] PUT /api/maintenance/${id}/status took ${Date.now() - startTime}ms`);
      }
      res.json(request);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // Serve production client build statically if present
  if (process.env.NODE_ENV === 'production') {
    const possibleDistPaths = [
      path.join(process.cwd(), 'frontend/dist'),
      path.join(process.cwd(), 'dist'),
      path.resolve(__dirname, '../../frontend/dist'),
      path.resolve(__dirname, '../frontend/dist')
    ];

    let distPath = '';
    for (const p of possibleDistPaths) {
      if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
        distPath = p;
        break;
      }
    }

    if (distPath) {
      console.log(`[ViteIntegration] Serving production static files from: ${distPath}`);
      app.use(express.static(distPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.warn('[ViteIntegration] dist/ build folder not found. Running solely as standalone API.');
    }
  }

  // 404 Handler for APIs
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'NotFound', message: `Cannot ${req.method} ${req.path}` });
  });

  // Global Error Handler (Production-safe, stack-trace protected)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[Error] ${req.method} ${req.path}:`, err);
    const status = err.status || err.statusCode || 500;
    const isProduction = process.env.NODE_ENV === 'production';
    
    res.status(status).json({
      error: err.name || 'InternalServerError',
      message: isProduction ? 'An unexpected error occurred. Please try again later.' : (err.message || 'Unknown network error'),
      ...(isProduction ? {} : { stack: err.stack })
    });
  });

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
export {};
