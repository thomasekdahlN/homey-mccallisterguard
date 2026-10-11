'use strict';

import type Homey from 'homey/lib/Homey';
import type AlarmController from './AlarmController';
import type CameraManager from './CameraManager';
import type DeterrenceEngine from './DeterrenceEngine';
import type EventLog from './EventLog';
import type PerimeterGuard from './PerimeterGuard';
import type StateMachine from './StateMachine';
import type ZoneDirectory from './ZoneDirectory';
import { AlarmType, GuardSettings, Mode } from './types';
import { t } from './i18n';

const MOTION_RECENT_MS = 60_000;

/**
 * Listens to door/window and motion sensors and routes each event to the right reaction for the
 * current mode, including entry delays. Everything that happens *after* an event is confirmed is
 * delegated to AlarmController.
 */
export default class SensorMonitor {

  private deviceListeners = new Set<string>();
  private retryTimer: NodeJS.Timeout | null = null;
  private motionLastSeen = new Map<string, number>();
  /** True when the running entry delay was started by an entry-delay door (the resident is walking in). */
  private entryDelayFromDoor = false;

  constructor(
    private readonly homey: Homey,
    private readonly homeyApi: any,
    private readonly log: EventLog,
    private readonly stateMachine: StateMachine,
    private readonly alarm: AlarmController,
    private readonly deterrence: DeterrenceEngine,
    private readonly cameras: CameraManager,
    private readonly perimeter: PerimeterGuard,
    private readonly zones: ZoneDirectory,
    private readonly getSettings: () => GuardSettings,
  ) { }

  /**
   * Registers sensor listeners, retrying in the background until it succeeds. A failure here (for
   * example the device manager not being ready right after a Homey boot) must never leave the house
   * unmonitored, nor block the app from starting.
   */
  start(attempt = 1): void {
    this.registerAll().catch((err) => {
      const seconds = Math.min(2 ** attempt, 60);
      this.log.add('warning', t(this.homey, 'app.startup_retry', { step: 'sensors', error: (err as Error).message, seconds }));
      this.retryTimer = this.homey.setTimeout(() => {
        this.retryTimer = null;
        this.start(attempt + 1);
      }, seconds * 1000);
    });
  }

  stop(): void {
    if (this.retryTimer) this.homey.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  getRecentMotionZones(): string[] {
    const cutoff = Date.now() - MOTION_RECENT_MS;
    const result: string[] = [];
    for (const [zoneId, ts] of this.motionLastSeen) {
      if (ts >= cutoff) result.push(zoneId);
    }
    return result;
  }

  /**
   * Cancels a running entry delay (flow action: an authorised person was recognised).
   * Returns true when a delay was actually running.
   */
  cancelEntryDelay(): boolean {
    if (!this.stateMachine.isEntryDelayActive()) return false;
    this.stateMachine.cancelEntryDelay();
    this.entryDelayFromDoor = false;
    this.log.add('info', t(this.homey, 'app.entry_delay_cancelled'));
    return true;
  }

  // ── Listener registration ───────────────────────────────────────

  private async registerAll(): Promise<void> {
    const devices = await this.homeyApi.devices.getDevices();
    for (const device of Object.values(devices) as any[]) {
      this.registerDevice(device);
    }

    // Keep monitoring in sync with the device list: sensors paired after startup must be guarded too.
    try {
      await this.homeyApi.devices.connect();
      this.homeyApi.devices.on('device.create', (device: any) => {
        if (this.registerDevice(device)) {
          this.log.add('info', t(this.homey, 'app.sensor_listener_added', { device: device?.name ?? device?.id }));
          this.cameras.refreshZoneCache().catch(() => { /* best-effort */ });
        }
      });
      this.homeyApi.devices.on('device.delete', (device: any) => {
        if (device?.id) this.deviceListeners.delete(String(device.id));
      });
    } catch { /* realtime device events unavailable — the initial device list is still monitored */ }
  }

  /** Registers the alarm listener for a sensor device. Returns true when a new listener was added. */
  private registerDevice(device: any): boolean {
    if (!device || !Array.isArray(device.capabilities)) return false;
    const id = String(device.id);
    if (this.deviceListeners.has(id)) return false;
    const hasContact = device.capabilities.includes('alarm_contact');
    const hasMotion = device.capabilities.includes('alarm_motion');

    if (hasContact) {
      // Devices with alarm_contact are treated as contact (door/window) sensors.
      // If the device also has alarm_motion (dual-capability), only register the
      // contact listener — consistent with sensorType() which prioritises alarm_contact.
      // Registering both would cause onMotion to fire for the same physical event,
      // triggering perimeter alarm immediately while the contact handler's entry delay runs.
      device.makeCapabilityInstance('alarm_contact', (value: unknown) => {
        if (value === true) this.onContact(device.zone, device.id).catch(() => { /* best-effort */ });
      });
    } else if (hasMotion) {
      // Pure motion sensor (no contact capability) — register motion listener only.
      device.makeCapabilityInstance('alarm_motion', (value: unknown) => {
        if (value === true) this.onMotion(device.zone, device.id).catch(() => { /* best-effort */ });
      });
    } else {
      return false;
    }
    this.deviceListeners.add(id);
    return true;
  }

  // ── Event handling ──────────────────────────────────────────────

  /** Starts the entry delay and remembers whether it was triggered by an entry-delay door. */
  private startEntryDelay(fromDoor: boolean, onTimeout: () => void): void {
    this.entryDelayFromDoor = fromDoor;
    this.stateMachine.startEntryDelay(this.getSettings().entry_delay, () => {
      this.entryDelayFromDoor = false;
      onTimeout();
    });
  }

  async onMotion(zoneId: string, deviceId: string): Promise<void> {
    this.motionLastSeen.set(zoneId, Date.now());
    const mode = this.stateMachine.getMode();
    // Motion burst: use alarm-count when in deterrence or alarm mode.
    const isAlertMode = mode === 'deterrence' || mode === 'alarm';
    this.cameras.captureMotionBurst(zoneId, isAlertMode).catch(() => { /* best-effort */ });
    // off: app fully disabled — ignore all sensor events.
    // perimeter_alarm: already alerting — ignore additional motion until dismissed.
    if (mode === 'off' || mode === 'disarmed' || mode === 'perimeter_alarm') return;
    if (this.stateMachine.isExitDelayActive()) return;
    if (mode === 'armed_perimeter') {
      await this.onPerimeterMotion(zoneId, deviceId);
      return;
    }

    // Only log motion for away-armed mode (not perimeter mode).
    this.log.add('info', t(this.homey, 'app.motion_in_zone', { zone: zoneId }), zoneId, deviceId);

    if (mode === 'deterrence' || mode === 'alarm') {
      // Already in deterrence/alarm — update reaction zone without resetting the escalation timer.
      await this.deterrence.handleMotion(zoneId);
      return;
    }

    // armed: start entry delay (first trigger) or confirm immediately (already counting).
    if (!this.stateMachine.isEntryDelayActive()) {
      this.log.add('info', t(this.homey, 'app.entry_delay_started', { seconds: this.getSettings().entry_delay }), zoneId);
      this.startEntryDelay(false, () => {
        if (this.stateMachine.getMode() === 'disarmed') return;
        this.confirm(zoneId, deviceId, 'motion', 'intrusion').catch(() => { /* best-effort */ });
      });
    } else if (!this.entryDelayFromDoor) {
      await this.confirm(zoneId, deviceId, 'motion', 'intrusion');
    }
    // else: the delay was started by an entry door — the resident is on their way to disarm, so
    // hallway motion must not cut the delay short. The delay still expires into an alarm.
  }

  private async onPerimeterMotion(zoneId: string, deviceId: string): Promise<void> {
    // Motion sensors only trigger perimeter alarm if EXPLICITLY listed in perimeter_sensors.
    // Unlike contact sensors there is no "empty list = all" fallback — indoor motion (e.g. going to
    // the bathroom at night) must never fire the perimeter alarm by default.
    if (!this.perimeter.isPerimeterMotion(deviceId)) return;
    if (this.perimeter.isBypassed()) return;
    // Entry delay already running from a previous contact or motion event — do NOT bypass it.
    // In perimeter mode the resident is home and must always get the full entry delay window.
    if (this.stateMachine.isEntryDelayActive()) return;

    const { zoneName, deviceName } = await this.zones.resolveNames(zoneId, deviceId);
    this.log.add('info', t(this.homey, 'app.motion_entry_delay_started', {
      device: deviceName, zone: zoneName, seconds: this.getSettings().entry_delay,
    }), zoneId, deviceId);
    this.startEntryDelay(false, () => {
      const m = this.stateMachine.getMode();
      if (m === 'disarmed' || m === 'off') return;
      this.alarm.enterPerimeterAlarm(zoneId, deviceId, 'motion').catch(() => { /* best-effort */ });
    });
  }

  async onContact(zoneId: string, deviceId: string): Promise<void> {
    const mode = this.stateMachine.getMode();
    // off: app fully disabled — ignore all sensor events.
    // perimeter_alarm: already alerting — ignore additional contacts until dismissed.
    if (mode === 'off' || mode === 'disarmed' || mode === 'deterrence' || mode === 'alarm' || mode === 'perimeter_alarm') return;
    if (this.stateMachine.isExitDelayActive()) return;
    // In perimeter mode: silently ignore non-perimeter sensors, bypassed sensors and
    // sensors that were already open when armed_perimeter was activated.
    if (mode === 'armed_perimeter') {
      if (!this.perimeter.isPerimeterContact(deviceId)) return;
      if (this.perimeter.isBypassed()) return;
      if (this.perimeter.wasOpenAtStart(deviceId)) return;
    } else {
      // Only log door/window for away-armed mode.
      this.log.add('warning', t(this.homey, 'app.contact_opened_in_zone', { zone: zoneId }), zoneId, deviceId);
    }

    if (this.perimeter.isEntryDelaySensor(deviceId)) {
      this.onEntryDoor(zoneId, deviceId, mode);
      return;
    }

    if (mode === 'armed_perimeter') {
      await this.onPerimeterContact(zoneId, deviceId);
      return;
    }

    // Away mode: while a resident is coming in through an entry door, interior doors opening along
    // the way must not shortcut the entry delay either.
    if (this.stateMachine.isEntryDelayActive() && this.entryDelayFromDoor) return;
    await this.confirm(zoneId, deviceId, 'contact', 'intrusion');
  }

  private onEntryDoor(zoneId: string, deviceId: string, mode: Mode): void {
    if (this.stateMachine.isEntryDelayActive()) return;
    const seconds = this.getSettings().entry_delay;
    if (mode === 'armed_perimeter') {
      // Auto-bypass all other perimeter sensors for the same duration as the entry delay.
      // This prevents hallway motion / secondary door sensors from triggering an alarm
      // while an authorised resident walks in through the entry-delay door.
      // extendOnly: never shorten a longer bypass the user requested manually.
      this.perimeter.bypass(seconds, { extendOnly: true });
      this.log.add('info', t(this.homey, 'app.entry_delay_started_perimeter_bypass', { seconds }), zoneId, deviceId);
    } else {
      this.log.add('info', t(this.homey, 'app.entry_delay_started', { seconds }), zoneId, deviceId);
    }
    this.startEntryDelay(true, () => {
      if (this.stateMachine.getMode() === 'disarmed') return;
      this.onEntryDelayExpired(zoneId, deviceId, mode).catch(() => { /* best-effort */ });
    });
  }

  private async onPerimeterContact(zoneId: string, deviceId: string): Promise<void> {
    // Non-entry-delay perimeter sensor: apply entry delay before firing alarm_perimeter_triggered.
    // This gives the resident time to disarm (same pattern as armed mode).
    if (this.stateMachine.isEntryDelayActive()) {
      // Entry delay already running — second sensor confirms intrusion, alarm immediately.
      await this.alarm.enterPerimeterAlarm(zoneId, deviceId, 'contact');
      return;
    }
    const { zoneName, deviceName } = await this.zones.resolveNames(zoneId, deviceId);
    this.log.add('info', t(this.homey, 'app.perimeter_sensor_opened_entry_delay', {
      device: deviceName, zone: zoneName, seconds: this.getSettings().entry_delay,
    }), zoneId, deviceId);
    this.startEntryDelay(false, () => {
      const m = this.stateMachine.getMode();
      if (m === 'disarmed' || m === 'off') return;
      this.alarm.enterPerimeterAlarm(zoneId, deviceId, 'contact').catch(() => { /* best-effort */ });
    });
  }

  private async onEntryDelayExpired(zoneId: string, deviceId: string, mode: Mode): Promise<void> {
    const currentMode = this.stateMachine.getMode();
    if (currentMode === 'off' || currentMode === 'disarmed') return;
    if (mode === 'armed_perimeter') {
      await this.alarm.enterPerimeterAlarm(zoneId, deviceId, 'contact');
      return;
    }
    await this.confirm(zoneId, deviceId, 'contact', 'entry_delay_timeout');
  }

  private async confirm(zoneId: string, deviceId: string, sensorType: 'motion' | 'contact', alarmType: AlarmType): Promise<void> {
    const currentMode = this.stateMachine.getMode();
    if (currentMode === 'off' || currentMode === 'disarmed') return;
    await this.alarm.enterDeterrence(zoneId, deviceId, sensorType, alarmType);
  }

}
