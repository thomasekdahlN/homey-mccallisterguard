import { vi } from 'vitest';
import AlarmController from '../../lib/AlarmController';
import ArmingChecks from '../../lib/ArmingChecks';
import EventLog from '../../lib/EventLog';
import ModeController from '../../lib/ModeController';
import Notifier from '../../lib/Notifier';
import PerimeterGuard from '../../lib/PerimeterGuard';
import SensorMonitor from '../../lib/SensorMonitor';
import StateMachine from '../../lib/StateMachine';
import Tasks from '../../lib/Tasks';
import { DEFAULT_SETTINGS, GuardSettings } from '../../lib/types';
import { createMockHomey } from './mockHomey';

/**
 * Wires the real controllers (state machine, alarm, mode, sensors, perimeter) against fakes for
 * everything that touches Homey devices. Call after vi.useFakeTimers() so timers are controllable.
 */
export function createHarness(overrides: Partial<GuardSettings> = {}) {
  const triggers: Record<string, ReturnType<typeof vi.fn>> = {};
  const homey = {
    ...createMockHomey(),
    flow: {
      getTriggerCard: vi.fn((id: string) => {
        triggers[id] = triggers[id] ?? vi.fn(async () => undefined);
        return { trigger: triggers[id] };
      }),
    },
    notifications: { createNotification: vi.fn(async () => undefined) },
    clock: { getTimezone: () => 'Europe/Oslo' },
  };

  const settings: GuardSettings = { ...DEFAULT_SETTINGS, entry_delay: 30, exit_delay: 0, ...overrides };
  const getSettings = () => settings;

  const log = new EventLog(homey as never);
  const stateMachine = new StateMachine(homey as never, log);
  const tasks = new Tasks(homey as never, log);
  const notifier = new Notifier(homey as never);

  const deterrence = {
    handleMotion: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    runDirect: vi.fn(async () => undefined),
    onDeterrenceStarted: vi.fn(),
  };
  const escalation = {
    cancel: vi.fn(async () => undefined),
    triggerCrisis: vi.fn(async () => undefined),
  };
  const media = { stopAll: vi.fn(async () => undefined) };
  const zones = {
    resolveNames: vi.fn(async (zoneId: string, deviceId: string) => ({ zoneName: `zone-${zoneId}`, deviceName: `dev-${deviceId}` })),
    labelOf: (id: string) => id,
  };
  const snapshots = { getFresh: () => null };
  const simulation = { start: vi.fn(), stop: vi.fn() };
  const armingChecks = {
    checkOpenContactSensors: vi.fn(async () => undefined),
    runHealthCheck: vi.fn(async () => undefined),
  };
  const cameras = {
    captureMotionBurst: vi.fn(async () => undefined),
    refreshZoneCache: vi.fn(async () => undefined),
  };
  const homeyApi = { devices: { getDevices: vi.fn(async () => ({})) } };

  const perimeter = new PerimeterGuard(homey as never, homeyApi, log, getSettings);
  const alarm = new AlarmController(
    homey as never, log, stateMachine, deterrence as never, escalation as never, media as never,
    notifier, zones as never, snapshots as never, tasks, getSettings,
  );
  const modes = new ModeController(
    homey as never, log, stateMachine, alarm, perimeter, simulation as never, armingChecks as never, notifier, getSettings,
  );
  const sensors = new SensorMonitor(
    homey as never, homeyApi, log, stateMachine, alarm, deterrence as never, cameras as never, perimeter, zones as never, getSettings,
  );
  alarm.start();
  modes.start();

  return {
    homey, settings, log, stateMachine, alarm, modes, sensors, perimeter, deterrence, escalation, media,
    simulation, armingChecks, cameras, triggers, zones, homeyApi,
  };
}

export type Harness = ReturnType<typeof createHarness>;

/** Lets pending microtasks (awaited mocks) settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}
