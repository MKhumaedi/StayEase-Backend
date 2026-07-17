import { prisma } from '../../../database/prisma';
import { BookingStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { getMaintenanceRequests } from '../../../database/housekeeping_maintenance';
import { getMidtransOrderId, midtransService } from '../../payments/services/MidtransService';

async function resolvePaymentDetails(b: any): Promise<{ paymentMethod: string; paymentStatus: string }> {
  // If no successful payment exists, display "-"
  const isPaid = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'].includes(b.status);
  if (!isPaid) {
    return { paymentMethod: '-', paymentStatus: '-' };
  }

  // Parse b.paymentProof?.proofUrl
  let parsed: any = null;
  const proofUrl = b.paymentProof?.proofUrl || '';
  if (proofUrl.trim().startsWith('{')) {
    try {
      parsed = JSON.parse(proofUrl);
    } catch (e) {}
  }

  // Determine actual payment provider
  let rawProvider = '';
  let rawStatus = '';

  // 1. Check if it's Midtrans
  const isMidtrans = proofUrl.includes('midtrans') || (parsed && parsed.method === 'midtrans');
  if (isMidtrans) {
    rawStatus = 'PAID'; // Default status for successful Midtrans payment
    
    // Attempt to read from midtrans status API to get the actual payment provider and status
    try {
      const orderId = getMidtransOrderId(b.id) || b.bookingCode;
      if (orderId) {
        const payload = await midtransService.getStatusFromMidtrans(orderId);
        if (payload) {
          // Map payment status from Midtrans payload
          if (payload.transaction_status === 'settlement' || payload.transaction_status === 'capture') {
            rawStatus = 'PAID';
          } else if (payload.transaction_status === 'pending') {
            rawStatus = 'PENDING';
          } else if (payload.transaction_status === 'deny' || payload.transaction_status === 'cancel' || payload.transaction_status === 'expire') {
            rawStatus = 'CANCELLED';
          }

          // Map payment provider from Midtrans payload
          const paymentType = payload.payment_type;
          if (paymentType === 'credit_card') {
            rawProvider = 'Credit Card';
          } else if (paymentType === 'gopay') {
            rawProvider = 'GoPay';
          } else if (paymentType === 'shopeepay') {
            rawProvider = 'ShopeePay';
          } else if (paymentType === 'qris') {
            rawProvider = 'QRIS';
          } else if (paymentType === 'bank_transfer' || paymentType === 'echannel') {
            const bank = payload.bank || (payload.va_numbers && payload.va_numbers[0] && payload.va_numbers[0].bank);
            if (bank) {
              const bUpper = bank.toUpperCase();
              if (bUpper === 'BCA') {
                rawProvider = 'Virtual Account BCA';
              } else if (bUpper === 'BNI') {
                rawProvider = 'Virtual Account BNI';
              } else if (bUpper === 'MANDIRI' || bUpper === 'PERMATA' || paymentType === 'echannel') {
                rawProvider = 'Virtual Account Mandiri';
              } else {
                rawProvider = `Virtual Account ${bUpper}`;
              }
            } else {
              rawProvider = 'Bank Transfer';
            }
          }
        }
      }
    } catch (err) {
      console.error('[ExportService] Error fetching Midtrans status:', err);
    }

    if (!rawProvider) {
      // Fallback if Midtrans fetch failed
      rawProvider = 'Midtrans SNAP';
    }
  } else if (b.paymentProof) {
    // 2. Manual Transfer
    rawProvider = 'Bank Transfer';
    rawStatus = parsed?.status || 'PENDING';
    if (rawStatus === 'APPROVED') {
      rawStatus = 'PAID';
    }
  }

  // Final mapping based on the requirements/examples
  let mappedMethod = '-';
  if (rawProvider === 'Midtrans SNAP') mappedMethod = 'Midtrans SNAP';
  else if (rawProvider === 'Bank Transfer') mappedMethod = 'Manual Transfer';
  else if (rawProvider === 'QRIS') mappedMethod = 'QRIS';
  else if (rawProvider === 'GoPay') mappedMethod = 'GoPay';
  else if (rawProvider === 'ShopeePay') mappedMethod = 'ShopeePay';
  else if (rawProvider === 'Virtual Account BCA') mappedMethod = 'BCA Virtual Account';
  else if (rawProvider === 'Virtual Account BNI') mappedMethod = 'BNI Virtual Account';
  else if (rawProvider === 'Virtual Account Mandiri') mappedMethod = 'Mandiri Virtual Account';
  else if (rawProvider === 'Credit Card') mappedMethod = 'Credit Card';
  else if (rawProvider) {
    // General / Dynamic mapping
    const lower = rawProvider.toLowerCase();
    if (lower.includes('qris')) mappedMethod = 'QRIS';
    else if (lower.includes('gopay')) mappedMethod = 'GoPay';
    else if (lower.includes('shopeepay')) mappedMethod = 'ShopeePay';
    else if (lower.includes('credit card') || lower.includes('credit_card')) mappedMethod = 'Credit Card';
    else if (lower.includes('bca')) mappedMethod = 'BCA Virtual Account';
    else if (lower.includes('bni')) mappedMethod = 'BNI Virtual Account';
    else if (lower.includes('mandiri')) mappedMethod = 'Mandiri Virtual Account';
    else if (lower.includes('midtrans')) mappedMethod = 'Midtrans SNAP';
    else if (lower.includes('bank') || lower.includes('manual')) mappedMethod = 'Manual Transfer';
    else mappedMethod = rawProvider;
  }

  return {
    paymentMethod: mappedMethod,
    paymentStatus: rawStatus || 'PENDING'
  };
}

export class ExportService {
  async generateReport(
    landlordId: string,
    format: 'csv' | 'xlsx',
    period: string,
    startDate?: string,
    endDate?: string,
    propertyId?: string,
    reportType: 'revenue' | 'booking' | 'occupancy' | 'operational' = 'revenue'
  ): Promise<{ filename: string; buffer: Buffer; mimeType: string }> {
    // 1. Calculate dynamic date ranges
    let filterStart: Date;
    let filterEnd: Date;
    const todayDate = new Date();

    if (period === 'today') {
      filterStart = new Date();
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date();
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'this_week') {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      filterStart = new Date(d.setDate(diff));
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date(filterStart);
      filterEnd.setDate(filterEnd.getDate() + 7);
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'this_month') {
      filterStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
      filterEnd = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'this_year') {
      filterStart = new Date(todayDate.getFullYear(), 0, 1);
      filterEnd = new Date(todayDate.getFullYear(), 11, 31);
      filterEnd.setHours(23, 59, 59, 999);
    } else if (period === 'custom' && startDate && endDate) {
      filterStart = new Date(startDate + 'T00:00:00');
      filterEnd = new Date(endDate + 'T23:59:59');
    } else {
      // Default to this year
      filterStart = new Date(todayDate.getFullYear(), 0, 1);
      filterEnd = new Date(todayDate.getFullYear(), 11, 31);
      filterEnd.setHours(23, 59, 59, 999);
    }

    // Helper to format date
    const formatDate = (date: any) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('id-ID', { year: 'numeric', month: '2-digit', day: '2-digit' });
    };

    // 2. Fetch all bookings for date filtering range
    const whereClause: any = {
      deletedAt: null,
      createdAt: {
        gte: filterStart,
        lte: filterEnd,
      },
      property: {
        tenantId: landlordId,
        deletedAt: null,
      }
    };

    if (propertyId && propertyId !== '') {
      whereClause.propertyId = propertyId;
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        property: true,
        room: true,
        paymentProof: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 3. Resolve human labels for metadata
    let periodLabel = period.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (period === 'custom') {
      periodLabel = `${formatDate(filterStart)} - ${formatDate(filterEnd)}`;
    }
    
    let propertyLabel = 'All Properties';
    if (propertyId && propertyId !== '') {
      const prop = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { name: true }
      });
      if (prop) {
        propertyLabel = prop.name;
      }
    }

    // Generate date list for overlapping occupancy checks
    const dateList: string[] = [];
    let curr = new Date(filterStart);
    while (curr <= filterEnd) {
      const yStr = curr.getFullYear() + '-' + String(curr.getMonth() + 1).padStart(2, '0') + '-' + String(curr.getDate()).padStart(2, '0');
      dateList.push(yStr);
      curr.setDate(curr.getDate() + 1);
    }
    const totalDays = dateList.length;

    // 4. Construct reports based on reportType
    let headers: string[] = [];
    let rows: any[][] = [];
    let title = '';
    
    // Column format indexes for Excel styling
    let currencyColumns: number[] = [];
    let numberColumns: number[] = [];
    let percentColumns: number[] = [];
    let dateColumns: number[] = [];

    if (reportType === 'revenue') {
      title = 'Revenue Performance Report';
      headers = [
        'Date',
        'Booking Code',
        'Guest Name',
        'Property',
        'Room',
        'Check In',
        'Check Out',
        'Nights',
        'Payment Method',
        'Payment Status',
        'Revenue',
        'Cleaning Fee',
        'Service Fee',
        'Tax',
        'Total Paid'
      ];

      currencyColumns = [10, 11, 12, 13, 14];
      numberColumns = [7];
      dateColumns = [0, 5, 6];

      const allMappedRows = await Promise.all(bookings.map(async (b) => {
        const cleaningFee = Number(b.property?.cleaningFee ?? 0);
        const serviceFee = Number(b.property?.serviceFee ?? 0);
        
        const isPaidStatus = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'].includes(b.status);
        const totalPaid = isPaidStatus ? Number(b.totalAmount) : 0;
        
        // subtotal + tax = totalAmount - cleaningFee - serviceFee
        // subtotal = (totalAmount - cleaningFee - serviceFee) / 1.1
        const rawTotal = Number(b.totalAmount);
        const subtotal = Math.max(0, Math.round((rawTotal - cleaningFee - serviceFee) / 1.1));
        const tax = Math.max(0, rawTotal - cleaningFee - serviceFee - subtotal);
        const revenue = isPaidStatus ? subtotal : 0;
        
        const { paymentMethod, paymentStatus } = await resolvePaymentDetails(b);

        return {
          row: [
            formatDate(b.createdAt),
            b.bookingCode,
            b.guestName,
            b.property?.name || 'N/A',
            b.room?.name || 'N/A',
            b.startDate,
            b.endDate,
            b.nights,
            paymentMethod,
            paymentStatus,
            revenue,
            isPaidStatus ? cleaningFee : 0,
            isPaidStatus ? serviceFee : 0,
            isPaidStatus ? tax : 0,
            totalPaid
          ],
          bookingStatus: b.status as string,
          paymentStatus,
          paymentMethod,
          revenue,
          totalPaid
        };
      }));

      // Filter to only include successful revenue transactions
      const filteredMappedRows = allMappedRows.filter(item => {
        // EXPORT FILTER:
        // Only include bookings where Payment Status = PAID OR Reservation Status = COMPLETED OR Reservation Status = CHECKED_OUT
        const hasValidStatus = item.paymentStatus === 'PAID' || 
                               item.bookingStatus === 'COMPLETED' || 
                               item.bookingStatus === 'CHECKED_OUT';
        if (!hasValidStatus) return false;

        // Never export: PENDING, WAITING_PAYMENT, FAILED, EXPIRED, CANCELLED, REFUNDED, REJECTED, NO_PAYMENT, Draft reservations
        const forbiddenBookingStatuses = [
          'WAITING_PAYMENT', 'CANCELLED', 'AUTO_EXPIRED'
        ];
        if (forbiddenBookingStatuses.includes(item.bookingStatus)) return false;

        const forbiddenPaymentStatuses = [
          'PENDING', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'REJECTED', 'NO_PAYMENT', '-'
        ];
        if (forbiddenPaymentStatuses.includes(item.paymentStatus)) return false;

        // REVENUE:
        // Only export rows where revenue has actually been recognized and is greater than zero.
        // Exclude rows with Revenue = 0, Total Paid = 0.
        if (item.revenue <= 0 || item.totalPaid <= 0) return false;

        // PAYMENT METHOD:
        // Only display valid payment methods. Do not export "-"
        if (!item.paymentMethod || item.paymentMethod === '-') return false;

        return true;
      });

      rows = filteredMappedRows.map(item => item.row);

    } else if (reportType === 'booking') {
      title = 'Booking volume & Trends Report';
      headers = [
        'Booking Code',
        'Guest',
        'Property',
        'Room',
        'Status',
        'Booking Date',
        'Check In',
        'Check Out',
        'Total Payment'
      ];

      currencyColumns = [8];
      dateColumns = [5, 6, 7];

      rows = bookings.map(b => {
        return [
          b.bookingCode,
          b.guestName,
          b.property?.name || 'N/A',
          b.room?.name || 'N/A',
          b.status,
          formatDate(b.createdAt),
          b.startDate,
          b.endDate,
          Number(b.totalAmount)
        ];
      });

    } else if (reportType === 'occupancy') {
      title = 'Occupancy Rate Diagnostics Report';
      headers = [
        'Property',
        'Room',
        'Available Rooms',
        'Occupied Rooms',
        'Occupancy %',
        'ADR',
        'RevPAR'
      ];

      numberColumns = [2, 3];
      percentColumns = [4];
      currencyColumns = [5, 6];

      // Fetch all properties with rooms
      const properties = await prisma.property.findMany({
        where: {
          tenantId: landlordId,
          deletedAt: null,
          id: propertyId || undefined
        },
        include: {
          rooms: {
            where: { deletedAt: null }
          }
        }
      });

      for (const p of properties) {
        for (const r of p.rooms) {
          let occupiedDays = 0;
          let totalRoomRevenue = 0;
          
          // Filter successful overlapping bookings for this room
          const roomBookings = bookings.filter(
            b => b.roomId === r.id && 
            ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'].includes(b.status)
          );
          
          for (const dateStr of dateList) {
            const isOccupied = roomBookings.some(b => {
              return dateStr >= b.startDate && dateStr < b.endDate;
            });
            if (isOccupied) {
              occupiedDays++;
            }
          }
          
          totalRoomRevenue = roomBookings.reduce((sum, b) => {
            let overlapNights = 0;
            const bStart = new Date(b.startDate + 'T00:00:00');
            const bEnd = new Date(b.endDate + 'T00:00:00');
            let bCurr = new Date(bStart);
            while (bCurr < bEnd) {
              const yStr = bCurr.getFullYear() + '-' + String(bCurr.getMonth() + 1).padStart(2, '0') + '-' + String(bCurr.getDate()).padStart(2, '0');
              if (dateList.includes(yStr)) {
                overlapNights++;
              }
              bCurr.setDate(bCurr.getDate() + 1);
            }
            const pricePerNight = Number(b.finalRoomPrice || b.basePrice || (Number(b.totalAmount) / b.nights));
            return sum + (overlapNights * pricePerNight);
          }, 0);
          
          const occupancyRate = totalDays > 0 ? (occupiedDays / totalDays) * 100 : 0;
          const adr = occupiedDays > 0 ? totalRoomRevenue / occupiedDays : 0;
          const revpar = totalDays > 0 ? totalRoomRevenue / totalDays : 0;
          
          rows.push([
            p.name,
            r.name,
            totalDays,
            occupiedDays,
            occupancyRate,
            adr,
            revpar
          ]);
        }
      }

    } else if (reportType === 'operational') {
      title = 'Property Operational Summary Report';
      headers = [
        'Property',
        'Check-In',
        'Check-Out',
        'Cleaning',
        'Maintenance',
        'Revenue'
      ];

      numberColumns = [1, 2, 3, 4];
      currencyColumns = [5];

      const properties = await prisma.property.findMany({
        where: {
          tenantId: landlordId,
          deletedAt: null,
          id: propertyId || undefined
        }
      });

      const maintenanceRequests = await getMaintenanceRequests(landlordId);

      for (const p of properties) {
        // Find successful bookings for this property
        const propBookings = bookings.filter(
          b => b.propertyId === p.id && 
          ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'].includes(b.status)
        );

        // Count check-ins in the filtered period
        const checkIns = propBookings.filter(b => {
          const checkInDate = new Date(b.startDate + 'T00:00:00');
          return checkInDate >= filterStart && checkInDate <= filterEnd;
        }).length;

        // Count check-outs in the filtered period
        const checkOuts = propBookings.filter(b => {
          const checkOutDate = new Date(b.endDate + 'T00:00:00');
          return checkOutDate >= filterStart && checkOutDate <= filterEnd;
        }).length;

        const cleaningCount = checkOuts; // Cleanup runs on checkouts

        const startDateStr = filterStart.toISOString().split('T')[0];
        const endDateStr = filterEnd.toISOString().split('T')[0];
        const maintenanceCount = maintenanceRequests.filter(m => {
          return m.propertyName === p.name && m.createdAt >= startDateStr && m.createdAt <= endDateStr;
        }).length;

        const totalPropRevenue = propBookings.reduce((sum, b) => {
          let overlapNights = 0;
          const bStart = new Date(b.startDate + 'T00:00:00');
          const bEnd = new Date(b.endDate + 'T00:00:00');
          let bCurr = new Date(bStart);
          while (bCurr < bEnd) {
            const yStr = bCurr.getFullYear() + '-' + String(bCurr.getMonth() + 1).padStart(2, '0') + '-' + String(bCurr.getDate()).padStart(2, '0');
            if (dateList.includes(yStr)) {
              overlapNights++;
            }
            bCurr.setDate(bCurr.getDate() + 1);
          }
          const pricePerNight = Number(b.finalRoomPrice || b.basePrice || (Number(b.totalAmount) / b.nights));
          return sum + (overlapNights * pricePerNight);
        }, 0);

        rows.push([
          p.name,
          checkIns,
          checkOuts,
          cleaningCount,
          maintenanceCount,
          totalPropRevenue
        ]);
      }
    }

    // 5. Build output format
    if (format === 'csv') {
      const escapeCell = (cell: any) => {
        if (cell === null || cell === undefined) return '';
        const str = String(cell);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const exportRows = [...rows];
      if (reportType === 'revenue') {
        let totalNights = 0;
        let totalRevenueSum = 0;
        let totalCleaningFeeSum = 0;
        let totalServiceFeeSum = 0;
        let totalTaxSum = 0;
        let totalPaidSum = 0;

        rows.forEach(r => {
          totalNights += Number(r[7] || 0);
          totalRevenueSum += Number(r[10] || 0);
          totalCleaningFeeSum += Number(r[11] || 0);
          totalServiceFeeSum += Number(r[12] || 0);
          totalTaxSum += Number(r[13] || 0);
          totalPaidSum += Number(r[14] || 0);
        });

        exportRows.push([
          'TOTAL',
          '',
          '',
          '',
          '',
          '',
          '',
          totalNights,
          '',
          '',
          totalRevenueSum,
          totalCleaningFeeSum,
          totalServiceFeeSum,
          totalTaxSum,
          totalPaidSum
        ]);
      }
      
      const headerLine = headers.map(escapeCell).join(',');
      const rowLines = exportRows.map(r => r.map(escapeCell).join(','));
      const csvContent = [headerLine, ...rowLines].join('\r\n');
      
      const filename = `${reportType}_report_${period}_${Date.now()}.csv`;
      return {
        filename,
        buffer: Buffer.from('\ufeff' + csvContent, 'utf-8'), // Include UTF-8 BOM for MS Excel compatibility
        mimeType: 'text/csv; charset=utf-8'
      };
    } else {
      // exceljs .xlsx generation
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'StayEase';
      workbook.lastModifiedBy = 'StayEase';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Operational Report', {
        views: [{ state: 'frozen', ySplit: 6 }], // Freeze header row (Rows 1-5 metadata, Row 6 column headers)
        pageSetup: { 
          paperSize: 9, // A4
          orientation: 'landscape', 
          fitToPage: true, 
          fitToWidth: 1, 
          fitToHeight: 0 
        }
      });

      // Style sheet Title (Row 1)
      worksheet.mergeCells('A1:G1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `${title} - StayEase`;
      titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E1B4B' } // Dark indigo
      };
      worksheet.getRow(1).height = 32;

      // Metadata Rows (Row 3 & 4)
      worksheet.getCell('A3').value = 'Company:';
      worksheet.getCell('A3').font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF475569' } };
      worksheet.getCell('B3').value = 'StayEase';
      worksheet.getCell('B3').font = { name: 'Segoe UI', size: 10 };

      worksheet.getCell('D3').value = 'Export Date:';
      worksheet.getCell('D3').font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF475569' } };
      worksheet.getCell('E3').value = new Date().toLocaleString('id-ID');
      worksheet.getCell('E3').font = { name: 'Segoe UI', size: 10 };

      worksheet.getCell('A4').value = 'Report Period:';
      worksheet.getCell('A4').font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF475569' } };
      worksheet.getCell('B4').value = periodLabel;
      worksheet.getCell('B4').font = { name: 'Segoe UI', size: 10 };

      worksheet.getCell('D4').value = 'Filter Property:';
      worksheet.getCell('D4').font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF475569' } };
      worksheet.getCell('E4').value = propertyLabel;
      worksheet.getCell('E4').font = { name: 'Segoe UI', size: 10 };

      worksheet.getRow(3).height = 18;
      worksheet.getRow(4).height = 18;

      // Empty Row 5 spacing
      worksheet.getRow(5).height = 12;

      // Column Headers (Row 6)
      const headerRowNumber = 6;
      const headerRow = worksheet.getRow(headerRowNumber);
      headers.forEach((header, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = header;
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF312E81' } // Mid indigo
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          bottom: { style: 'medium', color: { argb: 'FF1E1B4B' } }
        };
      });
      headerRow.height = 28;

      // Add Data Rows
      rows.forEach((rowData, rowIndex) => {
        const rowNum = headerRowNumber + 1 + rowIndex;
        const row = worksheet.getRow(rowNum);
        
        rowData.forEach((val, colIndex) => {
          const cell = row.getCell(colIndex + 1);
          cell.value = val;
          cell.font = { name: 'Segoe UI', size: 10 };
          
          // Default alignment
          cell.alignment = { vertical: 'middle', horizontal: 'left' };

          // Number columns
          if (numberColumns.includes(colIndex)) {
            cell.numFmt = '#,##0';
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
          } 
          // Currency formatting IDR
          else if (currencyColumns.includes(colIndex)) {
            cell.numFmt = '"Rp"#,##0';
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
          } 
          // Percent columns
          else if (percentColumns.includes(colIndex)) {
            cell.numFmt = '0.0"%"';
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
          } 
          // Date columns
          else if (dateColumns.includes(colIndex)) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          }

          // Alternating zebra striping
          if (rowIndex % 2 === 1) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF9FAFB' } // Cool soft white
            };
          }

          cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
        });
        row.height = 22;
      });

      // Add Totals Row for Revenue report
      if (reportType === 'revenue') {
        let totalNights = 0;
        let totalRevenueSum = 0;
        let totalCleaningFeeSum = 0;
        let totalServiceFeeSum = 0;
        let totalTaxSum = 0;
        let totalPaidSum = 0;

        rows.forEach(r => {
          totalNights += Number(r[7] || 0);
          totalRevenueSum += Number(r[10] || 0);
          totalCleaningFeeSum += Number(r[11] || 0);
          totalServiceFeeSum += Number(r[12] || 0);
          totalTaxSum += Number(r[13] || 0);
          totalPaidSum += Number(r[14] || 0);
        });

        const totalRowIndex = headerRowNumber + 1 + rows.length;
        const totalRow = worksheet.getRow(totalRowIndex);
        
        // Merge cells from A to G (1 to 7)
        worksheet.mergeCells(`A${totalRowIndex}:G${totalRowIndex}`);
        const labelCell = totalRow.getCell(1);
        labelCell.value = 'TOTAL';
        labelCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF1E1B4B' } };
        labelCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        // Nights (Col 8)
        const nightsCell = totalRow.getCell(8);
        nightsCell.value = totalNights;
        nightsCell.font = { name: 'Segoe UI', size: 10, bold: true };
        nightsCell.numFmt = '#,##0';
        nightsCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        // Empty cells for 9 and 10
        totalRow.getCell(9).value = '';
        totalRow.getCell(10).value = '';
        
        // Revenue (Col 11)
        const revCell = totalRow.getCell(11);
        revCell.value = totalRevenueSum;
        revCell.font = { name: 'Segoe UI', size: 10, bold: true };
        revCell.numFmt = '"Rp"#,##0';
        revCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        // Cleaning Fee (Col 12)
        const cleanCell = totalRow.getCell(12);
        cleanCell.value = totalCleaningFeeSum;
        cleanCell.font = { name: 'Segoe UI', size: 10, bold: true };
        cleanCell.numFmt = '"Rp"#,##0';
        cleanCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        // Service Fee (Col 13)
        const servCell = totalRow.getCell(13);
        servCell.value = totalServiceFeeSum;
        servCell.font = { name: 'Segoe UI', size: 10, bold: true };
        servCell.numFmt = '"Rp"#,##0';
        servCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        // Tax (Col 14)
        const taxCell = totalRow.getCell(14);
        taxCell.value = totalTaxSum;
        taxCell.font = { name: 'Segoe UI', size: 10, bold: true };
        taxCell.numFmt = '"Rp"#,##0';
        taxCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        // Total Paid (Col 15)
        const paidCell = totalRow.getCell(15);
        paidCell.value = totalPaidSum;
        paidCell.font = { name: 'Segoe UI', size: 10, bold: true };
        paidCell.numFmt = '"Rp"#,##0';
        paidCell.alignment = { vertical: 'middle', horizontal: 'right' };
        
        // Apply styling / border to the entire total row
        for (let col = 1; col <= 15; col++) {
          const cell = totalRow.getCell(col);
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF1E1B4B' } },
            bottom: { style: 'double', color: { argb: 'FF1E1B4B' } }
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF1F5F9' } // light slate gray background
          };
        }
        totalRow.height = 24;
      }

      // Auto Column Width Calculation
      worksheet.columns.forEach((column) => {
        let maxLen = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          if ((cell.row as any) === 1) return; // Ignore merged title block
          const valueStr = cell.value ? String(cell.value) : '';
          // Avoid count formatting syntax in length estimation
          if (valueStr.length > maxLen) {
            maxLen = valueStr.length;
          }
        });
        column.width = Math.max(maxLen + 4, 13); // Margins + Minimum Width
      });

      const buffer = await workbook.xlsx.writeBuffer() as Buffer;
      const filename = `${reportType}_report_${period}_${Date.now()}.xlsx`;

      return {
        filename,
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
    }
  }
}
