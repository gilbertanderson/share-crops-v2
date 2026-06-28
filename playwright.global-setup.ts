import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PID_FILE = path.join('.playwright', 'firebase-emulator.pid');
const EMULATOR_HOST = '127.0.0.1:9099';

async function waitForEmulator(maxMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://${EMULATOR_HOST}/`);
      if (res.ok || res.status === 404) return;
    } catch {
      // emulator still starting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Firebase Auth emulator did not start on 127.0.0.1:9099');
}

export default async function globalSetup() {
  fs.mkdirSync('.playwright', { recursive: true });

  let child: ChildProcess;
  try {
    child = spawn(
      'npx',
      ['-y', 'firebase-tools@latest', 'emulators:start', '--only', 'auth', '--project', 'demo-share-crops'],
      { detached: true, stdio: 'ignore' },
    );
  } catch (err) {
    throw new Error(`Failed to spawn Firebase emulator: ${err}`);
  }

  child.unref();
  if (child.pid) fs.writeFileSync(PID_FILE, String(child.pid));

  await waitForEmulator();
}
