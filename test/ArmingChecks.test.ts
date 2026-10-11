import { describe, expect, it, vi } from 'vitest';
import ArmingChecks from '../lib/ArmingChecks';
import { DEFAULT_SETTINGS, GuardSettings } from '../lib/types';
import { createMockHomey } from './helpers/mockHomey';

function contact(id: string, open: boolean) {
  return { id, name: `Sensor ${id}`, capabilities: ['alarm_contact'], capabilitiesObj: { alarm_contact: { value: open } } };
}

function setup(devices: unknown[], overrides: Partial<GuardSettings> = {}) {
  const trigger = vi.fn(async () => undefined);
  const homey = {
    ...createMockHomey(),
    flow: { getTriggerCard: vi.fn(() => ({ trigger })) },
  };
  const log = { add: vi.fn() };
  const notifier = { timeline: vi.fn() };
  const homeyApi = { devices: { getDevices: vi.fn(async () => Object.fromEntries((devices as { id: string }[]).map((d) => [d.id, d]))) } };
  const checks = new ArmingChecks(homey as never, homeyApi, log as never, notifier as never, () => ({ ...DEFAULT_SETTINGS, ...overrides }));
  return { checks, trigger, log, notifier };
}

describe('ArmingChecks.checkOpenContactSensors', () => {
  it('rapporterer alle åpne kontaktsensorer som standard', async () => {
    const { checks, trigger } = setup([contact('a', true), contact('b', true), contact('c', false)]);
    await checks.checkOpenContactSensors();
    expect(trigger).toHaveBeenCalledWith({ count: 2, names: 'Sensor a, Sensor b', mode: 'armed' }, { mode: 'armed' });
  });

  it('hopper over sensorer som er valgt bort (innerdører)', async () => {
    const { checks, trigger } = setup([contact('inner', true), contact('front', true)], { arming_check_excluded: ['inner'] });
    await checks.checkOpenContactSensors();
    expect(trigger).toHaveBeenCalledWith({ count: 1, names: 'Sensor front', mode: 'armed' }, { mode: 'armed' });
  });

  it('gir ingen varsling når alle åpne sensorer er valgt bort', async () => {
    const { checks, trigger, notifier } = setup([contact('inner', true)], { arming_check_excluded: ['inner'] });
    await checks.checkOpenContactSensors();
    expect(trigger).not.toHaveBeenCalled();
    expect(notifier.timeline).not.toHaveBeenCalled();
  });
});

describe('ArmingChecks.runHealthCheck', () => {
  it('varsler om sensorer som er offline', async () => {
    const offline = { ...contact('x', false), available: false };
    const { checks, trigger } = setup([offline, contact('y', false)]);
    await checks.runHealthCheck();
    expect(trigger).toHaveBeenCalledWith({ offline_count: 1 });
  });
});
