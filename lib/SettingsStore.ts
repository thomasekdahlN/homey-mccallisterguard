'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import { DEFAULT_SETTINGS, GuardSettings, SETTINGS_KEYS } from './types';
import { sanitizeSettingsPatch } from './settingsValidation';
import { t } from './i18n';

export type SettingsListener = (settings: GuardSettings) => void;

/** Single access point for the persisted user settings (defaults + validation). */
export default class SettingsStore {

  private listeners: SettingsListener[] = [];

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
  ) { }

  get(): GuardSettings {
    const stored = this.homey.settings.get(SETTINGS_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  /** Merges a settings patch. Unknown keys and invalid values are dropped, numbers are clamped. */
  save(patch: Partial<GuardSettings>): GuardSettings {
    const merged: GuardSettings = { ...this.get(), ...sanitizeSettingsPatch(patch) };
    this.homey.settings.set(SETTINGS_KEYS.SETTINGS, merged);
    for (const listener of this.listeners) {
      try { listener(merged); } catch { /* best-effort */ }
    }
    return merged;
  }

  /** Called after every successful save (e.g. to refresh caches that depend on settings). */
  onSaved(listener: SettingsListener): void {
    this.listeners.push(listener);
  }

  setCameraMotionEnabled(enabled: boolean): void {
    this.save({ camera_motion_enabled: enabled });
    const state = t(this.homey, enabled ? 'common.enabled' : 'common.disabled');
    this.log.add('info', t(this.homey, 'app.motion_snapshots_toggled', { state }));
  }

}
