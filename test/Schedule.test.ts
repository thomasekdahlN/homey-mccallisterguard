import { describe, expect, it } from 'vitest';
import {
  isInWindow, isInWindowHHMM, localMinutes, normalizeHHMM, parseHHMM,
} from '../lib/Schedule';

describe('Schedule', () => {
  it('parser gyldige og ugyldige klokkeslett', () => {
    expect(parseHHMM('22:00')).toBe(1320);
    expect(parseHHMM('6:05')).toBe(365);
    expect(parseHHMM('24:00')).toBeNull();
    expect(parseHHMM('22:00:00')).toBeNull();
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });

  it('normaliserer til HH:MM eller bruker fallback', () => {
    expect(normalizeHHMM('6:05', '00:00')).toBe('06:05');
    expect(normalizeHHMM('xx', '22:00')).toBe('22:00');
  });

  it('håndterer vindu som krysser midnatt', () => {
    expect(isInWindowHHMM('23:00', '22:00', '06:00')).toBe(true);
    expect(isInWindowHHMM('05:59', '22:00', '06:00')).toBe(true);
    expect(isInWindowHHMM('06:00', '22:00', '06:00')).toBe(false);
    expect(isInWindowHHMM('12:00', '22:00', '06:00')).toBe(false);
  });

  it('håndterer vindu innenfor samme døgn', () => {
    expect(isInWindowHHMM('09:00', '08:00', '17:00')).toBe(true);
    expect(isInWindowHHMM('17:00', '08:00', '17:00')).toBe(false);
  });

  it('likt start og slutt gir tomt vindu', () => {
    expect(isInWindow(600, 600, 600)).toBe(false);
  });

  it('beregner lokal tid i angitt tidssone (ikke UTC)', () => {
    const summer = new Date('2026-07-01T20:30:00Z'); // CEST = UTC+2
    expect(localMinutes(summer, 'Europe/Oslo')).toBe(22 * 60 + 30);
    const winter = new Date('2026-01-01T20:30:00Z'); // CET = UTC+1
    expect(localMinutes(winter, 'Europe/Oslo')).toBe(21 * 60 + 30);
  });
});
