'use strict';

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Parses "HH:MM" into minutes since midnight, or null if the string is not a valid 24h time. */
export function parseHHMM(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = HHMM_RE.exec(value.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Normalises a valid "HH:MM" to zero-padded form, otherwise returns the fallback. */
export function normalizeHHMM(value: unknown, fallback: string): string {
  const mins = parseHHMM(value);
  if (mins === null) return fallback;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * True when `now` lies inside [on, off). Windows crossing midnight (on > off) are supported.
 * Equal start and end means an empty window.
 */
export function isInWindow(nowMinutes: number, onMinutes: number, offMinutes: number): boolean {
  if (onMinutes === offMinutes) return false;
  return onMinutes > offMinutes
    ? (nowMinutes >= onMinutes || nowMinutes < offMinutes)
    : (nowMinutes >= onMinutes && nowMinutes < offMinutes);
}

/** Convenience wrapper working on "HH:MM" strings with the app defaults as fallback. */
export function isInWindowHHMM(nowHHMM: string, on: string, off: string): boolean {
  const now = parseHHMM(nowHHMM);
  if (now === null) return false;
  return isInWindow(now, parseHHMM(on) ?? 22 * 60, parseHHMM(off) ?? 6 * 60);
}

/** Minutes since local midnight in the given IANA time zone. */
export function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).formatToParts(date);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return h * 60 + m;
}

/**
 * True when the armed_perimeter auto-schedule is enabled and `now` falls inside the configured window.
 * Evaluated in the given time zone: Homey Pro runs Node.js in UTC.
 */
export function isArmedPerimeterWindowActive(
  settings: { armed_perimeter_auto: boolean; armed_perimeter_on: string; armed_perimeter_off: string },
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!settings.armed_perimeter_auto) return false;
  const on = parseHHMM(settings.armed_perimeter_on) ?? 22 * 60;
  const off = parseHHMM(settings.armed_perimeter_off) ?? 6 * 60;
  return isInWindow(localMinutes(now, timeZone), on, off);
}
