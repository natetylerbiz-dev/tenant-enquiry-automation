import { RATE_LIMIT_MAX_MESSAGES, RATE_LIMIT_WINDOW_MS } from "../config.js";

// Bounds memory the same way twilioPoller's seenSids does — only phones with
// activity inside the last window matter, so a hard cap plus prune-on-read is
// enough without a background sweep.
const MAX_TRACKED_PHONES = 500;

interface Window {
  timestamps: number[];
  notifiedAt: number | null;
}

const windows = new Map<string, Window>();

function prune(now: number): void {
  for (const [phone, w] of windows) {
    w.timestamps = w.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (w.timestamps.length === 0 && (w.notifiedAt === null || now - w.notifiedAt >= RATE_LIMIT_WINDOW_MS)) {
      windows.delete(phone);
    }
  }
  if (windows.size > MAX_TRACKED_PHONES) {
    const oldest = Array.from(windows.keys()).slice(0, windows.size - MAX_TRACKED_PHONES);
    for (const phone of oldest) windows.delete(phone);
  }
}

export interface RateLimitResult {
  limited: boolean;
  // True only the first time a given phone trips the limit within a window —
  // callers use this to send a single throttle notice instead of one per
  // dropped message, which would just be more spam (and more Twilio sends).
  shouldNotify: boolean;
}

export function checkRateLimit(phone: string): RateLimitResult {
  const now = Date.now();
  prune(now);

  let w = windows.get(phone);
  if (!w) {
    w = { timestamps: [], notifiedAt: null };
    windows.set(phone, w);
  }
  w.timestamps = w.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (w.timestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
    const shouldNotify = w.notifiedAt === null || now - w.notifiedAt >= RATE_LIMIT_WINDOW_MS;
    if (shouldNotify) w.notifiedAt = now;
    return { limited: true, shouldNotify };
  }

  w.timestamps.push(now);
  return { limited: false, shouldNotify: false };
}
