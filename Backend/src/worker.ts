import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { WorkerHostModule } from './modules/jobs/jobs.module';

/**
 * Worker process: BullMQ consumers for repeatable jobs (outbox relay, timeouts, expiry, T+N
 * settlement, daily reconciliation) and domain events. No HTTP server. Run with
 * `npm run start:worker` alongside the API (`npm start`). Workers scale horizontally; every job
 * is safe to run concurrently (SKIP LOCKED claims, compare-and-set transitions, unique keys).
 */
@Module({ imports: [AppModule, WorkerHostModule] })
export class WorkerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
}

if (require.main === module) void bootstrap();
