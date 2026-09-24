export const addSeconds = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);

/** Start of the UTC day containing `date`. Limits are evaluated in UTC calendar windows. */
export const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const startOfUtcMonth = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
