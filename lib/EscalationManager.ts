'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import { isLight } from './Capabilities';
import { t } from './i18n';

const STROBE_INTERVAL_MS = 400;

export type EscalationListener = () => void;

/** A light taking part in the strobe, with the state it had before the alarm so it can be restored. */
interface CrisisLight {
  device: any;
  wasOn: boolean | null;
}

/** A speaker whose volume/playback state is restored when the alarm ends. */
interface CrisisSpeaker {
  device: any;
  prevVolume: number | null;
  prevPlaying: boolean | null;
}

export default class EscalationManager {

  private strobeTimer: NodeJS.Timeout | null = null;
  private strobeRunning = false;
  private inCrisis = false;
  private listeners: EscalationListener[] = [];
  private crisisLights: CrisisLight[] = [];
  private crisisSpeakers: CrisisSpeaker[] = [];

  constructor(
    private readonly homey: Homey,
    private readonly homeyApi: any,
    private readonly log: EventLog,
  ) { }

  /**
   * Immediately trigger the full alarm crisis (sirens + strobe).
   * The deterrence → alarm timer lives in app.ts; this method is called
   * when the system enters alarm mode.
   *
   * Only real lights are strobed (never plugs, heaters or other on/off appliances), and the
   * previous state of every touched device is remembered so cancel() can restore it.
   */
  async triggerCrisis(): Promise<void> {
    if (this.inCrisis) return;
    this.inCrisis = true;
    try {
      this.log.add('critical', t(this.homey, 'escalation.full_escalation'));
      for (const listener of this.listeners) {
        try { listener(); } catch { /* best-effort */ }
      }

      const devices = await this.homeyApi.devices.getDevices();
      const all = Object.values(devices) as any[];

      // cancel() may have been called while we were waiting for the device list.
      if (!this.inCrisis) return;

      for (const dev of all) {
        if (!Array.isArray(dev.capabilities)) continue;
        const hasVolume = dev.capabilities.includes('volume_set');
        const hasPlaying = dev.capabilities.includes('speaker_playing');
        if (!hasVolume && !hasPlaying) continue;
        const speaker: CrisisSpeaker = {
          device: dev,
          prevVolume: hasVolume ? this.readNumber(dev, 'volume_set') : null,
          prevPlaying: hasPlaying ? this.readBoolean(dev, 'speaker_playing') : null,
        };
        this.crisisSpeakers.push(speaker);
        if (hasVolume) {
          try { await dev.setCapabilityValue({ capabilityId: 'volume_set', value: 1.0 }); } catch { /* best-effort */ }
        }
        if (hasPlaying) {
          try { await dev.setCapabilityValue({ capabilityId: 'speaker_playing', value: true }); } catch { /* best-effort */ }
        }
      }

      this.crisisLights = all
        .filter((d) => isLight(d))
        .map((device) => ({ device, wasOn: this.readBoolean(device, 'onoff') }));

      this.startStrobe();
    } catch (err) {
      // Never leave the manager "stuck" in crisis without a working strobe — allow a retry.
      this.log.add('warning', t(this.homey, 'escalation.trigger_failed', { error: (err as Error).message }));
      this.inCrisis = false;
      throw err;
    }
  }

  async cancel(): Promise<void> {
    if (this.strobeTimer) {
      this.homey.clearTimeout(this.strobeTimer);
      this.strobeTimer = null;
    }
    this.inCrisis = false;

    const lights = this.crisisLights;
    const speakers = this.crisisSpeakers;
    this.crisisLights = [];
    this.crisisSpeakers = [];

    // Wait for an in-flight strobe tick so it cannot switch lights back on after we restore them.
    for (let i = 0; i < 50 && this.strobeRunning; i += 1) {
      await new Promise<void>((resolve) => { this.homey.setTimeout(resolve, 100); });
    }

    // Restore lights to the state they had before the alarm.
    await Promise.all(lights.map(async ({ device, wasOn }) => {
      try {
        await device.setCapabilityValue({ capabilityId: 'onoff', value: wasOn === true });
      } catch { /* best-effort */ }
    }));
    for (const { device, prevVolume, prevPlaying } of speakers) {
      if (prevPlaying !== null) {
        try { await device.setCapabilityValue({ capabilityId: 'speaker_playing', value: prevPlaying }); } catch { /* best-effort */ }
      }
      if (prevVolume !== null) {
        try { await device.setCapabilityValue({ capabilityId: 'volume_set', value: prevVolume }); } catch { /* best-effort */ }
      }
    }
    if (lights.length > 0) {
      this.log.add('info', t(this.homey, 'escalation.alarm_ended', { count: lights.length }));
    }
  }

  onCrisis(listener: EscalationListener): void {
    this.listeners.push(listener);
  }

  isInCrisis(): boolean {
    return this.inCrisis;
  }

  /**
   * Self-rescheduling strobe: the next tick is only scheduled once the previous one has finished,
   * so slow device calls can never pile up. Lights are driven in parallel.
   */
  private startStrobe(): void {
    let toggle = false;
    const tick = async (): Promise<void> => {
      if (!this.inCrisis) return;
      this.strobeRunning = true;
      toggle = !toggle;
      try {
        await Promise.all(this.crisisLights.map(async ({ device: light }) => {
          try {
            if (!this.inCrisis) return;
            await light.setCapabilityValue({ capabilityId: 'onoff', value: true });
            if (light.capabilities.includes('light_hue')) {
              await light.setCapabilityValue({ capabilityId: 'light_hue', value: toggle ? 0 : 0.66 });
            }
            if (light.capabilities.includes('light_saturation')) {
              await light.setCapabilityValue({ capabilityId: 'light_saturation', value: 1 });
            }
            if (light.capabilities.includes('dim')) {
              await light.setCapabilityValue({ capabilityId: 'dim', value: 1 });
            }
          } catch { /* best-effort */ }
        }));
      } finally {
        this.strobeRunning = false;
      }
      if (this.inCrisis) {
        this.strobeTimer = this.homey.setTimeout(() => { tick().catch(() => { /* best-effort */ }); }, STROBE_INTERVAL_MS);
      }
    };
    tick().catch(() => { /* best-effort */ });
  }

  private readBoolean(device: any, capabilityId: string): boolean | null {
    const v = device?.capabilitiesObj?.[capabilityId]?.value;
    return typeof v === 'boolean' ? v : null;
  }

  private readNumber(device: any, capabilityId: string): number | null {
    const v = device?.capabilitiesObj?.[capabilityId]?.value;
    return typeof v === 'number' ? v : null;
  }

}
