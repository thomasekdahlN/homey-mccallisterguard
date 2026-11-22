'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import type { GuardSettings, Mode } from './types';
import { t } from './i18n';

/** Minimum interval between log/timeline entries for the same source key. */
const DEDUP_WINDOW_MS = 15 * 60 * 1000;

/** Pauses before each retry of a critical message that could not be delivered. */
const CRITICAL_RETRY_DELAYS_MS = [2_000, 5_000];

/**
 * info     — status the user can read later (mode changes, who came home).
 * warning  — needs attention but nothing is happening right now (open door at arming, offline sensor).
 * critical — something is happening now (deterrence, alarm). Never filtered, never de-duplicated,
 *            retried on failure and mirrored to the `critical_notification` flow trigger.
 */
export type NotificationLevel = 'info' | 'warning' | 'critical';

export type CriticalKind = 'deterrence' | 'perimeter_alarm' | 'alarm' | 'reminder';

/** Optional context for flow tokens on critical messages. */
export interface NotificationMeta {
  kind?: CriticalKind;
  zone?: string;
  sensor?: string;
}

const LEVEL_PREFIX: Record<NotificationLevel, string> = { info: '', warning: '⚠️ ', critical: '🚨 ' };
const LEADING_EMOJI_RE = /^(?:🚨|⚠️|ℹ️)\s*/u;

/**
 * Homey Timeline notifications. The SDK only accepts an excerpt (no priority, sound or image), so
 * "critical" is expressed through the text (🚨 + highlighted keywords), guaranteed delivery and a
 * flow trigger the user can route to a channel that can truly wake them.
 */
export default class Notifier {

  /** Last-notification timestamps per dedup key. */
  private readonly debounce = new Map<string, number>();

  constructor(
    private readonly homey: Homey,
    private readonly eventLog?: EventLog,
    private readonly getSettings?: () => GuardSettings,
  ) { }

  /**
   * Posts to the Homey Timeline. Fire-and-forget: a failed notification is never fatal, but a failed
   * critical one is retried and reported in the event log.
   */
  timeline(excerpt: string, level: NotificationLevel = 'info', meta: NotificationMeta = {}): void {
    if (level === 'info' && this.getSettings?.().timeline_critical_only === true) return;
    const text = Notifier.format(excerpt, level);

    if (level !== 'critical') {
      this.homey.notifications.createNotification({ excerpt: text }).catch(() => { /* best-effort */ });
      return;
    }
    this.sendCritical(text, 0);
    this.fireCriticalTrigger(text, meta);
  }

  /** Normalises the leading emoji so a message never shows two (some texts already contain one). */
  static format(excerpt: string, level: NotificationLevel): string {
    if (level === 'info') return excerpt;
    return `${LEVEL_PREFIX[level]}${excerpt.replace(LEADING_EMOJI_RE, '')}`;
  }

  /**
   * Returns true if an entry for the given key should be emitted now. The same source is allowed at
   * most once per 15 minutes (e.g. presence + door events disarming at the same time).
   * Only for info-level messages — critical messages must never be passed through this.
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

  private sendCritical(text: string, attempt: number): void {
    this.homey.notifications.createNotification({ excerpt: text }).catch((err: Error) => {
      const delay = CRITICAL_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        this.eventLog?.add('warning', t(this.homey, 'app.critical_notification_failed', { error: err?.message ?? String(err) }));
        return;
      }
      this.homey.setTimeout(() => this.sendCritical(text, attempt + 1), delay);
    });
  }

  private fireCriticalTrigger(text: string, meta: NotificationMeta): void {
    try {
      this.homey.flow.getTriggerCard('critical_notification').trigger({
        message: text.replace(/\*\*/g, ''),
        kind: meta.kind ?? '',
        zone: meta.zone ?? '',
        sensor: meta.sensor ?? '',
        timestamp: new Date().toISOString(),
      }).catch(() => { /* best-effort */ });
    } catch { /* best-effort */ }
  }

}
