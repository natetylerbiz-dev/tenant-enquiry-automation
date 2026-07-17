import fs from "node:fs";
import path from "node:path";

// Two runtime instances polling the same Gmail/Twilio account independently
// double-process every message — each keeps its own in-memory dedup set, so
// neither sees the other's work. Observed in practice: a stray `npm run dev`
// left running from an earlier session caused every tenant WhatsApp reply to
// get two different FAQ answers. This lock makes a second instance refuse to
// start instead of failing silently.
const LOCK_PATH = path.join(process.cwd(), "data", "app.lock");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireInstanceLock(): void {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });

  if (fs.existsSync(LOCK_PATH)) {
    const existingPid = Number(fs.readFileSync(LOCK_PATH, "utf8").trim());
    if (Number.isInteger(existingPid) && isProcessAlive(existingPid)) {
      console.error(
        `Another instance is already running (pid ${existingPid}). Refusing to start a second ` +
          `one — both would poll Gmail/Twilio independently and double-process every message.`
      );
      process.exit(1);
    }
    // Stale lock left by a process that didn't exit cleanly — safe to reclaim.
  }

  fs.writeFileSync(LOCK_PATH, String(process.pid));

  const release = () => {
    try {
      if (fs.readFileSync(LOCK_PATH, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(LOCK_PATH);
      }
    } catch {
      // Already gone — nothing to clean up.
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}
