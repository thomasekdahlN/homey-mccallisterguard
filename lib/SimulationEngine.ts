'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import { GuardSettings } from './types';
import { isLight } from './Capabilities';
import { isInWindow, localMinutes, parseHHMM } from './Schedule';
import { t } from './i18n';

const TICK_INTERVAL_MS = 60_000;

export default class SimulationEngine {

  private tickInterval: NodeJS.Timeout | null = null;
  private cycleTimer: NodeJS.Timeout | null = null;
  /** Device IDs of lights that are currently switched ON by Kevin-mode. */
  private currentLightIds: string[] = [];
  private running = false;

  constructor(
    private readonly homey: Homey,
    private readonly homeyApi: any,
    private readonly log: EventLog,
    private readonly getSettings: () => GuardSettings,
  ) { }

  start(): void {
    if (this.tickInterval) return;
    this.tick();
    this.tickInterval = this.homey.setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickInterval) {
      this.homey.clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.cycleTimer) {
      this.homey.clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (this.running) {
      this.turnOffCurrent(t(this.homey, 'sim.stopped')).catch(() => { /* best-effort */ });
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private tick(): void {
    const within = this.isWithinWindow();
    if (within && !this.running) {
      this.running = true;
      this.log.add('info', t(this.homey, 'sim.started'));
      this.scheduleCycle();
    } else if (!within && this.running) {
      this.running = false;
      if (this.cycleTimer) {
        this.homey.clearTimeout(this.cycleTimer);
        this.cycleTimer = null;
      }
      this.turnOffCurrent(t(this.homey, 'sim.stopped_outside_window')).catch(() => { /* best-effort */ });
    }
  }

  private scheduleCycle(): void {
    const settings = this.getSettings();
    this.runCycle(settings).catch((err) => {
      this.log.add('warning', t(this.homey, 'sim.cycle_failed', { error: (err as Error).message }));
    });
    const min = Math.max(1, settings.random_min);
    const max = Math.max(min, settings.random_max);
    const next = (Math.floor(Math.random() * (max - min + 1)) + min) * 60_000;
    this.cycleTimer = this.homey.setTimeout(() => {
      this.cycleTimer = null;
      if (this.running) this.scheduleCycle();
    }, next);
  }

  private async runCycle(settings: GuardSettings): Promise<void> {
    await this.turnOffCurrent();

    const candidates = settings.kevin_lights ?? [];
    if (candidates.length === 0) return;

    // Pick 1–3 random lights from the user-configured set.
    const count = Math.min(candidates.length, 1 + Math.floor(Math.random() * 3));
    const picked: string[] = [];
    const pool = [...candidates];
    for (let i = 0; i < count && pool.length > 0; i += 1) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0] as string);
    }

    const [devices, zones] = await Promise.all([
      this.homeyApi.devices.getDevices(),
      this.homeyApi.zones.getZones(),
    ]);
    const deviceMap = new Map<string, any>(
      (Object.values(devices) as any[]).map((d: any) => [String(d.id), d]),
    );
    const zoneNameMap = new Map<string, string>(
      (Object.values(zones) as any[]).map((z: any) => [String(z.id), String(z.name ?? z.id)]),
    );

    /** zone ID → list of light names turned on in that zone */
    const byZone = new Map<string, string[]>();
    const allNames: string[] = [];

    for (const deviceId of picked) {
      const device = deviceMap.get(deviceId);
      if (!device || !isLight(device)) continue;
      try {
        await device.setCapabilityValue({ capabilityId: 'onoff', value: true });
        this.currentLightIds.push(deviceId);
        const name = String(device.name ?? deviceId);
        allNames.push(name);
        const zoneId = String(device.zone ?? '');
        const list = byZone.get(zoneId) ?? [];
        list.push(name);
        byZone.set(zoneId, list);
      } catch { /* best-effort */ }
    }

    if (allNames.length > 0) {
      this.log.add('info', t(this.homey, 'sim.lights_on', { names: allNames.join(', ') }));
      const onCard = this.homey.flow.getTriggerCard('kevin_zone_on');
      for (const [zoneId, names] of byZone) {
        const zoneName = zoneNameMap.get(zoneId) ?? zoneId;
        onCard.trigger({ zone: zoneName, light_names: names.join(', ') }, { zoneId })
          .catch(() => { /* best-effort */ });
      }
    }
  }

  /**
   * Turn off all lights that Kevin-mode currently has on, then clear the list.
   *
   * @param logPrefix - Optional message prefix for the log entry. When omitted the
   *   entry only lists the lights that were turned off.
   */
  private async turnOffCurrent(logPrefix?: string): Promise<void> {
    if (this.currentLightIds.length === 0) {
      if (logPrefix) this.log.add('info', `${logPrefix}.`);
      return;
    }

    const [devices, zones] = await Promise.all([
      this.homeyApi.devices.getDevices(),
      this.homeyApi.zones.getZones(),
    ]);
    const deviceMap = new Map<string, any>(
      (Object.values(devices) as any[]).map((d: any) => [String(d.id), d]),
    );
    const zoneNameMap = new Map<string, string>(
      (Object.values(zones) as any[]).map((z: any) => [String(z.id), String(z.name ?? z.id)]),
    );

    /** zone ID → list of light names turned off in that zone */
    const byZone = new Map<string, string[]>();
    const allNames: string[] = [];

    for (const deviceId of this.currentLightIds) {
      const device = deviceMap.get(deviceId);
      if (!device) continue;
      try {
        await device.setCapabilityValue({ capabilityId: 'onoff', value: false });
        const name = String(device.name ?? deviceId);
        allNames.push(name);
        const zoneId = String(device.zone ?? '');
        const list = byZone.get(zoneId) ?? [];
        list.push(name);
        byZone.set(zoneId, list);
      } catch { /* best-effort */ }
    }
    this.currentLightIds = [];

    const lightsMsg = allNames.length > 0 ? ` — ${allNames.join(', ')}` : '';
    const prefix = logPrefix
      ? t(this.homey, 'sim.lights_off_with_prefix', { prefix: logPrefix })
      : t(this.homey, 'sim.lights_off_default');
    this.log.add('info', `${prefix}${lightsMsg}.`);

    if (allNames.length > 0) {
      const offCard = this.homey.flow.getTriggerCard('kevin_zone_off');
      for (const [zoneId, names] of byZone) {
        const zoneName = zoneNameMap.get(zoneId) ?? zoneId;
        offCard.trigger({ zone: zoneName, light_names: names.join(', ') }, { zoneId })
          .catch(() => { /* best-effort */ });
      }
    }
  }

  /**
   * True when the current local time lies between (sunset + offset) and the bedtime.
   * All comparisons use minutes-of-day in the Homey time zone: Homey Pro runs Node in UTC, so
   * Date#setHours() and friends would silently interpret the bedtime in the wrong zone.
   */
  private isWithinWindow(): boolean {
    const settings = this.getSettings();
    const sunset = this.getSunset();
    if (!sunset) return false;
    const tz = this.homey.clock.getTimezone();
    const start = new Date(sunset.getTime() + settings.sunset_offset * 60_000);
    const startMin = localMinutes(start, tz);
    const nowMin = localMinutes(new Date(), tz);
    const endMin = parseHHMM(settings.bedtime) ?? (23 * 60 + 30);

    // A bedtime in the small hours (before 06:00) means the window runs past midnight.
    // Any other end before the start (e.g. midsummer sunset later than bedtime) is an empty window.
    if (endMin < 6 * 60) return isInWindow(nowMin, startMin, endMin);
    return nowMin >= startMin && nowMin < endMin;
  }

  private getSunset(): Date | null {
    const geo: any = this.homey.geolocation;
    try {
      const lat = geo.getLatitude();
      const lng = geo.getLongitude();
      if (typeof lat !== 'number' || typeof lng !== 'number') return null;
      return SimulationEngine.computeSunset(new Date(), lat, lng);
    } catch {
      return null;
    }
  }

  /**
   * Sunset (UTC instant) for the given date and position, using the NOAA solar equations
   * (includes the equation of time, accurate to about a minute at Nordic latitudes).
   * Returns null during polar day (the sun never sets).
   */
  static computeSunset(date: Date, lat: number, lng: number): Date | null {
    const rad = Math.PI / 180;
    const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
    const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const dayOfYear = Math.round((startOfDay - startOfYear) / 86_400_000) + 1;
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
    const eqTime = 229.18 * (0.000075
      + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918
      - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))
      - Math.tan(lat * rad) * Math.tan(decl);
    if (cosH < -1) return null; // polar day — no sunset
    const hourAngleDeg = cosH > 1 ? 0 : Math.acos(cosH) / rad; // polar night: sun never rises, treat as sunset at solar noon
    const sunsetMinutesUTC = 720 - 4 * (lng + hourAngleDeg) - eqTime;
    return new Date(startOfDay + sunsetMinutesUTC * 60_000);
  }

}
