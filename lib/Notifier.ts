'use strict';

import type Homey from 'homey/lib/Homey';
import type { Mode } from './types';
import { t } from './i18n';

/** Minimum interval between log/timeline entries for the same source key. */
const DEDUP_WINDOW_MS = 15 * 60 * 1000;

/** Homey Timeline notifications plus de-duplication of repeated notifications. */
export default class Notifier {

  /** Last-notification timestamps per dedup key. */
  private readonly debounce = new Map<string, number>();

  constructor(private readonly homey: Homey) { }

  /** Posts to the Homey Timeline (fire-and-forget; a failed notification is never fatal). */
  timeline(excerpt: string): void {
    this.homey.notifications.createNotification({ excerpt }).catch(() => { /* best-effort */ });
  }

  /**
   * Returns true if an entry for the given key should be emitted now. The same source is allowed at
   * most once per 15 minutes (e.g. presence + door events disarming at the same time).
   */
  shouldNotify(key: string): boolean {
    const last = this.debounce.get(key);
    const now = Date.now();
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
    this.debounce.set(key, now);
    return true;
  }

  modeLabel(mode: Mode): string {
    if (mode === 'off') return t(this.homey, 'app.mode_label_off');
    if (mode === 'disarmed') return t(this.homey, 'app.mode_label_disarmed');
    if (mode === 'armed') return t(this.homey, 'app.mode_label_armed');
    if (mode === 'armed_perimeter') return t(this.homey, 'app.mode_label_armed_perimeter');
    if (mode === 'perimeter_alarm') return t(this.homey, 'app.mode_label_perimeter_alarm');
    if (mode === 'deterrence') return t(this.homey, 'app.mode_label_deterrence');
    if (mode === 'alarm') return t(this.homey, 'app.mode_label_alarm');
    return String(mode);
  }

}
