'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import type MediaCaster from './MediaCaster';
import { GuardSettings } from './types';
import { t } from './i18n';

export type DeterrenceListener = (reactionZoneId: string, motionZoneId: string) => void;

export default class DeterrenceEngine {

  private activeDeterrenceZone: string | null = null;
  private activeMotionZone: string | null = null;
  private cooldownTimer: NodeJS.Timeout | null = null;
  private listeners: DeterrenceListener[] = [];
  /** Bumped by abort() so in-flight async work started before the abort can detect it and bail out. */
  private epoch = 0;

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
    private readonly media: MediaCaster,
    private readonly getSettings: () => GuardSettings,
  ) { }

  onDeterrenceStarted(listener: DeterrenceListener): void {
    this.listeners.push(listener);
  }

  getActiveZone(): string | null {
    return this.activeDeterrenceZone;
  }

  getActiveMotionZone(): string | null {
    return this.activeMotionZone;
  }

  async handleMotion(motionZoneId: string): Promise<void> {
    const { epoch } = this;
    this.activeMotionZone = motionZoneId;
    const settings = this.getSettings();

    if (motionZoneId === this.activeDeterrenceZone) {
      await this.darken(t(this.homey, 'dtr.intruder_moving_toward_reaction_zone', { zone: this.activeDeterrenceZone }));
      // abort() ran while we were darkening — do not schedule anything new.
      if (epoch !== this.epoch) return;
      const matrix = settings.zone_matrix;
      this.clearCooldown();
      this.cooldownTimer = this.homey.setTimeout(() => {
        this.cooldownTimer = null;
        const next = matrix[motionZoneId];
        if (next) {
          this.execute(next, motionZoneId).catch((err) => {
            this.log.add('warning', t(this.homey, 'dtr.post_cooldown_failed', { error: (err as Error).message }), next);
          });
        }
      }, settings.deterrence_delay * 1000);
      return;
    }

    const reactionZoneId = settings.zone_matrix[motionZoneId];
    if (!reactionZoneId) {
      return;
    }
    // Motion elsewhere supersedes any pending "intruder reached the reaction zone" follow-up.
    this.clearCooldown();
    await this.execute(reactionZoneId, motionZoneId);
  }

  async runDirect(zoneId: string): Promise<void> {
    this.clearCooldown();
    if (this.activeDeterrenceZone) {
      await this.media.stopZone(this.activeDeterrenceZone);
    }
    this.activeDeterrenceZone = zoneId;
    this.log.add('alarm', t(this.homey, 'dtr.direct_test', { zone: zoneId }), zoneId);
    await this.media.startBlink(zoneId);
    for (const listener of this.listeners) {
      try { listener(zoneId, zoneId); } catch { /* best-effort */ }
    }
  }

  /** Stops every running deterrence effect. The optional reason is informational for callers only. */
  async abort(_reason?: string): Promise<void> {
    this.epoch += 1;
    this.clearCooldown();
    const zone = this.activeDeterrenceZone;
    this.activeDeterrenceZone = null;
    this.activeMotionZone = null;
    if (zone) {
      await this.media.stopZone(zone);
      this.log.add('info', t(this.homey, 'dtr.stopped'), zone);
    }
    // Zones that were left blinking by earlier executions are not tracked here — stop them all.
    await this.media.stopAll();
  }

  private clearCooldown(): void {
    if (this.cooldownTimer) {
      this.homey.clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  private async execute(reactionZoneId: string, motionZoneId: string): Promise<void> {
    const { epoch } = this;
    // Only one reaction zone blinks at a time: stop the previous one when the intruder moves on.
    const previous = this.activeDeterrenceZone;
    if (previous && previous !== reactionZoneId) {
      await this.media.stopZone(previous);
    }
    if (epoch !== this.epoch) return;
    this.activeDeterrenceZone = reactionZoneId;
    await this.media.startBlink(reactionZoneId);
    if (epoch !== this.epoch) {
      // Aborted while the lights were being switched on — undo.
      await this.media.stopZone(reactionZoneId);
      return;
    }

    for (const listener of this.listeners) {
      try { listener(reactionZoneId, motionZoneId); } catch { /* best-effort */ }
    }
  }

  private async darken(reason: string): Promise<void> {
    if (!this.activeDeterrenceZone) return;
    this.log.add('info', t(this.homey, 'dtr.darkening', { zone: this.activeDeterrenceZone, reason }), this.activeDeterrenceZone);
    await this.media.stopZone(this.activeDeterrenceZone);
    this.activeDeterrenceZone = null;
  }

}
