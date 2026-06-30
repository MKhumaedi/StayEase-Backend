import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'housekeeping_maintenance.json');

export interface HousekeepingTask {
  id: string; // maps to roomId
  roomName: string;
  propertyName: string;
  status: 'DIRTY' | 'CLEANING' | 'INSPECTING' | 'READY' | 'OUT_OF_SERVICE';
  assignedTo: string;
  checklist: { text: string; done: boolean }[];
}

export interface MaintenanceRequest {
  id: string;
  title: string;
  propertyName: string;
  roomNameName: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  createdAt: string;
}

interface SavedData {
  housekeeping: HousekeepingTask[];
  maintenance: MaintenanceRequest[];
}

function loadData(): SavedData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('Error loading housekeeping/maintenance data:', e);
  }
  return { housekeeping: [], maintenance: [] };
}

function saveData(data: SavedData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving housekeeping/maintenance data:', e);
  }
}

// Automatically sync and initialize rooms from the actual database
export async function getHousekeepingTasks(tenantId?: string): Promise<HousekeepingTask[]> {
  const data = loadData();
  
  // Fetch real rooms from DB
  const rooms = await prisma.room.findMany({
    where: {
      deletedAt: null,
      property: tenantId ? { tenantId } : undefined
    },
    select: {
      id: true,
      name: true,
      property: {
        select: {
          name: true
        }
      }
    }
  });

  const updatedTasks: HousekeepingTask[] = [];

  for (const r of rooms) {
    let existing = data.housekeeping.find(t => t.id === r.id);
    if (!existing) {
      // Create new housekeeping task if it doesn't exist
      existing = {
        id: r.id,
        roomName: r.name,
        propertyName: r.property.name,
        status: 'READY', // Default to READY
        assignedTo: 'Unassigned',
        checklist: [
          { text: 'Replace linens & beddings', done: false },
          { text: 'Sanitize bathroom and surfaces', done: false },
          { text: 'Restock refreshments & amenities', done: false },
          { text: 'Inspect and dust fixtures', done: false }
        ]
      };
      data.housekeeping.push(existing);
    } else {
      // Keep name synchronized
      existing.roomName = r.name;
      existing.propertyName = r.property.name;
    }
    updatedTasks.push(existing);
  }

  // Save the synchronized data
  saveData(data);
  return updatedTasks;
}

export async function updateHousekeepingTask(
  roomId: string,
  update: Partial<Omit<HousekeepingTask, 'id'>>
): Promise<HousekeepingTask> {
  const data = loadData();
  let task = data.housekeeping.find(t => t.id === roomId);
  if (!task) {
    // If not found in file, load real room info to create it
    const r = await prisma.room.findFirst({
      where: { id: roomId },
      include: { property: true }
    });
    if (!r) throw new Error('Room not found');

    task = {
      id: r.id,
      roomName: r.name,
      propertyName: r.property.name,
      status: 'READY',
      assignedTo: 'Unassigned',
      checklist: [
        { text: 'Replace linens & beddings', done: false },
        { text: 'Sanitize bathroom and surfaces', done: false },
        { text: 'Restock refreshments & amenities', done: false },
        { text: 'Inspect and dust fixtures', done: false }
      ]
    };
    data.housekeeping.push(task);
  }

  // Apply updates
  if (update.status !== undefined) {
    task.status = update.status;
    
    // Auto sync Room status based on Housekeeping Status
    // READY -> Room is Available
    // OUT_OF_SERVICE -> Room is Maintenance
    // DIRTY/CLEANING/INSPECTING -> Room is UNAVAILABLE or BOOKED/Maintenance
    let roomStatus: 'Available' | 'Occupied' | 'Maintenance' | 'AVAILABLE' | 'UNAVAILABLE' | 'BOOKED' = 'Available';
    if (task.status === 'READY') {
      roomStatus = 'Available';
    } else if (task.status === 'OUT_OF_SERVICE') {
      roomStatus = 'Maintenance';
    } else {
      roomStatus = 'UNAVAILABLE';
    }

    try {
      await prisma.room.update({
        where: { id: roomId },
        data: { status: roomStatus }
      });
    } catch (e) {
      console.error('Failed to sync Room status on DB:', e);
    }
  }
  if (update.assignedTo !== undefined) task.assignedTo = update.assignedTo;
  if (update.checklist !== undefined) task.checklist = update.checklist;

  saveData(data);
  return task;
}

export async function getMaintenanceRequests(tenantId?: string): Promise<MaintenanceRequest[]> {
  const data = loadData();
  if (!tenantId) {
    return data.maintenance;
  }
  
  // Filter maintenance reports by tenant properties
  const properties = await prisma.property.findMany({
    where: { tenantId, deletedAt: null },
    select: { name: true }
  });
  const propNames = properties.map(p => p.name);
  return data.maintenance.filter(m => propNames.includes(m.propertyName));
}

export async function createMaintenanceRequest(
  req: Omit<MaintenanceRequest, 'id' | 'createdAt'>
): Promise<MaintenanceRequest> {
  const data = loadData();
  const newRequest: MaintenanceRequest = {
    id: 'm-' + Date.now(),
    createdAt: new Date().toISOString().split('T')[0],
    ...req
  };
  data.maintenance.unshift(newRequest);
  saveData(data);
  return newRequest;
}

export async function updateMaintenanceStatus(
  id: string,
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'
): Promise<MaintenanceRequest> {
  const data = loadData();
  const request = data.maintenance.find(m => m.id === id);
  if (!request) throw new Error('Maintenance request not found');

  request.status = status;
  saveData(data);
  return request;
}
