'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import type { GuardSettings } from './types';
import { t } from './i18n';

const MAX_BYPASS_SECONDS = 24 * 3600;

/**
 * Perimeter (Skallsikring) sensor policy: which sensors count, the temporary bypass, and the set of
 * contacts that were already open when the perimeter was armed.
 */
export default class PerimeterGuard {

  private openAtStart = new Set<string>();
  private bypassEndsAt: number | null = null;
  private bypassTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly homey: Homey,
    private readonly homeyApi: any,
    private readonly log: EventLog,
    private readonly getSettings: () => GuardSettings,
  ) { }

  /** Contact sensors: an empty list means "all". */
  isPerimeterContact(deviceId: string): boolean {
    const list = this.getSettings().perimeter_sensors ?? [];
    if (list.length === 0) return true;
    return list.includes(deviceId);
  }

  /** Motion sensors count only when explicitly listed — indoor motion must never trip the perimeter. */
  isPerimeterMotion(deviceId: string): boolean {
    return (this.getSettings().perimeter_sensors ?? []).includes(deviceId);
  }

  isEntryDelaySensor(deviceId: string): boolean {
    return (this.getSettings().entry_delay_sensors ?? []).includes(deviceId);
  }

  wasOpenAtStart(deviceId: string): boolean {
    return this.openAtStart.has(deviceId);
  }

  clearOpenSnapshot(): void {
    this.openAtStart.clear();
  }

  isBypassed(): boolean {
    return this.bypassEndsAt !== null && Date.now() < this.bypassEndsAt;
  }

  getBypassEndsAt(): number | null {
    return this.isBypassed() ? this.bypassEndsAt : null;
  }

  /**
   * Bypasses perimeter sensors for `seconds`. Invalid or absurd durations are normalised.
   * With `extendOnly` an already running (longer) bypass is never shortened — used by the automatic
   * entry-door bypass so it cannot cut a manually requested bypass short.
   */
  bypass(seconds: number, { extendOnly = false }: { extendOnly?: boolean } = {}): void {
    const secs = Number.isFinite(seconds)
      ? Math.min(Math.max(5, Math.round(seconds)), MAX_BYPASS_SECONDS)
      : 60;
    const endsAt = Date.now() + secs * 1000;
    if (extendOnly && this.isBypassed() && (this.bypassEndsAt as number) >= endsAt) return;

    if (this.bypassTimer) {
      this.homey.clearTimeout(this.bypassTimer);
      this.bypassTimer = null;
    }
    this.bypassEndsAt = endsAt;
    this.log.add('info', t(this.homey, 'app.perimeter_bypass_activated', { seconds: secs }));
    this.bypassTimer = this.homey.setTimeout(() => {
      this.bypassTimer = null;
      this.bypassEndsAt = null;
      this.log.add('info', t(this.homey, 'app.perimeter_bypass_expired'));
    }, secs * 1000);
  }

  /**
   * Remembers which perimeter contact sensors are currently open so they can be ignored for the
   * lifetime of the armed_perimeter session (a window left open when arming must not alarm).
   * Returns the names of the open sensors; logging is left to the caller.
   */
  async snapshotOpenSensors(): Promise<string[]> {
    // Strict matching: only sensors explicitly listed in perimeter_sensors are snapshotted. Falling
    // back to "all sensors" would silently ignore sensors the user actually wants monitored.
    const perimeterList = this.getSettings().perimeter_sensors ?? [];
    if (perimeterList.length === 0) return [];

    try {
      const devices = await this.homeyApi.devices.getDevices();
      this.openAtStart.clear();
      const openNames: string[] = [];
      for (const device of Object.values(devices) as any[]) {
        if (!Array.isArray(device.capabilities)) continue;
        if (!device.capabilities.includes('alarm_contact')) continue;
        if (!perimeterList.includes(device.id)) continue;
        if (device.capabilitiesObj?.alarm_contact?.value === true) {
          this.openAtStart.add(device.id);
          openNames.push(device.name || device.id);
        }
      }
      return openNames;
    } catch (err) {
      this.log.add('warning', t(this.homey, 'app.snapshot_open_sensors_failed', { error: (err as Error).message }));
      return [];
    }
  }

}
