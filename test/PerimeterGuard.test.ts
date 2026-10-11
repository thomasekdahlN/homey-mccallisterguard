import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createHarness, Harness } from './helpers/guardHarness';

describe('PerimeterGuard.bypass', () => {
  let h: Harness;
  beforeEach(() => { vi.useFakeTimers(); h = createHarness(); });
  afterEach(() => { vi.useRealTimers(); });

  it('utløper etter angitt tid', async () => {
    h.perimeter.bypass(60);
    expect(h.perimeter.isBypassed()).toBe(true);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.perimeter.isBypassed()).toBe(false);
    expect(h.perimeter.getBypassEndsAt()).toBeNull();
  });

  it('extendOnly forkorter aldri en lengre manuell bypass', () => {
    h.perimeter.bypass(600);
    const before = h.perimeter.getBypassEndsAt() as number;
    h.perimeter.bypass(30, { extendOnly: true });
    expect(h.perimeter.getBypassEndsAt()).toBe(before);
  });

  it('extendOnly forlenger en kortere bypass', () => {
    h.perimeter.bypass(30);
    const before = h.perimeter.getBypassEndsAt() as number;
    h.perimeter.bypass(120, { extendOnly: true });
    expect(h.perimeter.getBypassEndsAt() as number).toBeGreaterThan(before);
  });

  it('en eksplisitt bypass kan erstatte (også forkorte) en eksisterende', () => {
    h.perimeter.bypass(600);
    h.perimeter.bypass(30);
    expect((h.perimeter.getBypassEndsAt() as number) - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it('normaliserer ugyldige og ekstreme varigheter', () => {
    h.perimeter.bypass(Number.NaN);
    expect((h.perimeter.getBypassEndsAt() as number) - Date.now()).toBe(60_000);
    h.perimeter.bypass(10 ** 12);
    expect((h.perimeter.getBypassEndsAt() as number) - Date.now()).toBe(24 * 3600 * 1000);
    h.perimeter.bypass(-5);
    expect((h.perimeter.getBypassEndsAt() as number) - Date.now()).toBe(5_000);
  });
});
