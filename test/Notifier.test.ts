import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import Notifier from '../lib/Notifier';
import { DEFAULT_SETTINGS, GuardSettings } from '../lib/types';
import { createMockHomey } from './helpers/mockHomey';

function setup(overrides: Partial<GuardSettings> = {}) {
  const trigger = vi.fn(async () => undefined);
  const createNotification = vi.fn(async (_: { excerpt: string }) => undefined);
  const homey = {
    ...createMockHomey(),
    notifications: { createNotification },
    flow: { getTriggerCard: vi.fn(() => ({ trigger })) },
  };
  const eventLog = { add: vi.fn() };
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  const notifier = new Notifier(homey as never, eventLog as never, () => settings);
  return {
    notifier, createNotification, trigger, eventLog, settings,
  };
}

describe('Notifier', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('legger riktig emoji foran og aldri to', () => {
    expect(Notifier.format('🚨 **ALARM** utløst', 'critical')).toBe('🚨 **ALARM** utløst');
    expect(Notifier.format('Alarm i stua', 'critical')).toBe('🚨 Alarm i stua');
    expect(Notifier.format('⚠️ Sensor offline', 'warning')).toBe('⚠️ Sensor offline');
    expect(Notifier.format('Sensor offline', 'warning')).toBe('⚠️ Sensor offline');
    expect(Notifier.format('Hjemme: Kari', 'info')).toBe('Hjemme: Kari');
  });

  it('sender info som før', () => {
    const { notifier, createNotification, trigger } = setup();
    notifier.timeline('Alarm on');
    expect(createNotification).toHaveBeenCalledWith({ excerpt: 'Alarm on' });
    expect(trigger).not.toHaveBeenCalled();
  });

  it('skjuler info, men aldri advarsler og kritiske, når bare kritiske er valgt', () => {
    const { notifier, createNotification } = setup({ timeline_critical_only: true });
    notifier.timeline('Alarm on', 'info');
    notifier.timeline('Åpen dør', 'warning');
    notifier.timeline('Alarm!', 'critical');
    expect(createNotification.mock.calls.map((c) => c[0].excerpt)).toEqual(['⚠️ Åpen dør', '🚨 Alarm!']);
  });

  it('kritiske meldinger utløser flow-triggeren med tokens uten markdown', () => {
    const { notifier, trigger } = setup({ timeline_critical_only: true });
    notifier.timeline('🚨 **ALARM** i **Stua**', 'critical', { kind: 'alarm', zone: 'Stua', sensor: 'Bevegelse' });
    expect(trigger).toHaveBeenCalledWith(expect.objectContaining({
      message: '🚨 ALARM i Stua', kind: 'alarm', zone: 'Stua', sensor: 'Bevegelse',
    }));
  });

  it('flow-triggeren utløses ikke for info og advarsler', () => {
    const { notifier, trigger } = setup();
    notifier.timeline('a', 'info');
    notifier.timeline('b', 'warning');
    expect(trigger).not.toHaveBeenCalled();
  });

  it('prøver kritiske meldinger på nytt og lykkes uten feillogg', async () => {
    const { notifier, createNotification, eventLog } = setup();
    createNotification.mockRejectedValueOnce(new Error('offline'));
    notifier.timeline('Alarm', 'critical');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(eventLog.add).not.toHaveBeenCalled();
  });

  it('logger en advarsel når alle forsøk med en kritisk melding feiler', async () => {
    const { notifier, createNotification, eventLog } = setup();
    createNotification.mockRejectedValue(new Error('offline'));
    notifier.timeline('Alarm', 'critical');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(createNotification).toHaveBeenCalledTimes(3);
    expect(eventLog.add).toHaveBeenCalledWith('warning', expect.stringContaining('offline'));
  });

  it('prøver ikke på nytt for info og advarsler', async () => {
    const { notifier, createNotification, eventLog } = setup();
    createNotification.mockRejectedValue(new Error('offline'));
    notifier.timeline('Alarm on');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(eventLog.add).not.toHaveBeenCalled();
  });
});
