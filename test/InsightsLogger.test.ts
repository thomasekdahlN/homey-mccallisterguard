import { describe, expect, it, vi } from 'vitest';
import InsightsLogger from '../lib/InsightsLogger';
import { createMockHomey } from './helpers/mockHomey';

function setup({ existing = true, createFails = false } = {}) {
  const entries: Record<string, Array<number | boolean>> = {};
  const makeLog = (id: string) => ({ createEntry: vi.fn(async (v: number | boolean) => { (entries[id] ||= []).push(v); }) });
  const insights = {
    getLog: vi.fn(async (id: string) => { if (!existing) throw new Error('not found'); return makeLog(id); }),
    createLog: vi.fn(async (id: string) => { if (createFails) throw new Error('nope'); return makeLog(id); }),
  };
  const homey = { ...createMockHomey(), insights };
  const eventLog = { add: vi.fn() };
  const logger = new InsightsLogger(homey as never, eventLog as never);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    logger, insights, entries, eventLog, flush,
  };
}

describe('InsightsLogger', () => {
  it('oppretter logger som mangler, med oversatt tittel', async () => {
    const { logger, insights, flush } = setup({ existing: false });
    logger.start('disarmed');
    await flush();
    expect(insights.createLog).toHaveBeenCalledTimes(4);
    expect(insights.createLog).toHaveBeenCalledWith('guardactive', expect.objectContaining({ title: 'Guard active', type: 'boolean' }));
    expect(insights.createLog).toHaveBeenCalledWith('disarmtime', expect.objectContaining({ type: 'number', units: 's' }));
  });

  it('gjenbruker eksisterende logger', async () => {
    const { logger, insights, flush } = setup({ existing: true });
    logger.start('disarmed');
    await flush();
    expect(insights.createLog).not.toHaveBeenCalled();
  });

  it('skriver startmodus og bare endringer i vakt/alarm', async () => {
    const { logger, entries, flush } = setup();
    logger.start('disarmed');
    logger.recordMode('disarmed');
    logger.recordMode('armed');
    logger.recordMode('armed_perimeter');
    logger.recordMode('deterrence');
    logger.recordMode('alarm');
    logger.recordMode('disarmed');
    await flush();
    expect(entries.guardactive).toEqual([false, true, false]);
    expect(entries.alertactive).toEqual([false, true, false]);
  });

  it('regner alarm som aktiv vakt, og av/hjemme som inaktiv', async () => {
    const { logger, entries, flush } = setup();
    logger.start('off');
    logger.recordMode('perimeter_alarm');
    await flush();
    expect(entries.guardactive).toEqual([false, true]);
    expect(entries.alertactive).toEqual([false, true]);
  });

  it('runder av tid til avvæpning og ignorerer ugyldige verdier', async () => {
    const { logger, entries, flush } = setup();
    logger.start('armed');
    logger.recordDisarmTime(12.345);
    logger.recordDisarmTime(-1);
    logger.recordDisarmTime(Number.NaN);
    await flush();
    expect(entries.disarmtime).toEqual([12.3]);
  });

  it('logger antall frakoblede sensorer, også 0', async () => {
    const { logger, entries, flush } = setup();
    logger.start('armed');
    logger.recordOfflineSensors(2);
    logger.recordOfflineSensors(0);
    await flush();
    expect(entries.offlinesensors).toEqual([2, 0]);
  });

  it('feiler aldri når Insights ikke lar oss opprette logg', async () => {
    const { logger, eventLog, entries, flush } = setup({ existing: false, createFails: true });
    expect(() => {
      logger.start('armed');
      logger.recordMode('alarm');
      logger.recordDisarmTime(5);
    }).not.toThrow();
    await flush();
    expect(entries).toEqual({});
    expect(eventLog.add).toHaveBeenCalledWith('warning', expect.stringContaining('guardactive'));
  });
});
