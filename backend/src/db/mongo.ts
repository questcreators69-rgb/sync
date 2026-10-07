import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;
let isConnected = false;

const memoryStore: Record<string, any[]> = {
  tasks: [],
  scheduleEvents: [],
  timetableEntries: [],
  habits: [],
  habitEntries: [],
  exams: [],
  notes: [],
  projects: [],
  pomodoroSessions: [],
  gameStats: [],
  gameSessions: [],
  userProfiles: [],
  friendships: [],
  friendRequests: [],
  multiplayerRooms: [],
  challengeClaims: [],
};

export async function connectMongo(): Promise<boolean> {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sync_db';
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db();
    isConnected = true;
    return true;
  } catch {
    isConnected = false;
    return false;
  }
}

export function isDbConnected(): boolean {
  return isConnected;
}

export async function getCollectionItems(collectionName: string, query: Record<string, any> = {}): Promise<any[]> {
  if (isConnected && db) {
    try {
      const col = db.collection(collectionName);
      return await col.find(query).toArray();
    } catch {
      return memoryFind(collectionName, query);
    }
  }
  return memoryFind(collectionName, query);
}

export async function insertItem(collectionName: string, item: any): Promise<any> {
  if (isConnected && db) {
    try {
      const col = db.collection(collectionName);
      await col.insertOne(item);
      return item;
    } catch {
      return memoryInsert(collectionName, item);
    }
  }
  return memoryInsert(collectionName, item);
}

export async function updateItem(collectionName: string, id: string, ownerId: string, updates: any): Promise<any | null> {
  if (isConnected && db) {
    try {
      const col = db.collection(collectionName);
      const res = await col.findOneAndUpdate(
        { id, ownerId },
        { $set: updates },
        { returnDocument: 'after' }
      );
      return res;
    } catch {
      return memoryUpdate(collectionName, id, ownerId, updates);
    }
  }
  return memoryUpdate(collectionName, id, ownerId, updates);
}

export async function deleteItem(collectionName: string, id: string, ownerId: string): Promise<boolean> {
  if (isConnected && db) {
    try {
      const col = db.collection(collectionName);
      const res = await col.deleteOne({ id, ownerId });
      return res.deletedCount > 0;
    } catch {
      return memoryDelete(collectionName, id, ownerId);
    }
  }
  return memoryDelete(collectionName, id, ownerId);
}

export async function upsertItem(collectionName: string, query: Record<string, any>, item: any): Promise<any> {
  if (isConnected && db) {
    try {
      const col = db.collection(collectionName);
      await col.updateOne(query, { $set: item }, { upsert: true });
      return item;
    } catch {
      return memoryUpsert(collectionName, query, item);
    }
  }
  return memoryUpsert(collectionName, query, item);
}

export async function findOneItem(collectionName: string, query: Record<string, any>): Promise<any | null> {
  if (isConnected && db) {
    try {
      const col = db.collection(collectionName);
      return await col.findOne(query);
    } catch {
      const list = memoryStore[collectionName] || [];
      return list.find(item => Object.entries(query).every(([k, v]) => item[k] === v)) || null;
    }
  }
  const list = memoryStore[collectionName] || [];
  return list.find(item => Object.entries(query).every(([k, v]) => item[k] === v)) || null;
}

export async function updateManyItems(collectionName: string, query: Record<string, any>, updates: Record<string, any>): Promise<number> {
if (isConnected && db) {
    try {
      const col = db.collection(collectionName);
      const res = await col.updateMany(query, { $set: updates });
      return res.modifiedCount;
    } catch {
      return memoryUpdateMany(collectionName, query, updates);
    }
}
  return memoryUpdateMany(collectionName, query, updates);
}

export async function migrateOwnerData(oldOwnerId: string, newOwnerId: string): Promise<void> {
  if (!oldOwnerId || !newOwnerId || oldOwnerId === newOwnerId) return;
  const collections = [
    'tasks',
    'scheduleEvents',
    'timetableEntries',
    'habits',
    'habitEntries',
    'exams',
    'notes',
    'projects',
    'pomodoroSessions',
    'gameStats',
    'gameSessions',
    'userProfiles',
    'challengeClaims',
  ];
  for (const name of collections) {
    await updateManyItems(name, { ownerId: oldOwnerId }, { ownerId: newOwnerId });
  }
}

function memoryUpdateMany(collectionName: string, query: Record<string, any>, updates: Record<string, any>): number {
  const list = memoryStore[collectionName] || [];
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    if (Object.entries(query).every(([k, v]) => list[i][k] === v)) {
      list[i] = { ...list[i], ...updates };
      count++;
    }
  }
  return count;
}

function memoryFind(collectionName: string, query: Record<string, any>): any[] {
  const list = memoryStore[collectionName] || [];
  return list.filter(item => {
    return Object.entries(query).every(([k, v]) => item[k] === v);
  });
}

function memoryInsert(collectionName: string, item: any): any {
  if (!memoryStore[collectionName]) {
    memoryStore[collectionName] = [];
  }
  memoryStore[collectionName].push(item);
  return item;
}

function memoryUpdate(collectionName: string, id: string, ownerId: string, updates: any): any | null {
  const list = memoryStore[collectionName] || [];
  const idx = list.findIndex(item => item.id === id && item.ownerId === ownerId);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates };
  return list[idx];
}

function memoryDelete(collectionName: string, id: string, ownerId: string): boolean {
  const list = memoryStore[collectionName] || [];
  const initialLen = list.length;
  memoryStore[collectionName] = list.filter(item => !(item.id === id && item.ownerId === ownerId));
  return memoryStore[collectionName].length < initialLen;
}

function memoryUpsert(collectionName: string, query: Record<string, any>, item: any): any {
  if (!memoryStore[collectionName]) {
    memoryStore[collectionName] = [];
  }
  const list = memoryStore[collectionName];
  const idx = list.findIndex(entry => Object.entries(query).every(([k, v]) => entry[k] === v));
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...item };
  } else {
    list.push(item);
  }
  return item;
}