'use strict';

import type Homey from 'homey/lib/Homey';
import type DeterrenceEngine from './DeterrenceEngine';
import type EscalationManager from './EscalationManager';
import type EventLog from './EventLog';
import type MediaCaster from './MediaCaster';
import type Notifier from './Notifier';
import type SnapshotRelay from './SnapshotRelay';
import type StateMachine from './StateMachine';
import type Tasks from './Tasks';
import type ZoneDirectory from './ZoneDirectory';
import { AlarmType, GuardSettings, SETTINGS_KEYS } from './types';
import { t } from './i18n';

export type ArmedMode = 'armed_perimeter' | 'armed';
export type SensorKind = 'motion' | 'contact';

/** What triggered the current alert — used for flow-card tokens and conditions. */
export interface AlarmContext {
  zoneId: string;
  zoneName: string;
  deviceId: string;
  deviceName: string;
  sensorType: string;
  alarmType: AlarmType;
}

const TEST_DURATION_MS = 15_000;

/**
 * Owns the lifecycle of an alert: deterrence → full alarm, the soft perimeter alert, stopping, and
 * the test modes. Mode *guards* (who may change the mode, and when) live in ModeController.
 */
export default class AlarmController {

  private context: AlarmContext | null = null;
  private storedPreviousArmedMode: ArmedMode | null = null;
  private deterrenceTimer: NodeJS.Timeout | null = null;
  private testStopTimer: NodeJS.Timeout | null = null;
  /** True while enterDeterrence() is awaiting name lookups — stops concurrent sensors from entering twice. */
  private enteringDeterrence = false;
  /** Timestamp of the most recent alarm end, used to suppress auto re-activation of the perimeter. */
  private lastStoppedAt: number | null = null;

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
    private readonly stateMachine: StateMachine,
    private readonly deterrence: DeterrenceEngine,
    private readonly escalation: EscalationManager,
    private readonly media: MediaCaster,
    private readonly notifier: Notifier,
    private readonly zones: ZoneDirectory,
    private readonly snapshots: SnapshotRelay,
    private readonly tasks: Tasks,
    private readonly getSettings: () => GuardSettings,
  ) { }

  /** Restores persisted state and subscribes to deterrence events. */
  start(): void {
    const stored = this.homey.settings.get(SETTINGS_KEYS.PREVIOUS_ARMED_MODE);
    this.storedPreviousArmedMode = stored === 'armed' || stored === 'armed_perimeter' ? stored : null;
    this.deterrence.onDeterrenceStarted((reactionZoneId, motionZoneId) => {
      this.notifier.timeline(t(this.homey, 'app.deterrence_started_timeline', {
        reaction: this.zones.labelOf(reactionZoneId),
        motion: this.zones.labelOf(motionZoneId),
      }));
    });
  }

  /** The armed mode to return to when an alert ends. Persisted so it survives an app restart. */
  private get previousArmedMode(): ArmedMode | null {
    return this.storedPreviousArmedMode;
  }

  private set previousArmedMode(value: ArmedMode | null) {
    this.storedPreviousArmedMode = value;
    try { this.homey.settings.set(SETTINGS_KEYS.PREVIOUS_ARMED_MODE, value); } catch { /* best-effort */ }
  }

  getContext(): AlarmContext | null {
    return this.context;
  }

  isTestActive(): boolean {
    return this.testStopTimer !== null;
  }

  isAlarmActive(): boolean {
    return this.stateMachine.getMode() === 'alarm';
  }

  /** True if an alarm ended less than `withinMs` ago. */
  stoppedWithin(withinMs: number): boolean {
    return this.lastStoppedAt !== null && (Date.now() - this.lastStoppedAt) < withinMs;
  }

  /**
   * The mode is persisted but timers and alert context are not. If the app was restarted (crash,
   * update) while deterrence/alarm was active, fall back to the armed mode it came from instead of
   * staying stuck in a state that can no longer escalate or be recovered.
   */
  async recoverInterruptedState(): Promise<void> {
    const mode = this.stateMachine.getMode();
    if (mode !== 'deterrence' && mode !== 'alarm' && mode !== 'perimeter_alarm') return;
    const restored: ArmedMode = this.previousArmedMode ?? (mode === 'perimeter_alarm' ? 'armed_perimeter' : 'armed');
    this.log.add('warning', t(this.homey, 'app.state_recovered', { mode, restored }));
    this.previousArmedMode = null;
    await this.stateMachine.setMode(restored);
  }

  /**
   * Enter deterrence mode: blink lights in the reaction zone and start the escalation timer.
   * If already in deterrence, just update the active reaction zone (intruder moved).
   * If already in alarm, ignore (already at full alert).
   */
  async enterDeterrence(zoneId: string, deviceId: string, sensorType: SensorKind, alarmType: AlarmType): Promise<void> {
    const mode = this.stateMachine.getMode();
    // `enteringDeterrence` closes the window between the mode check and setMode('deterrence'):
    // several sensors firing in the same second must not start the alert (and its timer) twice.
    if (mode === 'deterrence' || this.enteringDeterrence) {
      // Intruder moved — update reaction zone without restarting the escalation timer.
      await this.deterrence.handleMotion(zoneId);
      return;
    }
    if (mode !== 'armed' && mode !== 'armed_perimeter') return;

    this.enteringDeterrence = true;
    try {
      this.previousArmedMode = mode;
      const { zoneName, deviceName } = await this.zones.resolveNames(zoneId, deviceId);
      // Disarmed (or otherwise changed) while the names were being resolved.
      const afterLookup = this.stateMachine.getMode();
      if (afterLookup !== 'armed' && afterLookup !== 'armed_perimeter') return;

      this.context = {
        zoneId, zoneName, deviceId, deviceName, sensorType, alarmType,
      };
      const alarmLabel = alarmType === 'perimeter' ? '**Perimeter**' : '**Alarm**';
      this.log.add('alarm', t(this.homey, 'app.deterrence_alarm_log', { label: alarmLabel, zone: zoneName, device: deviceName }), zoneId, deviceId);
      this.notifier.timeline(t(this.homey, 'app.deterrence_timeline', { device: deviceName, zone: zoneName }));

      await this.stateMachine.setMode('deterrence');

      // After escalation_minutes, auto-escalate from deterrence to alarm.
      const escalationMs = this.getSettings().escalation_minutes * 60_000;
      this.clearDeterrenceTimer();
      this.deterrenceTimer = this.homey.setTimeout(this.tasks.safe(async () => {
        this.deterrenceTimer = null;
        if (this.stateMachine.getMode() === 'deterrence') await this.enterAlarm();
      }), escalationMs);

      const baseTokens: Record<string, unknown> = {
        zone: zoneName,
        sensor: deviceName,
        sensor_type: sensorType,
        mode,
        timestamp: new Date().toISOString(),
      };
      const snapshot = this.snapshots.getFresh();
      if (snapshot !== null) baseTokens.snapshot = snapshot;
      // Fire type-specific trigger: perimeter alarms → alarm_perimeter_triggered, away alarms → alarm_triggered.
      if (alarmType === 'perimeter') {
        try { await this.homey.flow.getTriggerCard('alarm_perimeter_triggered').trigger(baseTokens, { zoneId }); } catch { /* best-effort */ }
      } else {
        try { await this.homey.flow.getTriggerCard('alarm_triggered').trigger(baseTokens, { zoneId, sensorType }); } catch { /* best-effort */ }
      }
    } finally {
      this.enteringDeterrence = false;
    }

    await this.deterrence.handleMotion(zoneId);
  }

  /**
   * Triggered by a perimeter sensor in armed_perimeter mode.
   *
   * Design intent: armed_perimeter is used when occupants are HOME (sleeping).
   * Automatically activating lights/sirens/deterrence would be disruptive and
   * unnecessary — the occupant is present and will react. We therefore:
   *   1. Transition to perimeter_alarm mode (soft alert state).
   *   2. Log the event to the internal event log.
   *   3. Send a push notification with sensor + zone detail.
   *   4. Fire the alarm_perimeter_triggered flow card so the user's own
   *      Homey flows can react (e.g. play a chime, send Pushover, turn on
   *      a hall light, etc.).
   *
   * No deterrence blink, no sirens, no escalation timer. The user builds
   * their own flows to react. Subsequent triggers are ignored until the
   * alert is dismissed (mode returns to armed_perimeter or disarmed).
   */
  async enterPerimeterAlarm(zoneId: string, deviceId: string, sensorType: SensorKind): Promise<void> {
    // Already in perimeter_alarm — ignore duplicate triggers.
    if (this.stateMachine.getMode() === 'perimeter_alarm') return;

    const { zoneName, deviceName } = await this.zones.resolveNames(zoneId, deviceId);
    this.log.add('alarm', t(this.homey, 'app.perimeter_sensor_triggered_log', { device: deviceName, zone: zoneName }), zoneId, deviceId);

    this.previousArmedMode = 'armed_perimeter';
    this.context = {
      zoneId, zoneName, deviceId, deviceName, sensorType, alarmType: 'perimeter',
    };

    // Transition to perimeter_alarm — ModeController skips the generic push for this mode.
    await this.stateMachine.setMode('perimeter_alarm');
    // Push the sensor-specific message after the mode is confirmed.
    this.notifier.timeline(t(this.homey, 'app.perimeter_alarm_timeline', { device: deviceName, zone: zoneName }));

    const baseTokens: Record<string, unknown> = {
      zone: zoneName,
      sensor: deviceName,
      sensor_type: sensorType,
      mode: 'armed_perimeter',
      timestamp: new Date().toISOString(),
    };
    const snapshot = this.snapshots.getFresh();
    if (snapshot !== null) baseTokens.snapshot = snapshot;
    try {
      await this.homey.flow.getTriggerCard('alarm_perimeter_triggered').trigger(baseTokens, { zoneId });
    } catch { /* best-effort */ }
  }

  /** Escalate from deterrence to full alarm: stop blinking, strobe all lights + sirens. */
  private async enterAlarm(): Promise<void> {
    const mode = this.stateMachine.getMode();
    if (mode === 'disarmed' || mode === 'alarm') return;
    await this.deterrence.abort('Deterrence escalated to full alarm.');
    await this.stateMachine.setMode('alarm');
    const ctx = this.context;
    const locationMsg = ctx?.zoneName ? t(this.homey, 'app.alarm_triggered_timeline_zone', { zone: ctx.zoneName }) : '';
    this.notifier.timeline(`${t(this.homey, 'app.alarm_triggered_timeline_base')}${locationMsg}${ctx?.deviceName ? ` — ${ctx.deviceName}` : ''}`);
    // Not awaited: starting sirens/strobe must never wait for the user's flows.
    try {
      this.homey.flow.getTriggerCard('alarm_escalated').trigger({
        zone: ctx?.zoneName ?? '',
        sensor: ctx?.deviceName ?? '',
        timestamp: new Date().toISOString(),
      }).catch(() => { /* best-effort */ });
    } catch { /* best-effort */ }
    try {
      await this.escalation.triggerCrisis();
    } catch { /* already logged by EscalationManager — the mode stays 'alarm' so the user can still stop it */ }
  }

  /** User-initiated stop: ends the alert and returns to the armed mode it came from (or disarmed). */
  async stopAlarm(): Promise<void> {
    this.log.add('info', t(this.homey, 'app.alarm_stopped_log'));
    await this.stopEffects('User stopped the alarm.');
    this.alarmStopped(t(this.homey, 'app.alarm_stopped_reason_user'));
    const returnMode = this.previousArmedMode ?? 'disarmed';
    this.previousArmedMode = null;
    this.context = null;
    await this.stateMachine.setMode(returnMode);
  }

  /**
   * Stops every alert effect (timers, strobe, blinking, media) without touching the mode. Used when
   * leaving an alert for another mode and when disarming.
   */
  async stopEffects(reason = 'Alert effects stopped.'): Promise<void> {
    this.clearTestStopTimer();
    this.clearDeterrenceTimer();
    this.stateMachine.cancelEntryDelay();
    await this.escalation.cancel();
    await this.deterrence.abort(reason);
    await this.media.stopAll();
  }

  /** Forgets the alert context and the armed mode to return to. */
  resetContext(): void {
    this.previousArmedMode = null;
    this.context = null;
  }

  /** Fires the stopped trigger/timeline for the current alert and records the stop time. */
  alarmStopped(reason: string): void {
    this.lastStoppedAt = Date.now();
    const ctx = this.context;
    const alarmType = ctx?.alarmType ?? 'intrusion';
    this.notifier.timeline(t(this.homey, alarmType === 'perimeter' ? 'app.perimeter_alarm_stopped_timeline' : 'app.alarm_stopped_timeline'));

    const baseTokens = {
      zone: ctx?.zoneName ?? '',
      sensor: ctx?.deviceName ?? '',
      reason,
    };
    // Fire type-specific stopped trigger: perimeter alarms → alarm_perimeter_stopped, away alarms → alarm_stopped.
    const card = alarmType === 'perimeter' ? 'alarm_perimeter_stopped' : 'alarm_stopped';
    try { this.homey.flow.getTriggerCard(card).trigger(baseTokens).catch(() => { /* best-effort */ }); } catch { /* best-effort */ }
  }

  async testDeterrence(zoneId: string): Promise<void> {
    this.clearTestStopTimer();
    this.clearDeterrenceTimer();
    const seconds = Math.round(TEST_DURATION_MS / 1000);
    this.log.add('info', t(this.homey, 'app.test_deterrence_started', { zone: zoneId, seconds }), zoneId);
    this.rememberArmedModeForTest();
    if (this.stateMachine.getMode() !== 'deterrence') {
      await this.stateMachine.setMode('deterrence');
    }
    await this.deterrence.runDirect(zoneId);
    this.testStopTimer = this.homey.setTimeout(this.tasks.safe(async () => {
      this.testStopTimer = null;
      await this.deterrence.abort('Test finished (auto-stop).');
      await this.media.stopAll();
      const returnMode = this.previousArmedMode ?? 'disarmed';
      this.previousArmedMode = null;
      await this.stateMachine.setMode(returnMode);
    }), TEST_DURATION_MS);
  }

  async testAlarm(): Promise<void> {
    this.clearTestStopTimer();
    this.clearDeterrenceTimer();
    const seconds = Math.round(TEST_DURATION_MS / 1000);
    this.log.add('info', t(this.homey, 'app.test_alarm_started', { seconds }));
    this.rememberArmedModeForTest();
    await this.deterrence.abort('Test alarm — deterrence aborted.');
    await this.stateMachine.setMode('alarm');
    // The test must always end, even if the crisis could not be fully started.
    this.testStopTimer = this.homey.setTimeout(this.tasks.safe(async () => {
      this.testStopTimer = null;
      await this.escalation.cancel();
      await this.media.stopAll();
      this.alarmStopped(t(this.homey, 'app.alarm_stopped_reason_test_auto'));
      const returnMode = this.previousArmedMode ?? 'disarmed';
      this.previousArmedMode = null;
      this.context = null;
      await this.stateMachine.setMode(returnMode);
    }), TEST_DURATION_MS);
    await this.escalation.triggerCrisis();
  }

  /** Remembers the armed mode a test was started from so it can be restored afterwards. */
  private rememberArmedModeForTest(): void {
    const currentMode = this.stateMachine.getMode();
    if (currentMode === 'armed' || currentMode === 'armed_perimeter') {
      this.previousArmedMode = currentMode;
    } else if (currentMode === 'disarmed' || currentMode === 'off') {
      this.previousArmedMode = null;
    }
  }

  private clearTestStopTimer(): void {
    if (this.testStopTimer) {
      this.homey.clearTimeout(this.testStopTimer);
      this.testStopTimer = null;
    }
  }

  private clearDeterrenceTimer(): void {
    if (this.deterrenceTimer) {
      this.homey.clearTimeout(this.deterrenceTimer);
      this.deterrenceTimer = null;
    }
  }

}
