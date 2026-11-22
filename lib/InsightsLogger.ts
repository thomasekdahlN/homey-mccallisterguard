'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import type { Mode } from './types';
import { t } from './i18n';
import type { MessageKey } from './i18n';

/** Minimal shape of a Homey Insights log (see ManagerInsights.createLog). */
interface InsightsLogLike { createEntry(value: number | boolean): Promise<unknown> }

interface LogSpec {
  id: string;
  titleKey: MessageKey;
  type: 'number' | 'boolean';
  units?: string;
  decimals?: number;
}

/** Insights log ids must be lowercase alphanumeric. */
const LOGS = {
  guardActive: { id: 'guardactive', titleKey: 'insight.guard_active', type: 'boolean' },
  alertActive: { id: 'alertactive', titleKey: 'insight.alert_active', type: 'boolean' },
  disarmTime: {
    id: 'disarmtime', titleKey: 'insight.disarm_time', type: 'number', units: 's', decimals: 1,
  },
  offlineSensors: {
    id: 'offlinesensors', titleKey: 'insight.offline_sensors', type: 'number', decimals: 0,
  },
} as const satisfies Record<string, LogSpec>;

const ALERT_MODES: readonly Mode[] = ['deterrence', 'perimeter_alarm', 'alarm'];

/**
 * Long-term history in Homey Insights (the event log only keeps 14 days). Pure side effect: every
 * write is best-effort, so a failing Insights manager can never disturb the guard itself.
 */
export default class InsightsLogger {

  private readonly logs = new Map<string, Promise<InsightsLogLike | null>>();
  private readonly lastBoolean = new Map<string, boolean>();

  constructor(
    private readonly homey: Homey,
    private readonly eventLog: EventLog,
  ) { }

  /** Creates the logs (if missing) and records the mode the app starts in. */
  start(currentMode: Mode): void {
    for (const spec of Object.values(LOGS)) this.logs.set(spec.id, this.openLog(spec));
    this.recordMode(currentMode);
  }

  /** Guard active = anything but Off/Home; an alarm means the guard is still armed, not disarmed. */
  recordMode(mode: Mode): void {
    this.writeBoolean(LOGS.guardActive.id, mode !== 'off' && mode !== 'disarmed');
    this.writeBoolean(LOGS.alertActive.id, ALERT_MODES.includes(mode));
  }

  /** Seconds between the start of an entry delay and it being cancelled (someone disarmed in time). */
  recordDisarmTime(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.write(LOGS.disarmTime.id, Math.round(seconds * 10) / 10);
  }

  /** Number of sensors that failed the health check (0 = all sensors reachable). */
  recordOfflineSensors(count: number): void {
    if (!Number.isFinite(count) || count < 0) return;
    this.write(LOGS.offlineSensors.id, Math.round(count));
  }

  /** Booleans are written on change only, so the graph shows transitions rather than noise. */
  private writeBoolean(id: string, value: boolean): void {
    if (this.lastBoolean.get(id) === value) return;
    this.lastBoolean.set(id, value);
    this.write(id, value);
  }

  private write(id: string, value: number | boolean): void {
    const pending = this.logs.get(id);
    if (!pending) return;
    pending
      .then((log) => log?.createEntry(value))
      .catch(() => { /* best-effort */ });
  }

  private async openLog(spec: LogSpec): Promise<InsightsLogLike | null> {
    const { insights } = this.homey;
    try {
      return await insights.getLog(spec.id);
    } catch {
      // Not created yet — fall through.
    }
    try {
      return await insights.createLog(spec.id, {
        title: t(this.homey, spec.titleKey),
        type: spec.type,
        units: spec.units,
        decimals: spec.decimals,
      });
    } catch (err) {
      this.eventLog.add('warning', t(this.homey, 'insight.log_failed', { id: spec.id, error: (err as Error).message }));
      return null;
    }
  }

}
