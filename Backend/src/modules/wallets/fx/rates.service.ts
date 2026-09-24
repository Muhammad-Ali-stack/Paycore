import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../../config/app-config';
import { SUPPORTED_CURRENCIES } from '../../../common/money/money';
import { RedisService } from '../../../common/redis/redis.service';
import { applySpread, crossRate, formatRate, parseRate } from './fx.math';

export const RATE_PROVIDER = Symbol('RATE_PROVIDER');

/** Port to a market-data feed. Returns decimal strings: units of each currency per 1 USD. */
export interface RateProvider {
  usdRates(): Promise<Record<Currency, string>>;
}

@Injectable()
export class SimulatedRateProvider implements RateProvider {
  async usdRates(): Promise<Record<Currency, string>> {
    return { USD: '1', PKR: '278.50', AED: '3.6725' };
  }
}

const CACHE_KEY = 'fx:rates:usd:v1';

@Injectable()
export class RatesService {
  constructor(
    @Inject(RATE_PROVIDER) private readonly provider: RateProvider,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    @InjectPinoLogger(RatesService.name) private readonly logger: PinoLogger,
  ) {}

  /** USD-based rates, served from Redis; falls back to the provider if Redis is unavailable. */
  async usdRates(): Promise<Record<Currency, bigint>> {
    let raw: Record<Currency, string> | null = null;
    try {
      const cached = await this.redis.get(CACHE_KEY);
      if (cached) raw = JSON.parse(cached) as Record<Currency, string>;
    } catch (err) {
      this.logger.warn({ err }, 'FX rate cache read failed; using provider');
    }
    if (!raw) {
      raw = await this.provider.usdRates();
      try {
        await this.redis.set(CACHE_KEY, JSON.stringify(raw), 'EX', this.config.get('FX_RATE_CACHE_TTL_SECONDS'));
      } catch (err) {
        this.logger.warn({ err }, 'FX rate cache write failed');
      }
    }
    const rates = {} as Record<Currency, bigint>;
    for (const c of SUPPORTED_CURRENCIES) {
      const value = raw[c];
      if (!value) throw new Error(`Missing FX rate for ${c}`);
      rates[c] = parseRate(value);
    }
    return rates;
  }

  async midRate(from: Currency, to: Currency): Promise<bigint> {
    const rates = await this.usdRates();
    return crossRate(rates[from], rates[to]);
  }

  async table() {
    const rates = await this.usdRates();
    const spread = this.config.get('FX_SPREAD_BPS');
    const pairs = [];
    for (const from of SUPPORTED_CURRENCIES) {
      for (const to of SUPPORTED_CURRENCIES) {
        if (from === to) continue;
        const mid = crossRate(rates[from], rates[to]);
        pairs.push({ from, to, midRate: formatRate(mid), customerRate: formatRate(applySpread(mid, spread)) });
      }
    }
    return { spreadBps: spread, feeBps: this.config.get('FX_FEE_BPS'), pairs };
  }
}
