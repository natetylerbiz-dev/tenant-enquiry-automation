import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

export type ConversationState = "new" | "awaiting_slot_selection" | "booked" | "escalated";

export interface TenantRecord {
  phone: string;
  name: string;
  email: string;
  property: string;
  state: ConversationState;
  offeredSlots: string | null;
  createdAt: string;
  updatedAt: string;
}

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      phone TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      property TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'new',
      offered_slots TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

function toTenantRecord(row: Record<string, unknown>): TenantRecord {
  return {
    phone: row.phone as string,
    name: row.name as string,
    email: row.email as string,
    property: row.property as string,
    state: row.state as ConversationState,
    offeredSlots: (row.offered_slots as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getTenant(phone: string): TenantRecord | undefined {
  const row = getDb().prepare("SELECT * FROM tenants WHERE phone = ?").get(phone);
  return row ? toTenantRecord(row) : undefined;
}

export function upsertTenant(record: Omit<TenantRecord, "createdAt" | "updatedAt">): TenantRecord {
  const existing = getTenant(record.phone);
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO tenants (phone, name, email, property, state, offered_slots, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         property = excluded.property,
         state = excluded.state,
         offered_slots = excluded.offered_slots,
         updated_at = excluded.updated_at`
    )
    .run(
      record.phone,
      record.name,
      record.email,
      record.property,
      record.state,
      record.offeredSlots,
      existing?.createdAt ?? now,
      now
    );

  return getTenant(record.phone)!;
}
