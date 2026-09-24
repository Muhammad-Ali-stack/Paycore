import { DomainError } from '../errors/domain-error';

/** One entry of an entity's `timeline` JSON column. */
export interface TimelineEntry {
  status: string;
  at: string;
  reason?: string;
}

/**
 * An explicit transition table. Every status change in phase 2 goes through `assert`, so an
 * illegal transition (e.g. FAILED -> SUCCEEDED from an out-of-order webhook) can never be applied
 * blindly: it throws INVALID_STATE_TRANSITION and the caller decides how to compensate or flag.
 */
export class StateMachine<S extends string> {
  constructor(
    readonly name: string,
    private readonly table: Readonly<Record<S, readonly S[]>>,
  ) {}

  get states(): S[] {
    return Object.keys(this.table) as S[];
  }

  targets(from: S): readonly S[] {
    return this.table[from] ?? [];
  }

  can(from: S, to: S): boolean {
    return this.targets(from).includes(to);
  }

  isTerminal(state: S): boolean {
    return this.targets(state).length === 0;
  }

  assert(from: S, to: S): void {
    if (!this.can(from, to)) {
      throw new DomainError('INVALID_STATE_TRANSITION', `${this.name} cannot move from ${from} to ${to}`, {
        entity: this.name,
        from,
        to,
      });
    }
  }
}

export function readTimeline(json: unknown): TimelineEntry[] {
  return Array.isArray(json) ? (json as TimelineEntry[]) : [];
}

export function timelineEntry(status: string, reason?: string, at: Date = new Date()): TimelineEntry {
  return reason ? { status, at: at.toISOString(), reason } : { status, at: at.toISOString() };
}

/** Returns a new timeline with the entry appended (the stored JSON is never mutated in place). */
export function appendTimeline(json: unknown, status: string, reason?: string, at: Date = new Date()): TimelineEntry[] {
  return [...readTimeline(json), timelineEntry(status, reason, at)];
}
