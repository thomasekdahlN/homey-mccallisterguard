import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SETTINGS_KEYS } from '../lib/types';
import { createHarness, Harness } from './helpers/guardHarness';

describe('AlarmController', () => {
  let h: Harness;
  beforeEach(() => { vi.useFakeTimers(); h = createHarness(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stopAlarm går tilbake til armert modus alarmen kom fra', async () => {
    await h.modes.setMode('armed');
    await h.alarm.enterDeterrence('z', 'd', 'contact', 'intrusion');
    expect(h.stateMachine.getMode()).toBe('deterrence');
    await h.alarm.stopAlarm();
    expect(h.stateMachine.getMode()).toBe('armed');
    expect(h.triggers.alarm_stopped).toHaveBeenCalledTimes(1);
    expect(h.alarm.getContext()).toBeNull();
  });

  it('husker forrige armerte modus på tvers av omstart og gjenoppretter ved start', async () => {
    await h.modes.setMode('armed_perimeter');
    await h.alarm.enterDeterrence('z', 'd', 'contact', 'perimeter');
    expect(h.homey.settings._store[SETTINGS_KEYS.PREVIOUS_ARMED_MODE]).toBe('armed_perimeter');

    // «Omstart»: nye objekter mot samme lagrede innstillinger, modus står fast i deterrence.
    const restarted = createHarness();
    Object.assign(restarted.homey.settings._store, h.homey.settings._store);
    const stateMachine = new (await import('../lib/StateMachine')).default(restarted.homey as never, restarted.log);
    expect(stateMachine.getMode()).toBe('deterrence');
    const AlarmController = (await import('../lib/AlarmController')).default;
    const alarm = new AlarmController(
      restarted.homey as never, restarted.log, stateMachine, restarted.deterrence as never, restarted.escalation as never,
      restarted.media as never, new (await import('../lib/Notifier')).default(restarted.homey as never), restarted.zones as never,
      { getFresh: () => null } as never, new (await import('../lib/Tasks')).default(restarted.homey as never, restarted.log),
      () => restarted.settings,
    );
    alarm.start();
    await alarm.recoverInterruptedState();
    expect(stateMachine.getMode()).toBe('armed_perimeter');
  });

  it('gjenoppretter uten lagret modus til armed (deterrence/alarm) eller armed_perimeter (perimeter_alarm)', async () => {
    await h.stateMachine.setMode('alarm');
    await h.alarm.recoverInterruptedState();
    expect(h.stateMachine.getMode()).toBe('armed');
    await h.stateMachine.setMode('perimeter_alarm');
    await h.alarm.recoverInterruptedState();
    expect(h.stateMachine.getMode()).toBe('armed_perimeter');
  });

  it('testAlarm avsluttes automatisk og går tilbake', async () => {
    await h.modes.setMode('armed');
    await h.alarm.testAlarm();
    expect(h.stateMachine.getMode()).toBe('alarm');
    expect(h.alarm.isTestActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(h.alarm.isTestActive()).toBe(false);
    expect(h.stateMachine.getMode()).toBe('armed');
    expect(h.escalation.cancel).toHaveBeenCalled();
  });

  it('testAlarm avsluttes selv om krisen ikke kunne startes', async () => {
    h.escalation.triggerCrisis.mockRejectedValueOnce(new Error('boom'));
    await expect(h.alarm.testAlarm()).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(16_000);
    expect(h.alarm.isTestActive()).toBe(false);
    expect(h.stateMachine.getMode()).toBe('disarmed');
  });

  it('stoppedWithin reflekterer siste alarm-slutt', async () => {
    expect(h.alarm.stoppedWithin(60_000)).toBe(false);
    h.alarm.alarmStopped('x');
    expect(h.alarm.stoppedWithin(60_000)).toBe(true);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.alarm.stoppedWithin(60_000)).toBe(false);
  });
});
