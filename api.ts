'use strict';

import * as fs from 'fs';
import * as path from 'path';
import type { GuardSettings, Mode } from './lib/types';
import type { GuardServices } from './lib/services';
import { SNAPSHOT_DIR_ALARM, SNAPSHOT_DIR_MOTION } from './lib/types';
import { classify, isCamera, sensorType } from './lib/Capabilities';
import type { SensorType } from './lib/Capabilities';
import { t } from './lib/i18n';
import { sortByZoneName } from './lib/ZoneDirectory';

/** Snapshot metadata returned by getSnapshotList. */
interface SnapshotMeta {
  filename: string;
  timestamp: number;
  size: number;
}

/** Builds a sorted (newest-first) list of snapshot metadata from a directory. */
function listSnapshotDir(dir: string): SnapshotMeta[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /^[0-9]+-[0-9a-f]+\.jpg$/i.test(f))
      .map((filename) => {
        const timestamp = parseInt(filename.split('-')[0], 10);
        let size = 0;
        try { size = fs.statSync(path.join(dir, filename)).size; } catch { /* best-effort */ }
        return { filename, timestamp, size };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // newest first
  } catch {
    return [];
  }
}

interface Ctx { homey: { app: { services: GuardServices }; i18n: { getLanguage(): string } } }
interface BodyCtx<T> extends Ctx { body: T }

module.exports = {

  async getLanguage({ homey }: Ctx) {
    return { language: homey.i18n.getLanguage() };
  },

  async getStatus({ homey }: Ctx) {
    const sv = homey.app.services;
    return {
      mode: sv.stateMachine.getMode(),
      modeChangedAt: sv.stateMachine.getModeChangedAt(),
      exitDelayActive: sv.stateMachine.isExitDelayActive(),
      exitDelayEndsAt: sv.stateMachine.getExitDelayEndsAt(),
      exitDelayTarget: sv.stateMachine.getExitDelayTarget(),
      entryDelayActive: sv.stateMachine.isEntryDelayActive(),
      entryDelayEndsAt: sv.stateMachine.getEntryDelayEndsAt(),
      activeDeterrenceZone: sv.deterrence.getActiveZone(),
      activeMotionZone: sv.deterrence.getActiveMotionZone(),
      simulationRunning: sv.simulation.isRunning(),
      escalationPending: sv.stateMachine.getMode() === 'deterrence',
      inCrisis: sv.escalation.isInCrisis(),
      testActive: sv.alarm.isTestActive(),
      alarmActive: sv.alarm.isAlarmActive(),
      recentMotionZones: sv.sensors.getRecentMotionZones(),
      cameraMotionEnabled: sv.settings.get().camera_motion_enabled !== false,
      perimeterBypassed: sv.perimeter.isBypassed(),
      perimeterBypassEndsAt: sv.perimeter.getBypassEndsAt(),
    };
  },

  async getEventLog({ homey }: Ctx) {
    return homey.app.services.eventLog.recent();
  },

  async clearEventLog({ homey }: Ctx) {
    homey.app.services.eventLog.clear();
    return { success: true };
  },

  async getZones({ homey }: Ctx) {
    const [zones, devices] = await Promise.all([
      homey.app.services.homeyApi.zones.getZones(),
      homey.app.services.homeyApi.devices.getDevices(),
    ]);
    type ZoneSensor = { id: string; name: string; type: SensorType };
    type ZoneLight = { id: string; name: string };
    type ZoneCamera = { id: string; name: string };
    type ZoneCaps = {
      hasAudio: boolean; hasVideo: boolean; hasLights: boolean; hasCameras: boolean;
      audioDevices: string[]; videoDevices: string[]; lightDevices: string[];
      lights: ZoneLight[];
      cameras: ZoneCamera[];
      sensors: ZoneSensor[];
    };
    const caps: Record<string, ZoneCaps> = {};
    for (const d of Object.values(devices) as any[]) {
      if (!d.zone) continue;
      const c = caps[d.zone] ?? (caps[d.zone] = {
        hasAudio: false,
        hasVideo: false,
        hasLights: false,
        hasCameras: false,
        audioDevices: [],
        videoDevices: [],
        lightDevices: [],
        lights: [],
        cameras: [],
        sensors: [],
      });
      const k = classify(d);
      const name = String(d.name ?? d.id ?? '');
      if (k.isAudio) { c.hasAudio = true; c.audioDevices.push(name); }
      if (k.isVideo) { c.hasVideo = true; c.videoDevices.push(name); }
      if (k.isLight) {
        c.hasLights = true;
        c.lightDevices.push(name);
        c.lights.push({ id: String(d.id), name });
      }
      if (isCamera(d)) { c.hasCameras = true; c.cameras.push({ id: String(d.id), name }); }
      const st = sensorType(d);
      if (st) c.sensors.push({ id: String(d.id), name, type: st });
    }
    const result = Object.values(zones).map((z: any) => {
      const c = caps[z.id];
      return {
        id: z.id,
        name: z.name,
        parent: z.parent ?? null,
        hasAudio: c?.hasAudio ?? false,
        hasVideo: c?.hasVideo ?? false,
        hasLights: c?.hasLights ?? false,
        hasCameras: c?.hasCameras ?? false,
        audioDevices: c?.audioDevices ?? [],
        videoDevices: c?.videoDevices ?? [],
        lightDevices: c?.lightDevices ?? [],
        lights: c?.lights ?? [],
        cameras: c?.cameras ?? [],
        sensors: c?.sensors ?? [],
      };
    });
    // Alphabetical by zone name — the settings page renders this list as-is (zone overview and the
    // reaction-zone dropdown), so the order here is the order the user sees.
    return sortByZoneName(result, homey.i18n.getLanguage());
  },

  async getSettings({ homey }: Ctx) {
    return homey.app.services.settings.get();
  },

  async setSettings({ homey, body }: BodyCtx<Partial<GuardSettings>>) {
    return homey.app.services.settings.save(body);
  },

  async setMode({ homey, body }: BodyCtx<{ mode: Mode }>) {
    try {
      // Dashboard actions are explicit user intent — always bypass guards (force=true).
      await homey.app.services.modes.setMode(body.mode, { force: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async testDeterrence({ homey, body }: BodyCtx<{ zoneId: string }>) {
    await homey.app.services.alarm.testDeterrence(body.zoneId);
    return { success: true };
  },

  async testAlarm({ homey }: Ctx) {
    await homey.app.services.alarm.testAlarm();
    return { success: true };
  },

  async stopAlarm({ homey }: Ctx) {
    await homey.app.services.alarm.stopAlarm();
    return { success: true };
  },

  async setCameraMotion({ homey, body }: BodyCtx<{ enabled: boolean }>) {
    homey.app.services.settings.setCameraMotionEnabled(body.enabled);
    return { success: true };
  },

  async bypassPerimeter({ homey, body }: BodyCtx<{ duration: number }>) {
    homey.app.services.perimeter.bypass(Math.max(5, Math.round(body.duration ?? 60)));
    return { success: true };
  },

  /** GET /snapshot-list — returns metadata for all stored snapshots, split by type. */
  async getSnapshotList(_ctx: Ctx) {
    return {
      alarm: listSnapshotDir(SNAPSHOT_DIR_ALARM),
      motion: listSnapshotDir(SNAPSHOT_DIR_MOTION),
    };
  },

  /**
   * GET /snapshot-image — returns the raw JPEG as a base64 string.
   * Body/query params: { type: 'alarm' | 'motion', filename: string }
   */
  async getSnapshotImage(_ctx: Ctx & { query: { type?: string; filename?: string } }) {
    const { type, filename } = (_ctx as any).query ?? {};
    if ((type !== 'alarm' && type !== 'motion') || !filename) {
      throw new Error(t(_ctx.homey, 'api.invalid_type_or_filename'));
    }
    // Prevent path traversal: filename must be a plain basename.
    if (path.basename(filename) !== filename || !/^[0-9]+-[0-9a-f]+\.jpg$/i.test(filename)) {
      throw new Error(t(_ctx.homey, 'api.invalid_filename'));
    }
    const dir = type === 'alarm' ? SNAPSHOT_DIR_ALARM : SNAPSHOT_DIR_MOTION;
    const filepath = path.join(dir, filename);
    const buffer = fs.readFileSync(filepath);
    return { data: buffer.toString('base64') };
  },

  /**
   * DELETE /snapshots — deletes snapshot files.
   * Body: { type: 'alarm' | 'motion' | 'all' }
   */
  async deleteSnapshots(_ctx: Ctx & { body: { type?: string } }) {
    const { type } = (_ctx as any).body ?? {};
    const dirs: string[] = [];
    if (type === 'alarm' || type === 'all') dirs.push(SNAPSHOT_DIR_ALARM);
    if (type === 'motion' || type === 'all') dirs.push(SNAPSHOT_DIR_MOTION);
    if (dirs.length === 0) throw new Error(t(_ctx.homey, 'api.invalid_type'));

    let deleted = 0;
    for (const dir of dirs) {
      try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'));
        for (const f of files) {
          try { fs.unlinkSync(path.join(dir, f)); deleted += 1; } catch { /* best-effort */ }
        }
      } catch { /* dir may not exist */ }
    }
    return { success: true, deleted };
  },

};
