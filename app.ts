'use strict';

import Homey from 'homey';
import { HomeyAPI } from 'homey-api';
import AlarmController from './lib/AlarmController';
import ArmingChecks from './lib/ArmingChecks';
import ArmingScheduler from './lib/ArmingScheduler';
import CameraManager from './lib/CameraManager';
import DeterrenceEngine from './lib/DeterrenceEngine';
import EscalationManager from './lib/EscalationManager';
import EventLog from './lib/EventLog';
import FlowCards from './lib/FlowCards';
import MediaCaster from './lib/MediaCaster';
import ModeController from './lib/ModeController';
import Notifier from './lib/Notifier';
import PerimeterGuard from './lib/PerimeterGuard';
import SensorMonitor from './lib/SensorMonitor';
import SettingsStore from './lib/SettingsStore';
import SimulationEngine from './lib/SimulationEngine';
import SnapshotRelay from './lib/SnapshotRelay';
import StateMachine from './lib/StateMachine';
import Tasks from './lib/Tasks';
import ZoneDirectory from './lib/ZoneDirectory';
import { registerMediaTokens } from './lib/MediaTokens';
import type { GuardServices } from './lib/services';
import { t } from './lib/i18n';

/**
 * Composition root: creates the services, wires them together and starts them. It contains no
 * business logic — that lives in the single-purpose classes under lib/.
 */
class McCallisterGuardApp extends Homey.App {

  /** Exposed to api.ts (the settings page backend). */
  public services!: GuardServices;

  private sensors!: SensorMonitor;
  private scheduler!: ArmingScheduler;
  private zones!: ZoneDirectory;

  async onInit(): Promise<void> {
    this.log('McCallister Guard starter opp…');

    const eventLog = new EventLog(this.homey);
    const tasks = new Tasks(this.homey, eventLog);
    // Without the Homey API nothing works — retry with backoff instead of failing on a slow boot.
    const homeyApi = await tasks.retry('homey-api', () => (HomeyAPI as any).createAppAPI({ homey: this.homey }), 6);

    const settings = new SettingsStore(this.homey, eventLog);
    const getSettings = () => settings.get();

    const zones = new ZoneDirectory(this.homey, homeyApi);
    eventLog.setZoneNameResolver((id) => zones.nameOf(id));
    await zones.start();

    const notifier = new Notifier(this.homey);
    const stateMachine = new StateMachine(this.homey, eventLog);

    const media = new MediaCaster(this.homey, homeyApi, eventLog, getSettings);
    const deterrence = new DeterrenceEngine(this.homey, eventLog, media, getSettings);
    const escalation = new EscalationManager(this.homey, homeyApi, eventLog);
    const simulation = new SimulationEngine(this.homey, homeyApi, eventLog, getSettings);
    const cameras = new CameraManager(this.homey, homeyApi, eventLog, getSettings);
    // Before an alarm-burst, turn on the lights in the motion zone so the camera captures a lit scene.
    cameras.setFlashCallback((zoneId) => media.turnOnZoneLights(zoneId));
    settings.onSaved(() => { cameras.refreshZoneCache().catch(() => { /* best-effort */ }); });

    const snapshots = new SnapshotRelay(this.homey, eventLog, stateMachine, zones);
    snapshots.attach(cameras);

    const perimeter = new PerimeterGuard(this.homey, homeyApi, eventLog, getSettings);
    const armingChecks = new ArmingChecks(this.homey, homeyApi, eventLog, notifier, getSettings);
    const alarm = new AlarmController(
      this.homey, eventLog, stateMachine, deterrence, escalation, media, notifier, zones, snapshots, tasks, getSettings,
    );
    const modes = new ModeController(
      this.homey, eventLog, stateMachine, alarm, perimeter, simulation, armingChecks, notifier, getSettings,
    );
    const sensors = new SensorMonitor(
      this.homey, homeyApi, eventLog, stateMachine, alarm, deterrence, cameras, perimeter, zones, getSettings,
    );
    const scheduler = new ArmingScheduler(this.homey, eventLog, stateMachine, modes, alarm, getSettings);
    const flowCards = new FlowCards(
      this.homey, eventLog, stateMachine, modes, alarm, perimeter, sensors, settings, zones, notifier,
    );

    this.services = {
      homeyApi, eventLog, settings, stateMachine, modes, alarm, sensors, perimeter, deterrence, escalation, simulation, cameras, zones,
    };
    this.sensors = sensors;
    this.scheduler = scheduler;
    this.zones = zones;

    alarm.start();
    modes.start();
    await alarm.recoverInterruptedState();
    flowCards.register();
    // Media tokens are a convenience — a failure here must never prevent the guard from starting.
    await registerMediaTokens(this.homey).catch((err) => {
      eventLog.add('warning', t(this.homey, 'app.task_failed', { error: (err as Error).message }));
    });
    // Sensor listeners are retried in the background so a slow device manager can't block startup.
    sensors.start();

    if (stateMachine.getMode() === 'armed') simulation.start();
    scheduler.start();
    this.log('McCallister Guard initialisert.');
  }

  async onUninit(): Promise<void> {
    this.sensors?.stop();
    this.scheduler?.stop();
    this.zones?.stop();
  }

}

module.exports = McCallisterGuardApp;
