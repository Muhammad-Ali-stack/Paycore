import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Throwaway PostgreSQL cluster for integration tests, started from a native PostgreSQL
 * installation (no Docker). Set PG_BIN to the folder containing initdb/pg_ctl if it is not
 * on PATH or in a standard install location.
 */
export const STATE_FILE = join(__dirname, '.pg-state.json');

export interface PgState {
  bin: string;
  dataDir: string;
  port: number;
  databaseUrl: string;
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

export function findPgBin(): string {
  const candidates = [
    process.env.PG_BIN,
    ...['17', '16', '15', '14'].map((v) => `C:\\Program Files\\PostgreSQL\\${v}\\bin`),
    ...['17', '16', '15', '14'].map((v) => `/usr/lib/postgresql/${v}/bin`),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ].filter((c): c is string => !!c);
  for (const dir of candidates) {
    if (existsSync(join(dir, exe('initdb'))) && existsSync(join(dir, exe('pg_ctl')))) return dir;
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['initdb'], { encoding: 'utf8' });
  const found = which.stdout?.split(/\r?\n/)[0]?.trim();
  if (found) return join(found, '..');
  throw new Error('PostgreSQL binaries not found. Install PostgreSQL 14+ or set PG_BIN to its bin directory.');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

export async function startPostgres(): Promise<PgState> {
  const bin = findPgBin();
  const dataDir = mkdtempSync(join(tmpdir(), 'paycore-pg-'));
  const port = await freePort();
  // stdio must be 'ignore': pg_ctl hands its handles to the long-lived server process, so a
  // piped stdout would never close and the synchronous call would hang (notably on Windows).
  // timezone=UTC mirrors Supabase: `DEFAULT now()` on timestamp(3) columns stores session-local wall
  // time, so a non-UTC session would skew DB-defaulted timestamps against app-written (UTC) ones.
  const run = (name: string, args: string[]) =>
    execFileSync(join(bin, exe(name)), args, { stdio: 'ignore', timeout: 120_000 });

  run('initdb', ['-D', dataDir, '-U', 'paycore', '--auth=trust', '-E', 'UTF8', '--no-locale']);
  run('pg_ctl', [
    '-D', dataDir,
    '-l', join(dataDir, 'server.log'),
    '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200 -c timezone=UTC -c log_timezone=UTC`,
    '-w',
    'start',
  ]);
  run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'paycore', '-d', 'postgres', '-c', 'CREATE DATABASE paycore_test']);

  const state: PgState = {
    bin,
    dataDir,
    port,
    databaseUrl: `postgresql://paycore@127.0.0.1:${port}/paycore_test?schema=public&connection_limit=40&pool_timeout=30`,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  return state;
}

export function readState(): PgState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as PgState;
}

export function stopPostgres(): void {
  if (!existsSync(STATE_FILE)) return;
  const state = readState();
  spawnSync(join(state.bin, exe('pg_ctl')), ['-D', state.dataDir, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
  rmSync(state.dataDir, { recursive: true, force: true });
  rmSync(STATE_FILE, { force: true });
}
