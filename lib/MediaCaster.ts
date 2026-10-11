'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import { isLight } from './Capabilities';
import { DEFAULT_BLINK_SECONDS, GuardSettings } from './types';
import { t } from './i18n';

const BLUE_HUE = 0.66;
const RED_HUE = 0.0;

interface ZoneTask {
  /** Light devices managed by this task — reused on stop to avoid a second getDevices() call. */
  lights: any[];
  stop: () => Promise<void>;
}

export default class MediaCaster {

  private active = new Map<string, ZoneTask>();

  constructor(
    private readonly homey: Homey,
    private readonly homeyApi: any,
    private readonly log: EventLog,
    private readonly getSettings: () => GuardSettings,
  ) { }

  /** Start a slow blink on lights in the given zone (deterrence reaction zone). */
  async startBlink(zoneId: string): Promise<void> {
    await this.stopZone(zoneId);
    const devices = await this.zoneDevices(zoneId);
    await this.startLightStrobe(zoneId, devices, [BLUE_HUE, RED_HUE]);
  }

  /** Switches on every light in a zone (used to give cameras a lit scene before an alarm burst). */
  async turnOnZoneLights(zoneId: string): Promise<void> {
    const lights = (await this.zoneDevices(zoneId)).filter((d: any) => isLight(d));
    for (const light of lights) {
      try {
        await light.setCapabilityValue({ capabilityId: 'onoff', value: true });
      } catch { /* best-effort */ }
    }
  }

  /**
   * Stop all active blink tasks and turn off their lights.
   * Call this unconditionally when disarming or stopping an alarm — no guard needed.
   */
  async stopAll(): Promise<void> {
    const entries = Array.from(this.active.entries());
    this.active.clear();
    for (const [, task] of entries) {
      try { await task.stop(); } catch { /* best-effort */ }
      for (const light of task.lights) {
        try {
          await light.setCapabilityValue({ capabilityId: 'onoff', value: false });
        } catch { /* best-effort */ }
      }
    }
    if (entries.length > 0) {
      this.log.add('info', t(this.homey, 'media.stopall_summary', { count: entries.length }));
    }
  }

  /**
   * Stop the blink task for a single zone and turn off its lights.
   * Uses the device list cached in the task — no extra getDevices() call.
   */
  async stopZone(zoneId: string): Promise<void> {
    const task = this.active.get(zoneId);
    if (!task) return;
    this.active.delete(zoneId);
    try {
      await task.stop();
    } catch (err) {
      this.log.add('warning', t(this.homey, 'media.stop_zone_failed', { error: (err as Error).message }), zoneId);
    }
    for (const light of task.lights) {
      try {
        await light.setCapabilityValue({ capabilityId: 'onoff', value: false });
      } catch { /* best-effort */ }
    }
  }

  private async startLightStrobe(zoneId: string, devices: any[], hues: number[]): Promise<void> {
    const settings = this.getSettings();
    // blink_on/blink_off are global numbers; guard against legacy ZoneSeconds objects stored in settings.
    const rawOn = settings.blink_on;
    const rawOff = settings.blink_off;
    const onSec = Math.max(1, typeof rawOn === 'number' ? rawOn : DEFAULT_BLINK_SECONDS);
    const offSec = Math.max(1, typeof rawOff === 'number' ? rawOff : DEFAULT_BLINK_SECONDS);
    await this.startLightStrobeWithTiming(zoneId, devices, hues, onSec, offSec);
  }

  private async startLightStrobeWithTiming(key: string, devices: any[], hues: number[], onSec: number, offSec: number): Promise<void> {
    const lights = devices.filter((d: any) => isLight(d));
    if (lights.length === 0) {
      this.log.add('warning', t(this.homey, 'media.no_lights_to_blink', { zone: key }), key);
      return;
    }
    const onMs = onSec * 1000;
    const offMs = offSec * 1000;

    let idx = 0;
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    const turnOn = async (): Promise<void> => {
      const hue = hues[idx % hues.length] ?? BLUE_HUE;
      idx += 1;
      // Fire all lights in parallel to reduce latency and CPU time.
      // `stopped` is re-checked between calls: a stop request must win over a slow, in-flight turn-on,
      // otherwise lights could be left on after the zone has been darkened.
      await Promise.all(lights.map(async (light) => {
        try {
          if (stopped) return;
          await light.setCapabilityValue({ capabilityId: 'onoff', value: true });
          if (stopped) return;
          if (light.capabilities.includes('light_hue')) {
            await light.setCapabilityValue({ capabilityId: 'light_hue', value: hue });
          }
          if (stopped) return;
          if (light.capabilities.includes('light_saturation')) {
            await light.setCapabilityValue({ capabilityId: 'light_saturation', value: 1 });
          }
          if (stopped) return;
          if (light.capabilities.includes('dim')) {
            await light.setCapabilityValue({ capabilityId: 'dim', value: 1 });
          }
        } catch { /* best-effort */ }
      }));
    };

    const turnOff = async (): Promise<void> => {
      await Promise.all(lights.map(async (light) => {
        try {
          await light.setCapabilityValue({ capabilityId: 'onoff', value: false });
        } catch { /* best-effort */ }
      }));
    };

    const cycle = async (): Promise<void> => {
      if (stopped) return;
      await turnOn();
      if (stopped) return;
      timer = this.homey.setTimeout(async () => {
        if (stopped) return;
        await turnOff();
        if (stopped) return;
        timer = this.homey.setTimeout(() => { cycle().catch(() => { /* best-effort */ }); }, offMs);
      }, onMs);
    };

    cycle().catch(() => { /* best-effort */ });

    // Store lights reference in the task so stopZone/stopAll can turn them off
    // without making another getDevices() API call.
    this.active.set(key, {
      lights,
      stop: async () => {
        stopped = true;
        if (timer) this.homey.clearTimeout(timer);
      },
    });
    this.log.add('info', t(this.homey, 'media.starting_blink', {
      zone: key, count: lights.length, onSec, offSec,
    }), key);
  }

  private async zoneDevices(zoneId: string): Promise<any[]> {
    const devices = await this.homeyApi.devices.getDevices();
    return Object.values(devices).filter((d: any) => d.zone === zoneId);
  }

}
