import dotenv from 'dotenv';
dotenv.config();

const rawDbUrl = process.env.DATABASE_URL || '';
const rawDirectUrl = process.env.DIRECT_URL || '';

function cleanUrl(url: string): string {
  let cleaned = url.trim();
  if (cleaned.startsWith('DATABASE_URL=')) {
    cleaned = cleaned.substring('DATABASE_URL='.length);
  }
  if (cleaned.startsWith('DIRECT_URL=')) {
    cleaned = cleaned.substring('DIRECT_URL='.length);
  }
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  return cleaned;
}

const dbUrl = cleanUrl(rawDbUrl);
const directUrl = cleanUrl(rawDirectUrl);

process.env.DATABASE_URL = dbUrl;
if (directUrl) {
  process.env.DIRECT_URL = directUrl;
}

import { PrismaClient, Role, RoomStatus, BookingStatus, PricingAdjustmentType } from '@prisma/client';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { 
  SEED_CATEGORIES, DESCRIPTOR_ADJECTIVES, DESCRIPTOR_NOUNS, 
  INDONESIAN_CITIES, AMENITIES_POOL, ROOM_TYPES, STOCK_IMAGES, GUEST_REVIEWS 
} from './seedData';

const prisma = new PrismaClient();

async function main() {
  console.log('--- StayEase Clear Database Seeding Started (UUID OPTIMIZED) ---');
  
  // 1. Truncate existing data
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User", "TenantProfile", "PropertyCategory", "Property", "Room", "RoomAvailability", "PeakSeasonRate", "Booking", "PaymentProof", "Review", "Notification", "EmailVerification", "PasswordReset" CASCADE;`);

  // Generate generic password hash using bcryptjs
  const hashedPassword = await bcrypt.hash('stayease123', 10);

  // Define UUID Mappings to replace and remove manual IDs
  const userUuidMap = new Map<string, string>();
  for (let i = 1; i <= 10; i++) {
    userUuidMap.set(`u-${i}`, randomUUID());
  }

  const tenantUuidMap = new Map<string, string>();
  for (let i = 1; i <= 5; i++) {
    tenantUuidMap.set(`t-${i}`, randomUUID());
  }

  const catUuidMap = new Map<string, string>();
  SEED_CATEGORIES.forEach(cat => {
    catUuidMap.set(cat.id, randomUUID());
  });

  const propertyUuidMap = new Map<string, string>();
  for (let i = 1; i <= 30; i++) {
    propertyUuidMap.set(`prop-${i}`, randomUUID());
  }

  const peakRatesUuidMap = new Map<string, string>();
  for (let i = 1; i <= 30; i++) {
    peakRatesUuidMap.set(`rate-${i}`, randomUUID());
  }

  const roomUuidMap = new Map<string, string>();
  let rIdx = 1;
  for (let i = 1; i <= 30; i++) {
    for (let r = 1; r <= 3; r++) {
      roomUuidMap.set(`room-${rIdx}`, randomUUID());
      rIdx++;
    }
  }

  const bookingUuidMap = new Map<string, string>();
  for (let b = 1; b <= 50; b++) {
    bookingUuidMap.set(`bk-${b}`, randomUUID());
  }

  // 2. Prepare Users and Tenant Profiles
  const usersData = [];
  const tenantsData = [];
  
  for (let i = 1; i <= 10; i++) {
    const isTenant = i <= 5;
    const role = isTenant ? Role.TENANT : Role.USER;
    const userId = userUuidMap.get(`u-${i}`)!;
    usersData.push({
      id: userId,
      email: i === 1 ? 'tenant@stayease.com' : (i === 6 ? 'host@stayease.com' : `user${i}@stayease.com`),
      name: i === 1 ? 'Budi Santoso' : (i === 6 ? 'Alex Rivera' : `Indo Guest ${i}`),
      password: hashedPassword,
      role,
      isVerified: true,
      avatarUrl: null
    });

    if (isTenant) {
      tenantsData.push({
        id: tenantUuidMap.get(`t-${i}`)!,
        userId: userId,
        companyName: `Mitra StayEase Group ${i}`,
        phoneNumber: `+628120000${i}`,
        bankName: 'Bank Mandiri',
        bankAccount: `5820001${i}`,
        isVerified: true
      });
    }
  }

  await prisma.user.createMany({ data: usersData });
  await prisma.tenantProfile.createMany({ data: tenantsData });
  console.log('✔ Users and Tenant Profiles seeded');

  // 3. Populate Categories
  const categoriesData = SEED_CATEGORIES.map(cat => ({
    id: catUuidMap.get(cat.id)!,
    name: cat.name,
    slug: cat.slug,
    description: cat.description
  }));
  await prisma.propertyCategory.createMany({ data: categoriesData });
  console.log('✔ Property Categories seeded');

  // 4. Populate Properties & Peak Season Rates
  const propertiesData = [];
  const peakRatesData = [];

  const toSlug = (name: string) => {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  for (let i = 1; i <= 30; i++) {
    const cat = SEED_CATEGORIES[(i - 1) % SEED_CATEGORIES.length];
    const tenantId = userUuidMap.get(`u-${((i - 1) % 5) + 1}`)!;
    const city = INDONESIAN_CITIES[(i - 1) % INDONESIAN_CITIES.length];
    
    const adjIdx = (i - 1) % DESCRIPTOR_ADJECTIVES.length;
    const nounIdx = Math.floor((i - 1) / DESCRIPTOR_ADJECTIVES.length) % DESCRIPTOR_NOUNS.length;
    const title = `${DESCRIPTOR_ADJECTIVES[adjIdx]} ${DESCRIPTOR_NOUNS[nounIdx]}`;
    const slug = toSlug(title);
    const propId = propertyUuidMap.get(`prop-${i}`)!;

    propertiesData.push({
      id: propId,
      slug: slug,
      name: title,
      location: `${city.city}, ${city.province}`,
      city: city.city,
      province: city.province,
      address: `Jalan Raya No. ${i * 4}`,
      latitude: city.lat + i * 0.001,
      longitude: city.lng + i * 0.0015,
      description: `Experience the elegant comfort of ${title} situated inside beautiful ${city.city}.`,
      categoryId: catUuidMap.get(cat.id)!,
      tenantId: tenantId,
      beds: 1 + (i % 4),
      baths: 1 + (i % 3),
      sqft: 400 + (i % 5) * 200,
      basePrice: 200 + (i * 40) % 900,
      imageUrls: [STOCK_IMAGES[(i - 1) % STOCK_IMAGES.length]],
      amenities: [AMENITIES_POOL[(i - 1) % AMENITIES_POOL.length], 'High-Speed Wifi', 'AC', 'Breakfast']
    });

    peakRatesData.push({
      id: peakRatesUuidMap.get(`rate-${i}`)!,
      propertyId: propId,
      name: 'Holiday Season Boost',
      startDate: '2026-12-20',
      endDate: '2027-01-05',
      rateMultiplier: 1.35,
      adjustmentType: PricingAdjustmentType.PERCENTAGE_INCREASE,
      adjustmentValue: 1.35
    });
  }

  await prisma.property.createMany({ data: propertiesData });
  await prisma.peakSeasonRate.createMany({ data: peakRatesData });
  console.log('✔ Properties and Peak Season Rates seeded');

  // 5. Populate Rooms and Room Availabilities
  const roomsData = [];
  const availabilitiesData = [];
  let idx = 1;

  for (let i = 1; i <= 30; i++) {
    for (let r = 1; r <= 3; r++) {
      const rType = ROOM_TYPES[(idx - 1) % ROOM_TYPES.length];
      const basePrice = propertiesData[i - 1].basePrice;
      const price = Math.round((basePrice + (idx * 15) % 120) * rType.baseMultiplier);
      const roomId = roomUuidMap.get(`room-${idx}`)!;

      roomsData.push({
        id: roomId,
        propertyId: propertyUuidMap.get(`prop-${i}`)!,
        name: `${rType.name} Room ${100 + r}`,
        type: rType.name,
        capacity: rType.capacity,
        basePrice: price,
        status: RoomStatus.AVAILABLE,
        wing: `Wing A`,
        floor: `Floor ${(idx % 3) + 1}`,
        image: STOCK_IMAGES[(idx - 1) % STOCK_IMAGES.length]
      });

      for (let day = 0; day < 7; day++) {
        const d = new Date();
        d.setDate(d.getDate() + day);
        availabilitiesData.push({
          id: randomUUID(),
          roomId: roomId,
          date: d.toISOString().split('T')[0],
          isBlocked: day === 3 && idx % 5 === 0,
          priceOverride: day === 5 ? Math.round(price * 1.2) : null
        });
      }
      idx++;
    }
  }

  await prisma.room.createMany({ data: roomsData });
  await prisma.roomAvailability.createMany({ data: availabilitiesData });
  console.log('✔ Rooms and Room Availabilities seeded');

  // 6. Populate Bookings, Payment Proofs and Reviews
  const bookingStatuses = [
    BookingStatus.WAITING_PAYMENT, BookingStatus.WAITING_CONFIRMATION,
    BookingStatus.CONFIRMED, BookingStatus.COMPLETED,
    BookingStatus.CANCELLED, BookingStatus.AUTO_EXPIRED
  ];

  const bookingsData = [];
  const proofsData = [];
  const reviewsData = [];

  let proofsCount = 0;
  let reviewsCount = 0;

  for (let b = 1; b <= 50; b++) {
    const guestIdx = 5 + (b % 5); // Index 5 to 9 (coincides with user u-6 to u-10)
    const guestId = userUuidMap.get(`u-${guestIdx + 1}`)!;
    const roomIdx = ((b - 1) % roomsData.length) + 1;
    const room = roomsData[roomIdx - 1];
    const status = bookingStatuses[b % bookingStatuses.length];
    const bId = bookingUuidMap.get(`bk-${b}`)!;
    
    const start = new Date();
    start.setDate(start.getDate() + (b % 15) - 5);
    const end = new Date(start);
    end.setDate(end.getDate() + 2);

    bookingsData.push({
      id: bId,
      bookingCode: `BK-SE-${2000 + b}`,
      guestId,
      propertyId: room.propertyId,
      roomId: room.id,
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
      nights: 2,
      totalAmount: Number(room.basePrice) * 2,
      status,
      guestName: usersData[guestIdx].name,
      guestEmail: usersData[guestIdx].email,
      guestPhone: `+62812903820${b}`
    });

    const needsProof = status === BookingStatus.CONFIRMED || status === BookingStatus.COMPLETED || status === BookingStatus.WAITING_CONFIRMATION;
    if (needsProof && proofsCount < 20) {
      proofsData.push({
        id: randomUUID(),
        bookingId: bId,
        proofUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?auto=format&fit=crop&w=400&q=80'
      });
      proofsCount++;
    }

    const canReview = status === BookingStatus.COMPLETED || status === BookingStatus.CONFIRMED;
    if (canReview && reviewsCount < 25) {
      reviewsData.push({
        id: randomUUID(),
        propertyId: room.propertyId,
        guestId,
        bookingId: bId,
        guestName: usersData[guestIdx].name,
        guestAvatar: usersData[guestIdx].avatarUrl,
        rating: 4 + (b % 2),
        comment: GUEST_REVIEWS[b % GUEST_REVIEWS.length]
      });
      reviewsCount++;
    }
  }

  await prisma.booking.createMany({ data: bookingsData });
  await prisma.paymentProof.createMany({ data: proofsData });
  await prisma.review.createMany({ data: reviewsData });
  console.log('✔ Bookings, Payment Proofs, and Guest Reviews seeded');

  console.log('--- StayEase Database Seeding Successfully Completed ---');
}

main()
  .catch(e => {
    console.error('Seeding process failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
