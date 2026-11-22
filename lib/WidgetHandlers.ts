'use strict';

import type { GuardServices } from './services';
import type { EventEntry, EventLevel, Mode } from './types';
import { t, widgetLabels } from './i18n';
import {
  isSnapshotType, isValidSnapshotFilename, listSnapshotDir, readSnapshotBase64, snapshotDir,
} from './SnapshotFiles';
import type { SnapshotMeta, SnapshotType } from './SnapshotFiles';

/**
 * Backend logic shared by the dashboard widgets (widgets/<id>/api.ts). Each widget API file is a thin
 * adapter over these functions so the widgets never reach into the services directly.
 */

export interface WidgetHomey {
  app: { services: GuardServices };
  i18n: { getLanguage(): string };
}

/** Modes a widget may request. 'off' stays GUI-only (settings page); alert modes are never set by hand. */
const WIDGET_MODES: readonly Mode[] = ['disarmed', 'armed', 'armed_perimeter'];

const LEVEL_RANK: Record<EventLevel, number> = {
  info: 0, warning: 1, alarm: 2, critical: 3,
};

const MAX_EVENT_LIMIT = 50;
const MAX_SNAPSHOT_LIMIT = 10;

export function getLabels(homey: WidgetHomey) {
  return { language: homey.i18n.getLanguage(), labels: widgetLabels(homey) };
}

export function getStatus(homey: WidgetHomey) {
  const sv = homey.app.services;
  const mode = sv.stateMachine.getMode();
  return {
    now: Date.now(),
    mode,
    modeChangedAt: sv.stateMachine.getModeChangedAt(),
    exitDelayEndsAt: sv.stateMachine.isExitDelayActive() ? sv.stateMachine.getExitDelayEndsAt() : null,
    entryDelayEndsAt: sv.stateMachine.isEntryDelayActive() ? sv.stateMachine.getEntryDelayEndsAt() : null,
    alarmActive: sv.alarm.isAlarmActive(),
    inAlert: mode === 'alarm' || mode === 'deterrence' || mode === 'perimeter_alarm',
    testActive: sv.alarm.isTestActive(),
    simulationRunning: sv.simulation.isRunning(),
    cameraMotionEnabled: sv.settings.get().camera_motion_enabled !== false,
    perimeterBypassEndsAt: sv.perimeter.getBypassEndsAt(),
  };
}

export async function setMode(homey: WidgetHomey, mode: unknown) {
  if (!WIDGET_MODES.includes(mode as Mode)) {
    return { success: false, error: t(homey, 'widget.mode_change_failed') };
  }
  try {
    // Same intent as the settings dashboard: an explicit tap is a user decision, so guards meant for
    // flows (perimeter disarm lock, perimeter-window redirect) are bypassed.
    await homey.app.services.modes.setMode(mode as Mode, { force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function stopAlarm(homey: WidgetHomey) {
  await homey.app.services.alarm.stopAlarm();
  return { success: true };
}

export function bypassPerimeter(homey: WidgetHomey, duration: unknown) {
  const seconds = typeof duration === 'number' && Number.isFinite(duration) ? duration : 60;
  // PerimeterGuard.bypass() normalises the lower and upper bound itself.
  homey.app.services.perimeter.bypass(seconds);
  return { success: true, endsAt: homey.app.services.perimeter.getBypassEndsAt() };
}

export function getEvents(homey: WidgetHomey, limit: unknown, minLevel: unknown): EventEntry[] {
  const n = Math.min(Math.max(parseInt(String(limit), 10) || 8, 1), MAX_EVENT_LIMIT);
  const min = LEVEL_RANK[minLevel as EventLevel] ?? 0;
  // Filter before limiting so a "warnings only" widget still fills its rows.
  return homey.app.services.eventLog.recent()
    .filter((e) => LEVEL_RANK[e.level] >= min)
    .slice(0, n);
}

export function getSnapshots(type: unknown, limit: unknown): { items: Array<SnapshotMeta & { type: SnapshotType }> } {
  const n = Math.min(Math.max(parseInt(String(limit), 10) || 5, 1), MAX_SNAPSHOT_LIMIT);
  const types: SnapshotType[] = isSnapshotType(type) ? [type] : ['alarm', 'motion'];
  const items = types
    .flatMap((tp) => listSnapshotDir(snapshotDir(tp)).map((m) => ({ ...m, type: tp })))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, n);
  return { items };
}

export function getSnapshotImage(homey: WidgetHomey, type: unknown, filename: unknown) {
  if (!isSnapshotType(type) || !isValidSnapshotFilename(filename)) {
    throw new Error(t(homey, 'api.invalid_type_or_filename'));
  }
  return { data: readSnapshotBase64(type, filename) };
}
