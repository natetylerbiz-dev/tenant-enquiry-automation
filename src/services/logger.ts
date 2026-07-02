import { getDb } from "../state/db.js";

export function logEvent(phone: string, type: string, payload: unknown): void {
  getDb()
    .prepare("INSERT INTO events (phone, type, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(phone, type, JSON.stringify(payload), new Date().toISOString());
}
