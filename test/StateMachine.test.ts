import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import StateMachine from '../lib/StateMachine';
import EventLog from '../lib/EventLog';
import { SETTINGS_KEYS } from '../lib/types';
import { createMockHomey } from './helpers/mockHomey';

describe('StateMachine', () => {
  let homey: ReturnType<typeof createMockHomey>;
  let log: EventLog;

  beforeEach(() => {
    vi.useFakeTimers();
    homey = createMockHomey();
    log = new EventLog(homey as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starter i disarmed når ingen lagret modus finnes', () => {
    const sm = new StateMachine(homey as never, log);
    expect(sm.getMode()).toBe('disarmed');
  });

  it('laster modus fra settings', () => {
    homey.settings._store[SETTINGS_KEYS.MODE] = 'armed_perimeter';
    const sm = new StateMachine(homey as never, log);
    expect(sm.getMode()).toBe('armed_perimeter');
  });

  it('endrer modus umiddelbart uten exit-delay', async () => {
    const sm = new StateMachine(homey as never, log);
    await sm.setMode('armed_perimeter');
    expect(sm.getMode()).toBe('armed_perimeter');
    expect(homey.settings._store[SETTINGS_KEYS.MODE]).toBe('armed_perimeter');
  });

  it('lagrer og leser tidspunkt for siste modus-endring', async () => {
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    const sm = new StateMachine(homey as never, log);
    await sm.setMode('armed_perimeter');
    const ts = sm.getModeChangedAt();
    expect(ts).toBe(new Date('2025-06-01T12:00:00Z').getTime());
    expect(homey.settings._store[SETTINGS_KEYS.MODE_CHANGED_AT]).toBe(ts);
  });

  it('utsetter armed med exit-delay', async () => {
    const sm = new StateMachine(homey as never, log);
    await sm.setMode('armed', 30);

    expect(sm.getMode()).toBe('disarmed');
    expect(sm.isExitDelayActive()).toBe(true);

    vi.advanceTimersByTime(30_000);
    expect(sm.getMode()).toBe('armed');
    expect(sm.isExitDelayActive()).toBe(false);
  });

  it('kaller listeners ved modus-endring', async () => {
    const sm = new StateMachine(homey as never, log);
    const listener = vi.fn();
    sm.onModeChange(listener);

    await sm.setMode('armed_perimeter');
    expect(listener).toHaveBeenCalledWith('armed_perimeter', 'disarmed');
  });

  it('ignorerer setMode når modus er uendret', async () => {
    const sm = new StateMachine(homey as never, log);
    const listener = vi.fn();
    sm.onModeChange(listener);

    await sm.setMode('disarmed');
    expect(listener).not.toHaveBeenCalled();
  });

  it('startEntryDelay kaller callback etter angitt tid', () => {
    const sm = new StateMachine(homey as never, log);
    const cb = vi.fn();

    sm.startEntryDelay(20, cb);
    expect(sm.isEntryDelayActive()).toBe(true);

    vi.advanceTimersByTime(20_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(sm.isEntryDelayActive()).toBe(false);
  });

  it('startEntryDelay ignoreres når timer allerede løper', () => {
    const sm = new StateMachine(homey as never, log);
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    sm.startEntryDelay(20, cb1);
    sm.startEntryDelay(20, cb2);

    vi.advanceTimersByTime(20_000);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
  });

  it('cancelEntryDelay stopper pågående nedtelling', () => {
    const sm = new StateMachine(homey as never, log);
    const cb = vi.fn();

    sm.startEntryDelay(20, cb);
    sm.cancelEntryDelay();
    vi.advanceTimersByTime(20_000);

    expect(cb).not.toHaveBeenCalled();
    expect(sm.isEntryDelayActive()).toBe(false);
  });

  it('setMode rydder eksisterende exit/entry-timere', async () => {
    const sm = new StateMachine(homey as never, log);
    const cb = vi.fn();
    sm.startEntryDelay(20, cb);

    await sm.setMode('armed_perimeter');
    expect(sm.isEntryDelayActive()).toBe(false);

    vi.advanceTimersByTime(20_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('feilende listener stopper ikke øvrige listeners', async () => {
    const sm = new StateMachine(homey as never, log);
    const broken = vi.fn(() => { throw new Error('boom'); });
    const ok = vi.fn();
    sm.onModeChange(broken);
    sm.onModeChange(ok);

    await sm.setMode('armed_perimeter');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  describe('modusoverganger', () => {
    it('tillater armed → armed_perimeter (manuell overstyring)', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed');
      await sm.setMode('armed_perimeter');
      expect(sm.getMode()).toBe('armed_perimeter');
    });

    it('tillater armed_perimeter → armed', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed_perimeter');
      await sm.setMode('armed');
      expect(sm.getMode()).toBe('armed');
    });

    it('tillater disarmed → armed → disarmed → armed_perimeter → armed → disarmed', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed');
      expect(sm.getMode()).toBe('armed');
      await sm.setMode('disarmed');
      expect(sm.getMode()).toBe('disarmed');
      await sm.setMode('armed_perimeter');
      expect(sm.getMode()).toBe('armed_perimeter');
      await sm.setMode('armed');
      expect(sm.getMode()).toBe('armed');
      await sm.setMode('disarmed');
      expect(sm.getMode()).toBe('disarmed');
    });
  });

  describe('deterrence og alarm-modus', () => {
    it('tillater armed_perimeter → deterrence → alarm → disarmed', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed_perimeter');
      await sm.setMode('deterrence');
      expect(sm.getMode()).toBe('deterrence');
      await sm.setMode('alarm');
      expect(sm.getMode()).toBe('alarm');
      await sm.setMode('disarmed');
      expect(sm.getMode()).toBe('disarmed');
    });

    it('tillater armed → deterrence → alarm → armed', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed');
      vi.advanceTimersByTime(0); // flush any pending timers
      await sm.setMode('deterrence');
      await sm.setMode('alarm');
      await sm.setMode('armed');
      expect(sm.getMode()).toBe('armed');
    });

    it('tillater deterrence → armed_perimeter (stopp alarm uten å gå via disarmed)', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed_perimeter');
      await sm.setMode('deterrence');
      await sm.setMode('armed_perimeter');
      expect(sm.getMode()).toBe('armed_perimeter');
    });

    it('tillater disarmed → deterrence (test-modus)', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('deterrence');
      expect(sm.getMode()).toBe('deterrence');
    });

    it('tillater disarmed → alarm (test-modus)', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('alarm');
      expect(sm.getMode()).toBe('alarm');
    });

    it('tillater armed_perimeter → perimeter_alarm → armed_perimeter (avvis og tilbake til skallsikring)', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed_perimeter');
      await sm.setMode('perimeter_alarm');
      expect(sm.getMode()).toBe('perimeter_alarm');
      await sm.setMode('armed_perimeter');
      expect(sm.getMode()).toBe('armed_perimeter');
    });

    it('tillater armed_perimeter → perimeter_alarm → disarmed', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed_perimeter');
      await sm.setMode('perimeter_alarm');
      await sm.setMode('disarmed');
      expect(sm.getMode()).toBe('disarmed');
    });

    it('tillater perimeter_alarm → deterrence (alle overganger er åpne)', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('armed_perimeter');
      await sm.setMode('perimeter_alarm');
      await sm.setMode('deterrence');
      expect(sm.getMode()).toBe('deterrence');
    });

    it('tillater alarm → deterrence (alle overganger er åpne)', async () => {
      const sm = new StateMachine(homey as never, log);
      await sm.setMode('alarm');
      await sm.setMode('deterrence');
      expect(sm.getMode()).toBe('deterrence');
    });

    it('kaller listener ved deterrence- og alarm-overganger', async () => {
      const sm = new StateMachine(homey as never, log);
      const listener = vi.fn();
      sm.onModeChange(listener);
      await sm.setMode('armed_perimeter');
      await sm.setMode('deterrence');
      await sm.setMode('alarm');
      expect(listener).toHaveBeenNthCalledWith(1, 'armed_perimeter', 'disarmed');
      expect(listener).toHaveBeenNthCalledWith(2, 'deterrence', 'armed_perimeter');
      expect(listener).toHaveBeenNthCalledWith(3, 'alarm', 'deterrence');
    });
  });
});

describe('StateMachine entry delay cancel', () => {
  it('melder forløpt tid når inngangsforsinkelsen avbrytes', () => {
    vi.useFakeTimers();
    const homey = createMockHomey();
    const sm = new StateMachine(homey as never, new EventLog(homey as never));
    const listener = vi.fn();
    sm.onEntryDelayCancelled(listener);
    sm.startEntryDelay(60, () => undefined);
    vi.advanceTimersByTime(12_500);
    sm.cancelEntryDelay();
    expect(listener).toHaveBeenCalledWith(12.5);
    sm.cancelEntryDelay();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('melder ikke når forsinkelsen går ut av seg selv', () => {
    vi.useFakeTimers();
    const homey = createMockHomey();
    const sm = new StateMachine(homey as never, new EventLog(homey as never));
    const listener = vi.fn();
    const onTimeout = vi.fn();
    sm.onEntryDelayCancelled(listener);
    sm.startEntryDelay(30, onTimeout);
    vi.advanceTimersByTime(30_000);
    sm.cancelEntryDelay();
    expect(onTimeout).toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
