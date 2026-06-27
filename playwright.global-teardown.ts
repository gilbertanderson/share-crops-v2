import fs from 'node:fs';
import path from 'node:path';

const PID_FILE = path.join('.playwright', 'firebase-emulator.pid');

export default async function globalTeardown() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  fs.unlinkSync(PID_FILE);
  if (!Number.isFinite(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already stopped
    }
  }
}
