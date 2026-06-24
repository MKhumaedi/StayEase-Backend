import { prisma } from '../../../database/prisma';
import { propertyRepository } from '../repositories/PropertyRepository';

export interface PricingBreakdown {
  nightlyRate: number;
  nights: number;
  subtotal: number;
  cleaningFee: number;
  serviceFee: number;
  tax: number;
  taxes: number;
  seasonalAdjustment: number;
  total: number;
  peakMultiplier?: number;
  peakSeasonName?: string | null;
  finalRoomPrice?: number;
}

export class PricingService {
  /**
   * Helper to list all dates between check-in (startDateStr) and check-out (endDateStr)
   * in YYYY-MM-DD format (exclusive of check-out date).
   */
  getDatesBetween(startDateStr: string, endDateStr: string): string[] {
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return [startDateStr];
    }
    const dates: string[] = [];
    const curr = new Date(start);
    while (curr < end) {
      const yyyy = curr.getFullYear();
      const mm = String(curr.getMonth() + 1).padStart(2, '0');
      const dd = String(curr.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
      curr.setDate(curr.getDate() + 1);
    }
    return dates;
  }

  /**
   * Main Pricing Engine Quote Calculation
   */
  async calculateQuote(
    propertyId: string,
    roomId: string | undefined | null,
    startDateStr: string,
    endDateStr: string
  ): Promise<PricingBreakdown> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId);
    const property = isUuid ? await propertyRepository.findById(propertyId) : await propertyRepository.findBySlug(propertyId);
    if (!property) {
      throw new Error(`Property with ID/Slug ${propertyId} not found.`);
    }

    const resolvedPropertyId = property.id;
    const rooms = await propertyRepository.findRoomsByPropertyId(resolvedPropertyId);
    const room = roomId ? rooms.find(r => r.id === roomId) : (rooms.length > 0 ? rooms[0] : null);

    const baseNightlyRate = Number(room ? room.basePrice : property.basePrice) || 0;

    // Get dates to stay
    const dates = this.getDatesBetween(startDateStr, endDateStr);
    const nights = dates.length;

    // Load overrides if room exists
    const overrides = room ? await propertyRepository.getAvailabilities(room.id) : [];

    // Load peak season rates
    const peakRates = await propertyRepository.getPeakRates(resolvedPropertyId);

    let subtotal = 0;
    let seasonalAdjustment = 0;
    let matchedPeak: any = null;

    for (const dateStr of dates) {
      let nightRate = baseNightlyRate;

      // 1. Check room availability price overrides
      const override = overrides.find(o => o.date === dateStr);
      if (override?.priceOverride !== null && override?.priceOverride !== undefined) {
        nightRate = Number(override.priceOverride);
      } else {
        // 2. Check peak season rates matching this date string
        // Priority: Room-specific peak season rate first, then property-wide peak season rate
        const matchingPeaks = peakRates.filter(p => p.isActive !== false && dateStr >= p.startDate && dateStr <= p.endDate);
        if (matchingPeaks.length > 0) {
          const roomPeak = room ? matchingPeaks.find(p => p.roomId === room.id) : null;
          const defaultPeak = matchingPeaks.find(p => !p.roomId);
          const chosenPeak = roomPeak || defaultPeak || matchingPeaks[0];

          if (chosenPeak) {
            nightRate = Math.round(baseNightlyRate * Number(chosenPeak.rateMultiplier));
            matchedPeak = chosenPeak;
          }
        }
      }

      if (!Number.isFinite(nightRate)) {
        nightRate = baseNightlyRate;
      }

      subtotal += nightRate;
      seasonalAdjustment += (nightRate - baseNightlyRate);
    }

    const cleaningFee = property.cleaningFee !== undefined && property.cleaningFee !== null ? Number(property.cleaningFee) : 0;
    const serviceFee = property.serviceFee !== undefined && property.serviceFee !== null ? Number(property.serviceFee) : 0;
    const tax = Math.round(subtotal * 0.10);
    const total = subtotal + cleaningFee + serviceFee + tax;

    const finalRoomPriceVal = matchedPeak ? Math.round(baseNightlyRate * Number(matchedPeak.rateMultiplier)) : baseNightlyRate;

    const breakdown: PricingBreakdown = {
      nightlyRate: Number.isFinite(baseNightlyRate) ? baseNightlyRate : 0,
      nights: Number.isFinite(nights) ? nights : 0,
      subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      cleaningFee: Number.isFinite(cleaningFee) ? cleaningFee : 0,
      serviceFee: Number.isFinite(serviceFee) ? serviceFee : 0,
      tax: Number.isFinite(tax) ? tax : 0,
      taxes: Number.isFinite(tax) ? tax : 0,
      seasonalAdjustment: Number.isFinite(seasonalAdjustment) ? seasonalAdjustment : 0,
      total: Number.isFinite(total) ? total : 0,
      peakMultiplier: matchedPeak ? Number(matchedPeak.rateMultiplier) : 1.0,
      peakSeasonName: matchedPeak ? matchedPeak.name : null,
      finalRoomPrice: Number.isFinite(finalRoomPriceVal) ? finalRoomPriceVal : 0
    };

    console.log('[DEBUG ENGINE BACKEND] pricingInput:', {
      propertyId,
      roomId,
      startDateStr,
      endDateStr,
      resolvedPropertyId,
      roomDetails: room ? { id: room.id, basePrice: room.basePrice } : null,
      propertyDetails: { id: property.id, basePrice: property.basePrice }
    });
    console.log('[DEBUG ENGINE BACKEND] pricingOutput:', breakdown);

    return breakdown;
  }
}

export const pricingService = new PricingService();
