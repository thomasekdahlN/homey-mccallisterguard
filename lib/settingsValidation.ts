'use strict';

import { URL } from 'url';
import { normalizeHHMM } from './Schedule';
import { DEFAULT_SETTINGS, GuardSettings } from './types';

/** Inclusive numeric bounds for every numeric setting. Values outside are clamped. */
const NUMBER_BOUNDS: Partial<Record<keyof GuardSettings, [min: number, max: number]>> = {
  sunset_offset: [-360, 360],
  random_min: [1, 600],
  random_max: [1, 600],
  deterrence_delay: [0, 3600],
  exit_delay: [0, 600],
  entry_delay: [0, 600],
  escalation_minutes: [0, 120],
  blink_on: [1, 600],
  blink_off: [1, 600],
  alarm_blink_on: [1, 600],
  alarm_blink_off: [1, 600],
  camera_alarm_burst: [0, 50],
  camera_motion_burst: [0, 50],
  snapshot_max_count: [1, 1000],
};

const TIME_KEYS: (keyof GuardSettings)[] = ['bedtime', 'armed_perimeter_on', 'armed_perimeter_off'];
const STRING_ARRAY_KEYS: (keyof GuardSettings)[] = ['perimeter_sensors', 'perimeter_sensors_seen', 'entry_delay_sensors', 'arming_check_excluded', 'kevin_lights'];
const BOOLEAN_KEYS: (keyof GuardSettings)[] = ['camera_motion_enabled', 'armed_perimeter_auto'];
const RECORD_KEYS: (keyof GuardSettings)[] = ['zone_matrix', 'kevin_zones', 'camera_alarm_cams', 'camera_motion_cams', 'camera_snapshot_urls'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Only http(s) URLs without embedded credentials are accepted as snapshot endpoints. */
export function isSafeSnapshotUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * Whitelists and sanitises a (possibly untrusted) settings patch.
 * Unknown keys and wrongly typed values are dropped; numbers are clamped to sane bounds.
 * Invalid values never overwrite the current setting.
 */
export function sanitizeSettingsPatch(patch: unknown): Partial<GuardSettings> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(patch)) return out;

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GuardSettings)[]) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];

    const bounds = NUMBER_BOUNDS[key];
    if (bounds) {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) continue;
      out[key] = Math.min(bounds[1], Math.max(bounds[0], Math.round(n)));
    } else if (TIME_KEYS.includes(key)) {
      const normalized = normalizeHHMM(value, '');
      if (normalized) out[key] = normalized;
    } else if (STRING_ARRAY_KEYS.includes(key)) {
      if (Array.isArray(value)) out[key] = value.filter((v) => typeof v === 'string');
    } else if (BOOLEAN_KEYS.includes(key)) {
      if (typeof value === 'boolean') out[key] = value;
    } else if (RECORD_KEYS.includes(key)) {
      if (!isPlainObject(value)) continue;
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (key === 'zone_matrix') {
          if (typeof v === 'string') clean[k] = v;
        } else if (key === 'camera_snapshot_urls') {
          if (v === '' || v === null) continue;
          if (isSafeSnapshotUrl(v)) clean[k] = v;
        } else if (typeof v === 'boolean') {
          clean[k] = v;
        }
      }
      out[key] = clean;
    }
  }

  // random_max must never be below random_min.
  if (typeof out.random_min === 'number' && typeof out.random_max === 'number' && out.random_max < out.random_min) {
    out.random_max = out.random_min;
  }
  return out as Partial<GuardSettings>;
}

/** Removes credentials from a URL so it can be logged safely. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return '[invalid-url]';
  }
}
