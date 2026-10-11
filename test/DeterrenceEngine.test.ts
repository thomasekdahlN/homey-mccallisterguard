import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import DeterrenceEngine from '../lib/DeterrenceEngine';
import { DEFAULT_SETTINGS, GuardSettings } from '../lib/types';
import { createMockHomey } from './helpers/mockHomey';

function setup(overrides: Partial<GuardSettings> = {}) {
  const homey = createMockHomey();
  const log = { add: vi.fn() };
  const media = {
    startBlink: vi.fn(async () => { /* noop */ }),
    stopZone: vi.fn(async () => { /* noop */ }),
    stopAll: vi.fn(async () => { /* noop */ }),
  };
  const settings: GuardSettings = {
    ...DEFAULT_SETTINGS, zone_matrix: { A: 'B', B: 'C' }, deterrence_delay: 10, ...overrides,
  };
  const engine = new DeterrenceEngine(homey as never, log as never, media as never, () => settings);
  return { engine, media };
}

describe('DeterrenceEngine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starter blink i reaksjonssonen for bevegelsessonen', async () => {
    const { engine, media } = setup();
    await engine.handleMotion('A');
    expect(media.startBlink).toHaveBeenCalledWith('B');
    expect(engine.getActiveZone()).toBe('B');
  });

  it('stopper forrige reaksjonssone når inntrengeren flytter seg', async () => {
    const { engine, media } = setup();
    await engine.handleMotion('A'); // reaksjon B
    await engine.handleMotion('B'); // mørklegger B, planlegger oppfølging
    await engine.handleMotion('A'); // reaksjon B igjen
    expect(media.stopZone).toHaveBeenCalledWith('B');
  });

  it('abort() fjerner ventende cooldown slik at ingenting starter etterpå', async () => {
    const { engine, media } = setup();
    await engine.handleMotion('A');
    await engine.handleMotion('B'); // cooldown-timer settes
    media.startBlink.mockClear();
    await engine.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(media.startBlink).not.toHaveBeenCalled();
    expect(engine.getActiveZone()).toBeNull();
    expect(media.stopAll).toHaveBeenCalled();
  });

  it('en ny bevegelse erstatter foreldreløs cooldown-timer (ingen dobbel start)', async () => {
    const { engine, media } = setup();
    await engine.handleMotion('A');
    await engine.handleMotion('B'); // cooldown #1
    await engine.handleMotion('A'); // erstatter cooldown
    await engine.handleMotion('B'); // cooldown #2
    media.startBlink.mockClear();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(media.startBlink).toHaveBeenCalledTimes(1);
  });
});
