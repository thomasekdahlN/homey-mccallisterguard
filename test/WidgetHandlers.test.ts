import {
  describe, expect, it, vi,
} from 'vitest';
import {
  bypassPerimeter, getEvents, getLabels, getSnapshotImage, setMode,
} from '../lib/WidgetHandlers';
import type { WidgetHomey } from '../lib/WidgetHandlers';

function makeHomey(events: Array<{ ts: number; level: string; message: string }> = []) {
  const setModeFn = vi.fn().mockResolvedValue(undefined);
  const bypass = vi.fn();
  const homey = {
    i18n: { getLanguage: () => 'en' },
    app: {
      services: {
        modes: { setMode: setModeFn },
        perimeter: { bypass, getBypassEndsAt: () => 123 },
        eventLog: { recent: () => events },
      },
    },
  } as unknown as WidgetHomey;
  return { homey, setModeFn, bypass };
}

describe('WidgetHandlers', () => {
  it('lar widgets bare velge hjemme, borte og skallsikring', async () => {
    const { homey, setModeFn } = makeHomey();
    expect(await setMode(homey, 'armed')).toEqual({ success: true });
    expect(setModeFn).toHaveBeenCalledWith('armed', { force: true });

    for (const bad of ['off', 'alarm', 'deterrence', 'nonsense', undefined]) {
      const res = await setMode(homey, bad);
      expect(res.success).toBe(false);
    }
    expect(setModeFn).toHaveBeenCalledTimes(1);
  });

  it('rapporterer feil fra modusbytte i stedet for å kaste', async () => {
    const { homey, setModeFn } = makeHomey();
    setModeFn.mockRejectedValueOnce(new Error('boom'));
    expect(await setMode(homey, 'disarmed')).toEqual({ success: false, error: 'boom' });
  });

  it('filtrerer hendelser på nivå før antall begrenses', () => {
    const events = [
      { ts: 5, level: 'info', message: 'a' },
      { ts: 4, level: 'alarm', message: 'b' },
      { ts: 3, level: 'info', message: 'c' },
      { ts: 2, level: 'warning', message: 'd' },
      { ts: 1, level: 'critical', message: 'e' },
    ];
    const { homey } = makeHomey(events);
    expect(getEvents(homey, '2', 'warning').map((e) => e.message)).toEqual(['b', 'd']);
    expect(getEvents(homey, undefined, 'alarm').map((e) => e.message)).toEqual(['b', 'e']);
    expect(getEvents(homey, '1', 'bogus')).toHaveLength(1);
  });

  it('sender varighet videre til perimeter bypass', () => {
    const { homey, bypass } = makeHomey();
    expect(bypassPerimeter(homey, 300)).toEqual({ success: true, endsAt: 123 });
    expect(bypass).toHaveBeenCalledWith(300);
    bypassPerimeter(homey, 'abc');
    expect(bypass).toHaveBeenLastCalledWith(60);
  });

  it('avviser ugyldig snapshot-type og filnavn (path traversal)', () => {
    const { homey } = makeHomey();
    expect(() => getSnapshotImage(homey, 'other', '1-ab.jpg')).toThrow();
    expect(() => getSnapshotImage(homey, 'alarm', '../etc/passwd')).toThrow();
    expect(() => getSnapshotImage(homey, 'alarm', '1-ab.jpg/../../x.jpg')).toThrow();
  });

  it('leverer widget-tekster uten prefiks på valgt språk', () => {
    const { homey } = makeHomey();
    const { labels } = getLabels(homey);
    expect(labels.mode_armed).toBe('Away');
    expect(labels.stop_alarm).toBe('Stop alarm');
    expect(Object.keys(labels).every((k) => !k.startsWith('widget.'))).toBe(true);
  });
});
