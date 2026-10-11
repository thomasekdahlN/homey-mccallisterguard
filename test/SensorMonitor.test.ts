import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createHarness, flush, Harness } from './helpers/guardHarness';

describe('SensorMonitor – Borte (armed)', () => {
  let h: Harness;
  beforeEach(async () => {
    vi.useFakeTimers();
    h = createHarness({ entry_delay_sensors: ['door'] });
    await h.modes.setMode('armed');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('første bevegelse starter inngangsforsinkelse – alarm først når den utløper', async () => {
    await h.sensors.onMotion('hall', 'pir');
    expect(h.stateMachine.isEntryDelayActive()).toBe(true);
    expect(h.stateMachine.getMode()).toBe('armed');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(h.stateMachine.getMode()).toBe('deterrence');
  });

  it('andre bevegelse under nedtelling bekrefter innbrudd umiddelbart', async () => {
    await h.sensors.onMotion('hall', 'pir');
    await h.sensors.onMotion('living', 'pir2');
    expect(h.stateMachine.getMode()).toBe('deterrence');
  });

  it('bevegelse i gangen forkorter IKKE inngangsforsinkelsen startet av inngangsdøra', async () => {
    await h.sensors.onContact('hall', 'door');
    expect(h.stateMachine.isEntryDelayActive()).toBe(true);
    await h.sensors.onMotion('hall', 'pir');
    await h.sensors.onContact('hall', 'innerdoor');
    expect(h.stateMachine.getMode()).toBe('armed');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(h.stateMachine.getMode()).toBe('deterrence');
  });

  it('avbryt inngangsforsinkelse hindrer alarm', async () => {
    await h.sensors.onContact('hall', 'door');
    expect(h.sensors.cancelEntryDelay()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.stateMachine.getMode()).toBe('armed');
    expect(h.sensors.cancelEntryDelay()).toBe(false);
  });

  it('kontakt uten inngangsforsinkelse gir umiddelbar deterrence', async () => {
    await h.sensors.onContact('kitchen', 'window');
    expect(h.stateMachine.getMode()).toBe('deterrence');
    expect(h.triggers.alarm_triggered).toHaveBeenCalledTimes(1);
  });

  it('samtidige sensorer starter alarmen kun én gang', async () => {
    await Promise.all([
      h.sensors.onContact('a', 'w1'),
      h.sensors.onContact('b', 'w2'),
      h.sensors.onContact('c', 'w3'),
    ]);
    await flush();
    expect(h.triggers.alarm_triggered).toHaveBeenCalledTimes(1);
    expect(h.stateMachine.getMode()).toBe('deterrence');
  });

  it('eskalerer til full alarm etter escalation_minutes og fyrer alarm_escalated', async () => {
    await h.sensors.onContact('kitchen', 'window');
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
    expect(h.stateMachine.getMode()).toBe('alarm');
    expect(h.escalation.triggerCrisis).toHaveBeenCalledTimes(1);
    expect(h.triggers.alarm_escalated).toHaveBeenCalledTimes(1);
  });

  it('disarm under deterrence avbryter eskaleringstimeren', async () => {
    await h.sensors.onContact('kitchen', 'window');
    await h.modes.setMode('disarmed', { force: true });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.stateMachine.getMode()).toBe('disarmed');
    expect(h.escalation.triggerCrisis).not.toHaveBeenCalled();
  });

  it('ignorerer sensorer i disarmed og off', async () => {
    await h.modes.setMode('disarmed', { force: true });
    await h.sensors.onContact('kitchen', 'window');
    await h.sensors.onMotion('hall', 'pir');
    expect(h.stateMachine.getMode()).toBe('disarmed');
  });

  it('husker nylige bevegelsessoner', async () => {
    await h.sensors.onMotion('hall', 'pir');
    expect(h.sensors.getRecentMotionZones()).toEqual(['hall']);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.sensors.getRecentMotionZones()).toEqual([]);
  });
});

describe('SensorMonitor – Skallsikring (armed_perimeter)', () => {
  let h: Harness;
  beforeEach(async () => {
    vi.useFakeTimers();
    h = createHarness({
      perimeter_sensors: ['door', 'window', 'pir-out'],
      entry_delay_sensors: ['door'],
    });
    await h.modes.setMode('armed_perimeter');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('innendørs bevegelse som ikke er valgt som perimeter ignoreres', async () => {
    await h.sensors.onMotion('bath', 'pir-in');
    expect(h.stateMachine.isEntryDelayActive()).toBe(false);
  });

  it('perimeter-kontakt gir myk varsling (perimeter_alarm) etter forsinkelse, uten sirener', async () => {
    await h.sensors.onContact('kitchen', 'window');
    expect(h.stateMachine.getMode()).toBe('armed_perimeter');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(h.stateMachine.getMode()).toBe('perimeter_alarm');
    expect(h.triggers.alarm_perimeter_triggered).toHaveBeenCalledTimes(1);
    expect(h.escalation.triggerCrisis).not.toHaveBeenCalled();
  });

  it('inngangsdør starter auto-bypass slik at gangsensor ikke trigger', async () => {
    await h.sensors.onContact('hall', 'door');
    expect(h.perimeter.isBypassed()).toBe(true);
    await h.sensors.onMotion('hall', 'pir-out');
    await h.sensors.onContact('kitchen', 'window');
    expect(h.stateMachine.getMode()).toBe('armed_perimeter');
  });

  it('en andre perimeter-kontakt under nedtelling bekrefter umiddelbart', async () => {
    h.settings.perimeter_sensors = ['door', 'window', 'window2'];
    await h.sensors.onContact('kitchen', 'window');
    expect(h.stateMachine.isEntryDelayActive()).toBe(true);
    await h.sensors.onContact('living', 'window2');
    expect(h.stateMachine.getMode()).toBe('perimeter_alarm');
  });

  it('sensor som var åpen ved aktivering ignoreres', async () => {
    h.homeyApi.devices.getDevices.mockResolvedValue({
      window: { id: 'window', name: 'Vindu', capabilities: ['alarm_contact'], capabilitiesObj: { alarm_contact: { value: true } } },
    });
    await h.modes.setMode('disarmed', { force: true });
    await h.modes.setMode('armed_perimeter');
    await h.sensors.onContact('kitchen', 'window');
    expect(h.stateMachine.isEntryDelayActive()).toBe(false);
  });
});
