'use strict';

import type Homey from 'homey/lib/Homey';
import type AlarmController from './AlarmController';
import type EventLog from './EventLog';
import type ModeController from './ModeController';
import type StateMachine from './StateMachine';
import { ALARM_COOLDOWN_MS, GuardSettings } from './types';
import { t } from './i18n';

const TICK_MS = 60_000;

/** Automatic daily activation/deactivation of armed_perimeter (Skallsikring). */
export default class ArmingScheduler {

  private timer: NodeJS.Timeout | null = null;
  private lastWindowState: boolean | null = null;

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
    private readonly stateMachine: StateMachine,
    private readonly modes: ModeController,
    private readonly alarm: AlarmController,
    private readonly getSettings: () => GuardSettings,
  ) { }

  /**
   * Checks every 60 s whether auto-arming should fire. Also runs immediately on startup so an
   * overnight window is respected when the app restarts.
   */
  start(): void {
    this.check(true);
    this.timer = this.homey.setInterval(() => { this.check(false); }, TICK_MS);
  }

  stop(): void {
    if (this.timer) this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Evaluates the schedule against the current time.
   *
   * Only fires on window transitions (open→closed, closed→open) detected by comparing the current
   * window state to the last known state. At startup we only record the current state so the first
   * tick never produces a false transition — the persisted mode already reflects what was active
   * before the restart, so no forced activation/deactivation is needed.
   */
  check(startup: boolean): void {
    if (!this.getSettings().armed_perimeter_auto) return;

    const inWindow = this.modes.isInPerimeterWindow();

    if (startup) {
      this.lastWindowState = inWindow;
      return;
    }

    // Act only when the window state changes — robust against timer drift.
    if (this.lastWindowState === inWindow) return;
    this.lastWindowState = inWindow;

    const mode = this.stateMachine.getMode();
    // The scheduler may ONLY activate armed_perimeter from 'disarmed'. It must never override
    // 'armed' (Away) — manual mode changes are required for that. It also stays quiet for
    // ALARM_COOLDOWN_MS after an alarm ends so the user can fully disarm.
    if (inWindow && mode === 'disarmed') {
      if (this.alarm.stoppedWithin(ALARM_COOLDOWN_MS)) {
        this.log.add('info', t(this.homey, 'app.perimeter_autostart_deferred'));
      } else {
        this.modes.setMode('armed_perimeter').catch(() => { /* best-effort */ });
      }
    } else if (!inWindow && mode === 'armed_perimeter') {
      this.log.add('info', t(this.homey, 'app.perimeter_deactivated'));
      this.modes.setMode('disarmed', { force: true }).catch(() => { /* best-effort */ });
    }
  }

}
