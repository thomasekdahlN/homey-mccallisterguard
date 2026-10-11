import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createHarness, flush, Harness } from './helpers/guardHarness';

describe('ModeController', () => {
  let h: Harness;
  beforeEach(() => { vi.useFakeTimers(); h = createHarness(); });
  afterEach(() => { vi.useRealTimers(); });

  it("'off' kan bare settes/forlates med force (GUI)", async () => {
    await h.modes.setMode('off');
    expect(h.stateMachine.getMode()).toBe('disarmed');
    await h.modes.setMode('off', { force: true });
    expect(h.stateMachine.getMode()).toBe('off');
    await h.modes.setMode('armed');
    expect(h.stateMachine.getMode()).toBe('off');
    await h.modes.setMode('armed', { force: true });
    expect(h.stateMachine.getMode()).toBe('armed');
  });

  it('ignorerer disarm fra Skallsikring uten force', async () => {
    await h.modes.setMode('armed_perimeter');
    await h.modes.setMode('disarmed');
    expect(h.stateMachine.getMode()).toBe('armed_perimeter');
    await h.modes.setMode('disarmed', { force: true });
    expect(h.stateMachine.getMode()).toBe('disarmed');
  });

  it('åpen-dør-sjekk kjøres ved Borte, ikke ved Skallsikring', async () => {
    await h.modes.setMode('armed_perimeter');
    expect(h.armingChecks.checkOpenContactSensors).not.toHaveBeenCalled();
    await h.modes.setMode('armed', { force: true });
    expect(h.armingChecks.checkOpenContactSensors).toHaveBeenCalledTimes(1);
  });

  it('Kevin-simulering følger Borte-modus', async () => {
    await h.modes.setMode('armed');
    expect(h.simulation.start).toHaveBeenCalled();
    await h.modes.setMode('disarmed', { force: true });
    expect(h.simulation.stop).toHaveBeenCalled();
  });

  it('omdirigerer disarm fra Borte til Skallsikring i nattvinduet', async () => {
    h.settings.armed_perimeter_auto = true;
    h.settings.armed_perimeter_on = '00:00';
    h.settings.armed_perimeter_off = '23:59'; // hele døgnet (unntatt ett minutt)
    vi.setSystemTime(new Date('2026-07-01T10:00:00Z'));
    await h.modes.setMode('armed');
    await h.modes.setMode('disarmed');
    expect(h.stateMachine.getMode()).toBe('armed_perimeter');
  });

  it('omdirigerer ikke rett etter en alarm (kan deaktivere helt)', async () => {
    h.settings.armed_perimeter_auto = true;
    h.settings.armed_perimeter_on = '00:00';
    h.settings.armed_perimeter_off = '23:59';
    vi.setSystemTime(new Date('2026-07-01T10:00:00Z'));
    await h.modes.setMode('armed');
    h.alarm.alarmStopped('test');
    await h.modes.setMode('disarmed');
    expect(h.stateMachine.getMode()).toBe('disarmed');
  });

  it('rydder opp og fyrer alarm_stopped når deterrence forlates for annen modus', async () => {
    await h.modes.setMode('armed');
    await h.stateMachine.setMode('deterrence');
    await h.modes.setMode('disarmed');
    await flush();
    expect(h.triggers.alarm_stopped).toHaveBeenCalledTimes(1);
    expect(h.escalation.cancel).toHaveBeenCalled();
    expect(h.deterrence.abort).toHaveBeenCalled();
    expect(h.media.stopAll).toHaveBeenCalled();
  });

  it('re-arming fra full alarm stopper sirener/strobe (ikke bare ved disarm)', async () => {
    await h.modes.setMode('armed');
    await h.stateMachine.setMode('alarm');
    h.escalation.cancel.mockClear();
    await h.modes.setMode('armed_perimeter');
    expect(h.escalation.cancel).toHaveBeenCalled();
    expect(h.triggers.alarm_stopped).toHaveBeenCalledTimes(1);
    expect(h.stateMachine.getMode()).toBe('armed_perimeter');
  });

  it('perimeter_alarm avsluttes med alarm_perimeter_stopped', async () => {
    await h.modes.setMode('armed_perimeter');
    await h.alarm.enterPerimeterAlarm('z1', 'd1', 'contact');
    expect(h.stateMachine.getMode()).toBe('perimeter_alarm');
    await h.modes.setMode('armed_perimeter');
    await flush();
    expect(h.triggers.alarm_perimeter_stopped).toHaveBeenCalledTimes(1);
  });

  it('mode_changed trigges ved hver endring', async () => {
    await h.modes.setMode('armed_perimeter');
    await flush();
    expect(h.triggers.mode_changed).toHaveBeenCalledWith(
      { mode_new: 'armed_perimeter', mode_previous: 'disarmed' },
      { mode_new: 'armed_perimeter' },
    );
  });
});
