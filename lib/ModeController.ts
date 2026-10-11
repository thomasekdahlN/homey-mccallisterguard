'use strict';

import type Homey from 'homey/lib/Homey';
import type AlarmController from './AlarmController';
import type ArmingChecks from './ArmingChecks';
import type EventLog from './EventLog';
import type Notifier from './Notifier';
import type PerimeterGuard from './PerimeterGuard';
import type SimulationEngine from './SimulationEngine';
import type StateMachine from './StateMachine';
import { isArmedPerimeterWindowActive } from './Schedule';
import { ALARM_COOLDOWN_MS, GuardSettings, Mode } from './types';
import { t } from './i18n';

/**
 * Decides whether a requested mode change is allowed (the guards), tears down what the old mode left
 * running, and runs the side effects of arming (open-door checks, Kevin simulation, notifications).
 */
export default class ModeController {

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
    private readonly stateMachine: StateMachine,
    private readonly alarm: AlarmController,
    private readonly perimeter: PerimeterGuard,
    private readonly simulation: SimulationEngine,
    private readonly armingChecks: ArmingChecks,
    private readonly notifier: Notifier,
    private readonly getSettings: () => GuardSettings,
  ) { }

  /** Wires the state machine so every mode change triggers its side effects. */
  start(): void {
    this.stateMachine.onModeChange((next, previous) => this.handleModeChange(next, previous));
  }

  /** True when the armed_perimeter auto-schedule is enabled and now falls inside its window. */
  isInPerimeterWindow(): boolean {
    return isArmedPerimeterWindowActive(this.getSettings(), this.homey.clock.getTimezone());
  }

  /**
   * Requests a mode change.
   * @param options.force - dashboard / scheduler calls that bypass the guards meant for flows.
   */
  async setMode(mode: Mode, { force = false }: { force?: boolean } = {}): Promise<void> {
    const current = this.stateMachine.getMode();
    if (current === mode && !this.stateMachine.isExitDelayActive()) return;

    // Guard: 'off' mode is GUI-only — only the dashboard (force=true) can enter or exit it.
    // Flows, the scheduler, and other internal callers cannot turn the app off or wake it from off.
    if ((mode === 'off' || current === 'off') && !force) {
      return;
    }

    // Guard: disarmed from armed_perimeter is silently ignored for external callers.
    // A smart-lock "authorised unlock" flow must not automatically disable perimeter mode —
    // residents can come home late without disarming the night guard.
    // The auto-scheduler bypasses this guard via { force: true }.
    // No log entry here: the set_mode flow card only logs when previous mode was armed, so
    // door-open flows that send set_mode=disarmed in perimeter mode produce no log noise.
    if (mode === 'disarmed' && current === 'armed_perimeter' && !force) {
      return;
    }

    // Auto-redirect: disarming from armed during the perimeter scheduler window activates
    // perimeter mode instead of fully disarming. This covers the case where a resident comes
    // home at night and their smart-lock flow sends set_mode=disarmed — the house switches to
    // night guard rather than going fully unarmed. Scheduler and force=true bypass this.
    // Exception: if an alarm ended recently, let the user fully disarm without re-arming perimeter.
    if (mode === 'disarmed' && current === 'armed' && !force && this.isInPerimeterWindow()) {
      if (!this.alarm.stoppedWithin(ALARM_COOLDOWN_MS)) {
        this.log.add('info', t(this.homey, 'app.away_disarm_redirect'));
        await this.setMode('armed_perimeter');
        return;
      }
      this.log.add('info', t(this.homey, 'app.disarm_after_alarm_redirect_suppressed'));
    }

    // Cleanup when leaving perimeter_alarm (user dismisses or disarms the soft alert).
    if (current === 'perimeter_alarm') {
      this.alarm.alarmStopped(t(this.homey, 'app.alarm_stopped_reason_perimeter_ended'));
      this.alarm.resetContext();
    }

    // Leaving deterrence/alarm for ANY other mode (disarm, re-arm from a flow, …) must stop all
    // alert effects and fire alarm_stopped — otherwise sirens/strobe keep running in the new mode
    // and flows that react to alarm_stopped never see the alert end.
    const leavingAlert = (current === 'deterrence' || current === 'alarm')
      && mode !== 'deterrence' && mode !== 'alarm';
    if (leavingAlert) {
      const disarming = mode === 'disarmed' || mode === 'off';
      this.alarm.alarmStopped(disarming
        ? t(this.homey, 'app.alarm_stopped_reason_disarmed')
        : t(this.homey, 'app.alarm_stopped_reason_mode_change', { mode }));
      await this.alarm.stopEffects();
      this.alarm.resetContext();
    }

    if (mode === 'disarmed' || mode === 'off') {
      await this.alarm.stopEffects();
      this.simulation.stop();
      this.alarm.resetContext();
    }

    // Clear the perimeter snapshot when leaving armed_perimeter (but not when entering perimeter_alarm —
    // it must remain valid while the alert is active and if dismissed back to perimeter mode).
    if (current === 'armed_perimeter' && mode !== 'armed_perimeter' && mode !== 'perimeter_alarm') {
      this.perimeter.clearOpenSnapshot();
    }

    // Snapshot open contact sensors before armed_perimeter activates so they can be ignored.
    // Skip re-snapshot when returning from perimeter_alarm — the snapshot is still valid.
    let openPerimeterNames: string[] = [];
    if (mode === 'armed_perimeter' && current !== 'perimeter_alarm') {
      openPerimeterNames = await this.perimeter.snapshotOpenSensors();
    }

    await this.stateMachine.setMode(mode, mode === 'armed' ? this.getSettings().exit_delay : 0);

    // One combined log entry for armed_perimeter activation (StateMachine skips logging for this mode).
    if (mode === 'armed_perimeter' && current !== 'perimeter_alarm') {
      await this.announcePerimeterActivation(openPerimeterNames);
    }

    // Warn about open door/window sensors when arming in away mode.
    if (mode === 'armed') {
      this.armingChecks.checkOpenContactSensors().catch(() => { /* best-effort */ });
    }
  }

  private async announcePerimeterActivation(openNames: string[]): Promise<void> {
    if (openNames.length === 0) {
      this.log.add('info', t(this.homey, 'app.perimeter_activated'));
      return;
    }
    const names = openNames.join(', ');
    const msg = t(this.homey, 'app.perimeter_activated_open_sensors', { count: openNames.length, names });
    this.log.add('info', msg);
    this.notifier.timeline(`ℹ️ ${msg}`);
    try {
      await this.homey.flow.getTriggerCard('open_sensors_at_arming').trigger({
        count: openNames.length,
        names,
        mode: 'armed_perimeter',
      });
    } catch { /* best-effort */ }
  }

  private handleModeChange(next: Mode, previous: Mode): void {
    if (next === 'armed') {
      this.simulation.start();
    } else {
      this.simulation.stop();
    }
    if (next !== 'disarmed' && next !== 'off' && (previous === 'disarmed' || previous === 'off')) {
      this.armingChecks.runHealthCheck().catch(() => { /* best-effort */ });
    }
    // perimeter_alarm push is handled by AlarmController with sensor + zone detail.
    if (next !== 'perimeter_alarm') {
      this.notifier.timeline(this.notifier.modeLabel(next));
    }
    try {
      this.homey.flow.getTriggerCard('mode_changed').trigger({
        mode_new: next,
        mode_previous: previous,
      }, { mode_new: next }).catch(() => { /* best-effort */ });
    } catch { /* best-effort */ }
  }

}
