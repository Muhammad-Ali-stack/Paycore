import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { AppModule } from '../../src/app.module';
import { JOBS, JobRegistry, jobSchedules } from '../../src/common/queue/job-registry';
import { RedisService } from '../../src/common/redis/redis.service';
import { AppConfig } from '../../src/config/app-config';
import { WorkerHostModule } from '../../src/modules/jobs/jobs.module';
import { expectHealthyBooks } from './helpers/phase2';
import { TestContext } from './helpers/app';

/**
 * The worker process graph (AppModule + WorkerHostModule) boots, and every repeatable job is
 * registered and runs. With QUEUE_DRIVER=inline (tests) the BullMQ host stays idle; the BullMQ
 * path itself needs a real Redis and is not exercised here.
 */
describe('Worker process and repeatable jobs (integration)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, WorkerHostModule] })
      .overrideProvider(RedisService)
      .useValue(new RedisMock())
      .compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    await app.init();
  });
  afterAll(async () => {
    await expectHealthyBooks({ app } as TestContext);
    await app.close();
  });

  it('schedules every job (interval or UTC cron)', () => {
    const schedules = jobSchedules(app.get(AppConfig));
    expect(schedules.map((s) => s.name).sort()).toEqual(Object.values(JOBS).sort());
    expect(schedules.find((s) => s.name === JOBS.SETTLEMENT_BATCH)).toMatchObject({ cron: '0 2 * * *' });
    expect(schedules.find((s) => s.name === JOBS.RECONCILIATION)).toMatchObject({ cron: '30 3 * * *' });
    expect(schedules.find((s) => s.name === JOBS.OUTBOX_RELAY)?.every).toBeGreaterThan(0);
  });

  it('runs each registered job handler', async () => {
    const jobs = app.get(JobRegistry);
    for (const name of Object.values(JOBS)) expect(jobs.has(name)).toBe(true);
    expect(await jobs.run(JOBS.OUTBOX_RELAY)).toMatchObject({ failed: 0 });
    expect(await jobs.run(JOBS.PAYMENT_TIMEOUTS)).toMatchObject({ payments: expect.any(Object), funding: expect.any(Object) });
    expect(await jobs.run(JOBS.REQUEST_EXPIRY)).toMatchObject({ expired: expect.any(Number) });
    expect(await jobs.run(JOBS.QUOTE_QR_EXPIRY)).toMatchObject({ fxQuotes: expect.any(Number), qrCodes: expect.any(Number) });
    expect(await jobs.run(JOBS.SETTLEMENT_BATCH, { asOf: new Date().toISOString() })).toMatchObject({ settlements: expect.any(Number) });
    expect(await jobs.run(JOBS.RECONCILIATION, { date: '2001-01-01' })).toMatchObject({ mismatches: 0 });
    await expect(jobs.run('no-such-job')).rejects.toThrow(/No handler/);
  });
});
