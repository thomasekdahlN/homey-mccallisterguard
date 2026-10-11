'use strict';

import type AlarmController from './AlarmController';
import type CameraManager from './CameraManager';
import type DeterrenceEngine from './DeterrenceEngine';
import type EscalationManager from './EscalationManager';
import type EventLog from './EventLog';
import type ModeController from './ModeController';
import type PerimeterGuard from './PerimeterGuard';
import type SensorMonitor from './SensorMonitor';
import type SettingsStore from './SettingsStore';
import type SimulationEngine from './SimulationEngine';
import type StateMachine from './StateMachine';
import type ZoneDirectory from './ZoneDirectory';

/** The wired-up services of the running app, exposed to the settings page API (api.ts). */
export interface GuardServices {
  homeyApi: any;
  eventLog: EventLog;
  settings: SettingsStore;
  stateMachine: StateMachine;
  modes: ModeController;
  alarm: AlarmController;
  sensors: SensorMonitor;
  perimeter: PerimeterGuard;
  deterrence: DeterrenceEngine;
  escalation: EscalationManager;
  simulation: SimulationEngine;
  cameras: CameraManager;
  zones: ZoneDirectory;
}
