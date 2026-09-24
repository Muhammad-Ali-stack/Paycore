import { stopPostgres } from './native-postgres';

export default async function globalTeardown(): Promise<void> {
  stopPostgres();
}
