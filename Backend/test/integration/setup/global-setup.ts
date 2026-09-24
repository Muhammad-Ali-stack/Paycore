import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { startPostgres, stopPostgres } from './native-postgres';

export default async function globalSetup(): Promise<void> {
  stopPostgres(); // clean up a cluster left behind by an aborted run
  const state = await startPostgres();
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..', '..', '..'),
    env: { ...process.env, DATABASE_URL: state.databaseUrl, DIRECT_URL: state.databaseUrl },
    stdio: 'pipe',
  });
}
