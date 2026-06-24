import { SEED_USERS, SEED_PROPERTIES, SEED_ROOMS, SEED_REVIEWS, SEED_BOOKINGS } from './seed';
import { User, Property, Room, Review, Booking, RoomAvailability, PeakSeasonRate, Notification, BookingStatus } from '../../../frontend/src/types';

class DbStore {
  users: User[] = [...SEED_USERS];
  properties: Property[] = [...SEED_PROPERTIES];
  rooms: Room[] = [...SEED_ROOMS];
  reviews: Review[] = [...SEED_REVIEWS];
  bookings: Booking[] = [...SEED_BOOKINGS];
  availabilities: RoomAvailability[] = [];
  peakRates: PeakSeasonRate[] = [];
  notifications: Notification[] = [];
  emailVerifications: { id: string; userId: string; token: string; expiresAt: Date }[] = [];
  passwordResets: { id: string; userId: string; token: string; expiresAt: Date }[] = [];

  constructor() {
    this.seedAvailabilitiesAndRates();
  }

  seedAvailabilitiesAndRates() {
    // Blocked dates and custom prices
    const dates = ['2026-12-01', '2026-12-02', '2026-12-08', '2026-12-11', '2026-12-22', '2026-12-29'];
    dates.forEach((d, idx) => {
      this.availabilities.push({
        id: `avail-${idx}`,
        roomId: 'room-101',
        date: d,
        isBlocked: idx % 3 === 0,
        priceOverride: idx % 2 === 0 ? 520 : undefined
      });
    });

    this.peakRates.push({
      id: 'rate-1',
      propertyId: 'prop-4',
      startDate: '2026-12-15',
      endDate: '2026-12-31',
      rateMultiplier: 1.5,
      name: 'Christmas Peak Season'
    });

    this.notifications.push({
      id: 'notif-1',
      title: 'New Booking Approved',
      message: 'Luxe Sky Suite - #BK-9021. 2 mins ago',
      type: 'booking',
      createdAt: '2026-06-11T07:34:00Z',
      read: false
    });
  }
}

export const db = new DbStore();
export { BookingStatus };
