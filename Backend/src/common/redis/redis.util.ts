/** Parse `maxmemory_policy` out of an `INFO memory` reply. */
export function parseMaxmemoryPolicy(info: string): string | null {
  const match = /^maxmemory_policy:(\S+)/m.exec(info);
  return match?.[1] ?? null;
}
