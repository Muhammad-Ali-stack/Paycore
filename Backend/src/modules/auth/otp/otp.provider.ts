import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

/** Port for SMS delivery. Swap the simulated adapter for a real SMS gateway in production. */
export interface OtpProvider {
  send(phone: string, message: string): Promise<void>;
}

const maskPhone = (phone: string): string => `${phone.slice(0, 4)}****${phone.slice(-3)}`;

/** Simulated SMS gateway: never sends anything; keeps an in-memory outbox for dev and tests. */
@Injectable()
export class SimulatedOtpProvider implements OtpProvider {
  private readonly outbox = new Map<string, string>();

  constructor(@InjectPinoLogger(SimulatedOtpProvider.name) private readonly logger: PinoLogger) {}

  async send(phone: string, message: string): Promise<void> {
    this.outbox.set(phone, message);
    this.logger.info({ to: maskPhone(phone) }, 'Simulated SMS dispatched');
  }

  /** Test helper: last message sent to `phone`. */
  lastMessage(phone: string): string | undefined {
    return this.outbox.get(phone);
  }
}
