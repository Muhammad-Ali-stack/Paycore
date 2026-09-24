/**
 * Stable per-browser device identifier for /auth/login (NOT a secret or token).
 * Stored in localStorage so "Devices & sessions" can recognise this browser.
 */
export function getDeviceId(): string {
  const KEY = 'pc.deviceId';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `web-ephemeral-${Date.now().toString(36)}`;
  }
}

export function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Web';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Web';
  return `${browser} on ${os}`;
}
