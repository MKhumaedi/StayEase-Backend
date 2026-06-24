import { Property, Room, Review, Booking, User, UserRole, BookingStatus } from '../../../frontend/src/types';

export const SEED_USERS: User[] = [
  {
    id: 'u1',
    email: 'tenant@stayease.com',
    name: 'Johnathan Doe',
    role: UserRole.TENANT,
    isVerified: true,
    avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80',
    loyaltyPoints: 12450,
    credits: 842.00
  },
  {
    id: 'u2',
    email: 'host@stayease.com',
    name: 'Alex Rivera',
    role: UserRole.TENANT,
    isVerified: true,
    avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=100&q=80'
  },
  {
    id: 'u3',
    email: 'tenant2@stayease.com',
    name: 'Manager StayEase',
    role: UserRole.TENANT,
    isVerified: true,
    avatarUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=100&q=80'
  }
];

export const SEED_PROPERTIES: Property[] = [
  {
    id: 'prop-1',
    name: 'Azure Horizon Villa',
    slug: 'azure-horizon-villa',
    location: 'Jakarta, DKI Jakarta',
    city: 'Jakarta',
    province: 'DKI Jakarta',
    description: 'Discover a curated collection of high-luxury properties and executive suites. Designed for seamless living and effortless travel.',
    categoryId: 'cat-luxury',
    beds: 4,
    baths: 3,
    sqft: 3200,
    basePrice: 850,
    rating: 4.9,
    reviewCount: 124,
    imageUrls: ['https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=800&q=80'],
    amenities: ['Private Pool', 'Air Conditioning', 'Free WiFi', 'Gym & Wellness Studio', 'Ocean View'],
    status: 'ACTIVE'
  },
  {
    id: 'prop-2',
    name: 'Tuscan Retreat',
    slug: 'tuscan-retreat',
    location: 'Bandung, Jawa Barat',
    city: 'Bandung',
    province: 'Jawa Barat',
    description: 'Authentic stone villa in the heart of Tuscany with breathtaking vistas, infinity terrace, and curated classical architecture.',
    categoryId: 'cat-luxury',
    beds: 6,
    baths: 5,
    sqft: 4500,
    basePrice: 1200,
    rating: 4.8,
    reviewCount: 98,
    imageUrls: ['https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80'],
    amenities: ['Private Pool', 'Free WiFi', 'Climate-Controlled Wine Cellar', 'Pet Friendly'],
    status: 'ACTIVE'
  },
  {
    id: 'prop-3',
    name: 'The Summit Penthouse',
    slug: 'the-summit-penthouse',
    location: 'Surabaya, Jawa Timur',
    city: 'Surabaya',
    province: 'Jawa Timur',
    description: 'Grave in-city sky residence featuring floor-to-ceiling panoramic views of Manhattan skyscrapers and central park.',
    categoryId: 'cat-apartment',
    beds: 3,
    baths: 2,
    sqft: 2100,
    basePrice: 950,
    rating: 5.0,
    reviewCount: 312,
    imageUrls: ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80'],
    amenities: ['Free WiFi', 'Air Conditioning', 'Valet Parking Service', 'Gym & Wellness Studio'],
    status: 'ACTIVE'
  },
  {
    id: 'prop-4',
    name: 'Skyline Loft',
    slug: 'skyline-loft',
    location: 'Yogyakarta, DI Yogyakarta',
    city: 'Yogyakarta',
    province: 'DI Yogyakarta',
    description: 'This property is part of our vetted luxury collection. Fully loaded with smart amenities, premium designer finishes, and sweeping city landscapes.',
    categoryId: 'cat-apartment',
    beds: 4,
    baths: 3.5,
    sqft: 2800,
    basePrice: 1200,
    rating: 4.98,
    reviewCount: 124,
    imageUrls: [
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1556912172-45b7abe8b7e1?auto=format&fit=crop&w=200&h=150&q=80',
      'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=200&h=150&q=80',
      'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=200&h=150&q=80',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=200&h=150&q=80'
    ],
    amenities: ['Infinity Pool', 'Private Chef (Available on request)', 'Gym & Wellness Studio', 'Fiber-Optic WiFi', 'Climate-Controlled Wine Cellar', 'Valet Parking Service'],
    status: 'ACTIVE'
  }
];

export const SEED_ROOMS: Room[] = [
  {
    id: 'room-101',
    propertyId: 'prop-4',
    name: 'Suite 401',
    type: 'Master Suite',
    capacity: 2,
    basePrice: 450,
    status: 'Available',
    wing: 'North Wing',
    floor: 'Floor 4'
  },
  {
    id: 'room-102',
    propertyId: 'prop-4',
    name: 'Studio 204',
    type: 'Studio',
    capacity: 1,
    basePrice: 210,
    status: 'Occupied',
    wing: 'East Wing',
    floor: 'Floor 2'
  },
  {
    id: 'room-103',
    propertyId: 'prop-4',
    name: 'Deluxe 312',
    type: 'Deluxe Double',
    capacity: 4,
    basePrice: 345,
    status: 'Maintenance',
    wing: 'South Wing',
    floor: 'Floor 3'
  },
  {
    id: 'room-104',
    propertyId: 'prop-4',
    name: 'Suite 502',
    type: 'Executive Suite',
    capacity: 2,
    basePrice: 850,
    status: 'Available',
    wing: 'Penthouse Level',
    floor: 'Floor 5'
  }
];

export const SEED_REVIEWS: Review[] = [
  {
    id: 'rev-1',
    propertyId: 'prop-4',
    guestId: 'u1',
    guestName: 'Sarah Jenkins',
    guestAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&q=80',
    rating: 5,
    comment: 'The property exceeded all expectations. Julian was an incredible host, very communicative and the check-in process was seamless.',
    createdAt: '2026-05-12'
  },
  {
    id: 'rev-2',
    propertyId: 'prop-4',
    guestId: 'u2',
    guestName: 'Marcus Thorne',
    guestAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80',
    rating: 4,
    comment: 'Great location and very stylish space. The wifi was a bit spotty during the first day but Julian resolved it quickly.',
    createdAt: '2026-05-08',
    replyComment: 'Thanks for the feedback Marcus! Glad we could get the connectivity issues sorted. We’ve since upgraded our router to ensure 100% stability.',
    replyDate: '2026-05-09'
  }
];

export const SEED_BOOKINGS: Booking[] = [
  {
    id: 'bk-9021',
    bookingCode: 'BK-9021',
    guestId: 'u1',
    propertyId: 'prop-4',
    roomId: 'room-101',
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    nights: 3,
    totalAmount: 1240.00,
    status: BookingStatus.CONFIRMED,
    createdAt: '2026-06-11T05:00:00Z',
    guestName: 'John Doe',
    guestEmail: 'john.doe@example.com',
    guestPhone: '+1 123-456-7890',
    hasPaymentProof: true
  },
  {
    id: 'bk-4422',
    bookingCode: 'BK-4422',
    guestId: 'u4',
    propertyId: 'prop-1',
    startDate: '2026-10-14',
    endDate: '2026-10-20',
    nights: 6,
    totalAmount: 3500.00,
    status: BookingStatus.PENDING,
    createdAt: '2026-06-11T03:00:00Z',
    guestName: 'Sarah Miller',
    guestEmail: 'sarah.m@webmail.com',
    guestPhone: '+1 321-654-0987'
  }
];
