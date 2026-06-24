import { PrismaClient, Role, RoomStatus } from '@prisma/client';

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

const prisma = new PrismaClient();

const PROPERTIES_DATA = [
  {
    name: "Villa Ubud Serenity",
    slug: "villa-ubud-serenity",
    location: "Ubud, Bali",
    city: "Ubud",
    province: "Bali",
    address: "Jalan Raya Sanggingan No. 8",
    latitude: -8.5069,
    longitude: 115.2625,
    basePrice: 1850000,
    categoryName: "Villas",
    categorySlug: "villas",
    description: "Nikmati kemewahan dan ketenangan sejati di tengah sawah hijau Ubud. Villa Ubud Serenity menawarkan kolam renang pribadi, desain arsitektur tropis modern, dan lingkungan yang asri serta damai, cocok untuk relaksasi total.",
    amenities: ["WiFi", "Swimming Pool", "Air Conditioning", "Breakfast Included", "Kitchen", "Smart TV", "Workspace"],
    images: [
      { url: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1583037189850-1921ae7c6c22?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Garden View Villa", type: "Standard", capacity: 2, price: 1850000, wing: "Main Area", floor: "1" },
      { name: "Private Pool Sanctuary", type: "Deluxe", capacity: 2, price: 2450000, wing: "West Wing", floor: "1" }
    ]
  },
  {
    name: "Hotel Malioboro Heritage",
    slug: "hotel-malioboro-heritage",
    location: "Yogyakarta",
    city: "Yogyakarta",
    province: "D.I. Yogyakarta",
    address: "Jalan Malioboro No. 25",
    latitude: -7.7956,
    longitude: 110.3695,
    basePrice: 850000,
    categoryName: "Hotels",
    categorySlug: "hotels",
    description: "Menginap di jantung kebudayaan Yogyakarta dengan nuansa kolonial yang elegan. Hotel Malioboro Heritage menggabungkan kenyamanan modern dengan arsitektur klasik Jawa yang menawan, hanya beberapa langkah dari Jalan Malioboro.",
    amenities: ["WiFi", "Air Conditioning", "Parking", "Restaurant", "Breakfast Included", "Smart TV", "Workspace"],
    images: [
      { url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Superior Heritage Room", type: "Standard", capacity: 2, price: 850000, wing: "East Block", floor: "2" },
      { name: "Executive Sultan Suite", type: "Executive Suite", capacity: 4, price: 1450000, wing: "Royal Wing", floor: "3" }
    ]
  },
  {
    name: "Jakarta Skyline Residence",
    slug: "jakarta-skyline-residence",
    location: "Jakarta Selatan",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
    address: "Jalan Jendral Sudirman Kav. 52-53",
    latitude: -6.2297,
    longitude: 106.8294,
    basePrice: 1250000,
    categoryName: "Apartments",
    categorySlug: "apartments",
    description: "Hunian modern vertikal bergaya urban mewah di kawasan bisnis Jakarta Selatan. Nikmati panorama gedung pencakar langit yang spektakuler langsung dari jendela kamar Anda, dilengkapi fasilitas setara hotel bintang lima.",
    amenities: ["WiFi", "Air Conditioning", "Swimming Pool", "Gym", "Smart TV", "Workspace", "Kitchen"],
    images: [
      { url: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "1-Bedroom Executive", type: "Deluxe", capacity: 2, price: 1250000, wing: "Tower A", floor: "24" },
      { name: "2-Bedroom Grand Suite", type: "Family Room", capacity: 4, price: 1950000, wing: "Tower B", floor: "32" }
    ]
  },
  {
    name: "Villa Puncak Green Valley",
    slug: "villa-puncak-green-valley",
    location: "Puncak, Bogor",
    city: "Bogor",
    province: "Jawa Barat",
    address: "Jalan Raya Puncak Km. 84",
    latitude: -6.7024,
    longitude: 106.9892,
    basePrice: 1500000,
    categoryName: "Villas",
    categorySlug: "villas",
    description: "Villa keluarga yang nyaman dengan pemandangan pegunungan dan kebun teh yang indah di Puncak. Memiliki udara pegunungan yang sangat sejuk, kolam renang outdoor, area bermain anak, dan fasilitas BBQ lengkap untuk liburan keluarga Anda.",
    amenities: ["WiFi", "Swimming Pool", "Mountain View", "Parking", "Kitchen", "Playground", "BBQ Grill"],
    images: [
      { url: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Valley Breeze Cabin", type: "Standard", capacity: 4, price: 1500000, wing: "East Side", floor: "1" },
      { name: "Green Panorama Suite", type: "Executive Suite", capacity: 6, price: 2200000, wing: "Main Cabin", floor: "2" }
    ]
  },
  {
    name: "Bandung Art Deco Suites",
    slug: "bandung-art-deco-suites",
    location: "Bandung",
    city: "Bandung",
    province: "Jawa Barat",
    address: "Jalan Ciumbuleuit No. 152",
    latitude: -6.8732,
    longitude: 107.6158,
    basePrice: 950000,
    categoryName: "Apartments",
    categorySlug: "apartments",
    description: "Apartemen butik nan mewah beraksen Art Deco klasik di daerah perbukitan Ciumbuleuit, Bandung. Menyajikan kesejukan khas kota kembang serta pemandangan perbukitan hijau dan lampu-lampu kota yang romantis di malam hari.",
    amenities: ["WiFi", "Air Conditioning", "Swimming Pool", "Smart TV", "Workspace", "Breakfast Included"],
    images: [
      { url: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1502005229762-fc1b2d812cae?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Art Deco Studio", type: "Standard", capacity: 2, price: 950000, wing: "Siena", floor: "7" },
      { name: "Grand Art Deco Suite", type: "Deluxe", capacity: 3, price: 1350000, wing: "Venice", floor: "12" }
    ]
  },
  {
    name: "Lombok Ocean Escape",
    slug: "lombok-ocean-escape",
    location: "Senggigi, Lombok",
    city: "Lombok Barat",
    province: "Nusa Tenggara Barat",
    address: "Jalan Raya Senggigi Km. 8",
    latitude: -8.5042,
    longitude: 116.0375,
    basePrice: 1700000,
    categoryName: "Guest Houses",
    categorySlug: "guest-houses",
    description: "Sambut pagi hari Anda langsung dengan suara deburan ombak dan angin pantai Senggigi yang menenangkan. Lombok Ocean Escape menawarkan bungalo tepi pantai tradisional dengan fasilitas premium bernuansa tropis alami.",
    amenities: ["WiFi", "Air Conditioning", "Ocean View", "Swimming Pool", "Restaurant", "Breakfast Included", "Beach Access"],
    images: [
      { url: "https://images.unsplash.com/photo-1544644181-1484b3fdfc62?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Beachfront Bungalow", type: "Deluxe", capacity: 2, price: 1700000, wing: "North Shore", floor: "1" },
      { name: "Ocean Panorama Villa", type: "Garden Villa", capacity: 4, price: 2600055, wing: "South Shore", floor: "1" }
    ]
  },
  {
    name: "Labuan Bajo Sunset Villa",
    slug: "labuan-bajo-sunset-villa",
    location: "Labuan Bajo",
    city: "Manggarai Barat",
    province: "Nusa Tenggara Timur",
    address: "Jalan Pantai Pede No. 88",
    latitude: -8.4907,
    longitude: 119.8827,
    basePrice: 2250000,
    categoryName: "Villas",
    categorySlug: "villas",
    description: "Saksikan pemandangan matahari terbenam terbaik di dunia langsung dari teras infinity pool Anda di Labuan Bajo. Didesain secara eksklusif dengan menggabungkan kemewahan arsitektur modern dan keasrian alam Flores.",
    amenities: ["WiFi", "Air Conditioning", "Swimming Pool", "Ocean View", "Restaurant", "Smart TV", "Breakfast Included"],
    images: [
      { url: "https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Sunset Vista Suite", type: "Ocean View Suite", capacity: 2, price: 2250000, wing: "Main Resort", floor: "1" },
      { name: "Orion Pavilion", type: "Garden Villa", capacity: 4, price: 3250000, wing: "Cliffside", floor: "1" }
    ]
  },
  {
    name: "Surabaya Business Residence",
    slug: "surabaya-business-residence",
    location: "Surabaya",
    city: "Surabaya",
    province: "Jawa Timur",
    address: "Jalan Embong Malang No. 85-89",
    latitude: -7.2575,
    longitude: 112.7521,
    basePrice: 775000,
    categoryName: "Apartments",
    categorySlug: "apartments",
    description: "Sempurnakan perjalanan bisnis atau rekreasi Anda di pusat kota Surabaya. Menawarkan apartemen modern minimalis yang fungsional dengan kemudahan akses langsung ke area mall, perkantoran, dan kuliner terkenal.",
    amenities: ["WiFi", "Air Conditioning", "Parking", "Smart TV", "Workspace", "Gym"],
    images: [
      { url: "https://images.unsplash.com/photo-1502672265212-94b7be8b7e1?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1536376072261-38c75010e6c9?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Cosmopolitan Twin", type: "Standard", capacity: 2, price: 775000, wing: "Tower North", floor: "10" },
      { name: "Executive Suite Surabaya", type: "Executive Suite", capacity: 3, price: 1150000, wing: "Tower North", floor: "15" }
    ]
  },
  {
    name: "Bromo Mountain Cabin",
    slug: "bromo-mountain-cabin",
    location: "Probolinggo, Jawa Timur",
    city: "Probolinggo",
    province: "Jawa Timur",
    address: "Jalan Raya Bromo Suka Makmur",
    latitude: -7.9403,
    longitude: 112.9519,
    basePrice: 1150000,
    categoryName: "Cabins",
    categorySlug: "cabins",
    description: "Kabun kayu yang hangat dan otentik di lereng Gunung Bromo. Tempat yang tepat untuk beristirahat menjelang petualangan berburu matahari terbit Bromo yang melegenda, sembari ditemani udara dingin yang menenangkan jiwa.",
    amenities: ["WiFi", "Mountain View", "Parking", "Breakfast Included", "Warm Heating", "Water Heater", "Workspace"],
    images: [
      { url: "https://images.unsplash.com/photo-1475855581690-80accde3ae2b?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1470246973918-29a93221c455?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Rustic Timber Cabin", type: "Standard", capacity: 2, price: 1150000, wing: "Alpine Row", floor: "1" },
      { name: "Premium Bromo Lookout", type: "Deluxe", capacity: 4, price: 1650000, wing: "Ridge Row", floor: "1" }
    ]
  },
  {
    name: "Raja Ampat Paradise Lodge",
    slug: "raja-ampat-paradise-lodge",
    location: "Raja Ampat, Papua Barat",
    city: "Raja Ampat",
    province: "Papua Barat Daya",
    address: "Pulau Mansuar, Selat Dampier",
    latitude: -0.2372,
    longitude: 130.6552,
    basePrice: 2950000,
    categoryName: "Guest Houses",
    categorySlug: "guest-houses",
    description: "Surga bawah air dan penginapan mengapung terapung yang eksotis di Raja Ampat. Langsung melompat ke air laut kristal biru berkiloan penuh dengan terumbu karang hidup dan ikan hias berwarna-warni tepat di depan kamar tidur Anda.",
    amenities: ["WiFi", "Ocean View", "Restaurant", "Breakfast Included", "Snorkeling Gear", "Beach Access", "Tour Assistance"],
    images: [
      { url: "https://images.unsplash.com/photo-1439066615861-d1af74d74000?auto=format&fit=crop&w=800&q=80", isCover: true },
      { url: "https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=800&q=80", isCover: false },
      { url: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=800&q=80", isCover: false }
    ],
    rooms: [
      { name: "Floating Overwater Suite", type: "Ocean View Suite", capacity: 2, price: 2950000, wing: "Overwater Dock A", floor: "1" },
      { name: "Presidential Reef Sanctuary", type: "Garden Villa", capacity: 4, price: 4250000, wing: "Overwater Dock B", floor: "1" }
    ]
  }
];

async function main() {
  console.log('--- Seeding Indonesian Properties Starting ---');

  // Let's find a TENANT user to assign these properties to
  let tenant = await prisma.user.findFirst({
    where: { role: Role.TENANT, deletedAt: null }
  });

  if (!tenant) {
    console.log('No TENANT role user found. Let us check ANY user or create one.');
    // Check if any user exists
    const anyUser = await prisma.user.findFirst({
      where: { deletedAt: null }
    });
    if (anyUser) {
      tenant = anyUser;
      console.log(`Assigning to user: ${tenant.email} (updated temporarily if needed)`);
      await prisma.user.update({
        where: { id: tenant.id },
        data: { role: Role.TENANT }
      });
    } else {
      console.log('Creating a new default tenant user...');
      tenant = await prisma.user.create({
        data: {
          email: 'tenant@stayease.com',
          name: 'Budi Santoso',
          role: Role.TENANT,
          isVerified: true,
          password: 'stayeasepassword'
        }
      });
    }
  }

  console.log(`Using TENANT landlord ID: ${tenant.id} (${tenant.name})`);

  let propertiesCreated = 0;
  let roomsCreated = 0;
  let imagesCreated = 0;
  const validationErrors: string[] = [];

  for (const item of PROPERTIES_DATA) {
    try {
      // 1. Check if property already exists
      const existingProperty = await prisma.property.findUnique({
        where: { slug: item.slug }
      });

      if (existingProperty) {
        console.log(`Property with slug "${item.slug}" already exists. Skipping.`);
        continue;
      }

      // 2. Ensure Category exists
      let category = await prisma.propertyCategory.findUnique({
        where: { slug: item.categorySlug }
      });

      if (!category) {
        console.log(`Category "${item.categoryName}" does not exist. Creating...`);
        category = await prisma.propertyCategory.create({
          data: {
            name: item.categoryName,
            slug: item.categorySlug,
            description: `Koleksi properti tipe ${item.categoryName}`
          }
        });
      }

      // 3. Create the Property
      const createdProperty = await prisma.property.create({
        data: {
          name: item.name,
          slug: item.slug,
          location: item.location,
          city: item.city,
          province: item.province,
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
          description: item.description,
          categoryId: category.id,
          tenantId: tenant.id,
          beds: item.rooms.reduce((max, r) => Math.max(max, r.capacity), 2),
          baths: 1.5,
          sqft: 1200,
          basePrice: item.basePrice,
          rating: 5.0,
          reviewCount: 0,
          imageUrls: item.images.map(img => img.url),
          amenities: item.amenities,
          status: "ACTIVE"
        }
      });

      propertiesCreated++;
      console.log(`✔ Created Property: ${item.name}`);

      // 4. Create Property Images (separate table records)
      for (const image of item.images) {
        await prisma.propertyImage.create({
          data: {
            propertyId: createdProperty.id,
            url: image.url,
            isCover: image.isCover
          }
        });
        imagesCreated++;
      }

      // 5. Create Rooms and Availability Calendars
      for (const rx of item.rooms) {
        const createdRoom = await prisma.room.create({
          data: {
            propertyId: createdProperty.id,
            name: rx.name,
            type: rx.type,
            capacity: rx.capacity,
            basePrice: rx.price,
            status: RoomStatus.AVAILABLE,
            wing: rx.wing,
            floor: rx.floor,
            image: item.images[0].url
          }
        });

        roomsCreated++;

        // 6. Availability Calendar for next 14 days
        const availabilities = [];
        for (let day = 0; day < 14; day++) {
          const d = new Date();
          d.setDate(d.getDate() + day);
          availabilities.push({
            roomId: createdRoom.id,
            date: d.toISOString().split('T')[0],
            isBlocked: false,
            priceOverride: null
          });
        }

        await prisma.roomAvailability.createMany({
          data: availabilities
        });
      }

    } catch (err: any) {
      console.error(`Error processing property "${item.name}":`, err);
      validationErrors.push(`${item.name}: ${err.message || err}`);
    }
  }

  console.log('\n--- Seeding Indonesian Properties Summarized Result ---');
  console.log(`Total Properties Created: ${propertiesCreated}`);
  console.log(`Total Rooms Created: ${roomsCreated}`);
  console.log(`Total Images Created: ${imagesCreated}`);
  console.log(`Validation Errors count: ${validationErrors.length}`);
  if (validationErrors.length > 0) {
    console.log('Errors:', validationErrors);
  }
}

main()
  .catch(err => {
    console.error('Fatal seeding error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
