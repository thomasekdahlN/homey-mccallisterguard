'use strict';

import type Homey from 'homey/lib/Homey';
import type AlarmController from './AlarmController';
import type EventLog from './EventLog';
import type ModeController from './ModeController';
import type Notifier from './Notifier';
import type PerimeterGuard from './PerimeterGuard';
import type SensorMonitor from './SensorMonitor';
import type SettingsStore from './SettingsStore';
import type StateMachine from './StateMachine';
import type ZoneDirectory from './ZoneDirectory';
import { mediaUrl } from './MediaTokens';
import { Mode } from './types';
import { t } from './i18n';

type ZoneArg = { id: string; name?: string };

/** Registers every flow action, condition and trigger-filter card. */
export default class FlowCards {

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
    private readonly stateMachine: StateMachine,
    private readonly modes: ModeController,
    private readonly alarm: AlarmController,
    private readonly perimeter: PerimeterGuard,
    private readonly sensors: SensorMonitor,
    private readonly settings: SettingsStore,
    private readonly zones: ZoneDirectory,
    private readonly notifier: Notifier,
  ) { }

  register(): void {
    this.registerActions();
    this.registerTriggerFilters();
    this.registerConditions();
  }

  // ── Actions ─────────────────────────────────────────────────────

  private registerActions(): void {
    const { flow } = this.homey;
    flow.getActionCard('set_mode').registerRunListener(
      async (args: { mode: Mode; name?: string; comment?: string }) => this.runSetMode(args),
    );
    flow.getActionCard('set_camera_motion').registerRunListener(async (args: { enabled: 'enable' | 'disable' }) => {
      this.settings.setCameraMotionEnabled(args.enabled === 'enable');
      return true;
    });
    flow.getActionCard('cancel_entry_delay').registerRunListener(async () => {
      this.sensors.cancelEntryDelay();
      return true;
    });
    flow.getActionCard('bypass_perimeter').registerRunListener(async (args: { duration: number }) => {
      this.perimeter.bypass(Math.max(5, Math.round(args.duration)));
      return true;
    });
    const deterrenceCard = flow.getActionCard('trigger_deterrence');
    deterrenceCard.registerRunListener(async (args: { zone: ZoneArg }) => {
      await this.alarm.testDeterrence(args.zone.id);
      return true;
    });
    deterrenceCard.registerArgumentAutocompleteListener('zone', async (query: string) => this.zones.autocomplete(query));
    flow.getActionCard('trigger_alarm').registerRunListener(async () => {
      await this.alarm.testAlarm();
      return true;
    });
    flow.getActionCard('get_media_url').registerRunListener(async (args: { file: string }) => ({
      url: await mediaUrl(this.homey, args.file),
    }));
  }

  /**
   * set_mode: logs who came home / arrived (de-duplicated), then requests the mode change. Disarming
   * from perimeter mode is blocked by ModeController, but a named arrival is still recorded.
   */
  private async runSetMode(args: { mode: Mode; name?: string; comment?: string }): Promise<boolean> {
    const comment = args.comment?.trim() ?? '';
    const currentMode = this.stateMachine.getMode();

    if (args.mode === 'disarmed') {
      if (currentMode === 'armed') {
        await this.logDisarmFromAway(args.name, comment, currentMode);
      } else if (currentMode === 'armed_perimeter') {
        this.logArrivalInPerimeter(args.name, comment);
      } else if (comment) {
        // Disarm was a no-op (already disarmed), but a comment was set — log it.
        this.log.add('info', t(this.homey, 'app.comment_log', { comment }));
      }
    }

    await this.modes.setMode(args.mode);

    // For non-disarmed modes: log comment after setMode so it follows StateMachine's "Modus: [next]".
    if (comment && args.mode !== 'disarmed') {
      this.log.add('info', t(this.homey, 'app.comment_log', { comment }));
    }
    return true;
  }

  private async logDisarmFromAway(name: string | undefined, comment: string, previousMode: Mode): Promise<void> {
    // Disarming from Away (armed) — always log who came home.
    const who = (name?.trim() || t(this.homey, 'common.unknown')).replace(/^user:\s*/i, '');
    // Dedup: log and notify at most once per 15 min per source to prevent duplicate entries when
    // presence + door events both disarm simultaneously.
    if (!this.notifier.shouldNotify(`disarm:${who.toLowerCase()}`)) return;
    const msg = comment
      ? t(this.homey, 'app.disarmed_by_with_comment', { who, comment })
      : t(this.homey, 'app.disarmed_by', { who });
    this.log.add('info', msg);
    this.notifier.timeline(t(this.homey, 'app.disarmed_by_timeline', { who }));
    try {
      await this.homey.flow.getTriggerCard('alarm_disarmed').trigger({
        source: 'user',
        name: who,
        previous_mode: previousMode,
      });
    } catch { /* best-effort */ }
  }

  private logArrivalInPerimeter(name: string | undefined, comment: string): void {
    // The disarm is silently blocked in perimeter mode. But if a name was provided (someone came
    // home) the arrival is still logged — perimeter mode stays active intentionally.
    const who = name?.trim().replace(/^user:\s*/i, '');
    if (who) {
      if (!this.notifier.shouldNotify(`arrival:${who.toLowerCase()}`)) return;
      const msg = comment
        ? t(this.homey, 'app.arrival_with_comment', { who, comment })
        : t(this.homey, 'app.arrival', { who });
      this.log.add('info', msg);
      this.notifier.timeline(t(this.homey, 'app.arrival_timeline', { who }));
    } else if (comment) {
      this.log.add('info', t(this.homey, 'app.comment_log', { comment }));
    }
  }

  // ── Trigger filters ─────────────────────────────────────────────

  /** Registers a trigger-card filter; a failure must not stop the other cards from registering. */
  private trigger(
    id: string,
    listener: (args: any, state: any) => boolean,
    { zoneAutocomplete = false }: { zoneAutocomplete?: boolean } = {},
  ): void {
    try {
      const card = this.homey.flow.getTriggerCard(id);
      card.registerRunListener(async (args: any, state: any) => listener(args, state));
      if (zoneAutocomplete) {
        card.registerArgumentAutocompleteListener('zone', async (query: string) => this.zones.autocomplete(query));
      }
    } catch (err) {
      this.log.add('warning', t(this.homey, 'app.task_failed', { error: `${id}: ${(err as Error).message}` }));
    }
  }

  private registerTriggerFilters(): void {
    // Absent zone arg (old flow without the arg) is treated as a wildcard.
    const zoneMatches = (args: { zone?: ZoneArg }, state: { zoneId: string }): boolean => !args.zone || args.zone.id === state.zoneId;
    // '*' or absent means "any".
    const anyOrEqual = (arg: string | undefined, actual: string): boolean => !arg || arg === '*' || arg === actual;

    this.trigger('kevin_zone_on', zoneMatches, { zoneAutocomplete: true });
    this.trigger('kevin_zone_off', zoneMatches, { zoneAutocomplete: true });
    this.trigger('alarm_perimeter_triggered', zoneMatches, { zoneAutocomplete: true });
    this.trigger('snapshot_taken', zoneMatches, { zoneAutocomplete: true });
    this.trigger('mode_changed', (args: { mode_new?: string }, state: { mode_new: string }) => anyOrEqual(args.mode_new, state.mode_new));
    this.trigger('open_sensors_at_arming', (args: { mode?: string }, state: { mode: string }) => anyOrEqual(args.mode, state.mode));
    // alarm_triggered — filter on zone (include/exclude) + sensor type.
    this.trigger('alarm_triggered', (
      args: { zone_filter?: string; zone?: ZoneArg; sensor_type?: string },
      state: { zoneId: string; sensorType: string },
    ) => {
      let zoneMatch = true;
      if (args.zone) {
        zoneMatch = args.zone_filter === 'exclude' ? args.zone.id !== state.zoneId : args.zone.id === state.zoneId;
      }
      return zoneMatch && anyOrEqual(args.sensor_type, state.sensorType);
    }, { zoneAutocomplete: true });
  }

  // ── Conditions ──────────────────────────────────────────────────

  private registerConditions(): void {
    const { flow } = this.homey;
    flow.getConditionCard('alarm_active').registerRunListener(async () => this.stateMachine.getMode() === 'alarm');
    flow.getConditionCard('alert_active').registerRunListener(async () => {
      const m = this.stateMachine.getMode();
      return m === 'deterrence' || m === 'alarm';
    });
    flow.getConditionCard('alarm_perimeter_active').registerRunListener(async () => {
      const m = this.stateMachine.getMode();
      return m === 'armed_perimeter' || m === 'perimeter_alarm';
    });
    flow.getConditionCard('get_mode').registerRunListener(async (args: { mode: Mode }) => this.stateMachine.getMode() === args.mode);
    const inZone = flow.getConditionCard('alarm_triggered_in_zone');
    inZone.registerRunListener(async (args: { zone: ZoneArg }) => this.alarm.getContext()?.zoneId === args.zone.id);
    inZone.registerArgumentAutocompleteListener('zone', async (query: string) => this.zones.autocomplete(query));
  }

}
