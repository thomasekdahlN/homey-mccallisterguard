import { describe, expect, it, vi } from 'vitest';
import { buildZoneCaps, isUsefulZone } from '../lib/ZoneCapabilities';
import ZoneDirectory from '../lib/ZoneDirectory';
import { createMockHomey } from './helpers/mockHomey';

const light = (id: string, zone: string) => ({
  id, zone, name: `light-${id}`, class: 'light', capabilities: ['onoff', 'dim'],
});
const motion = (id: string, zone: string) => ({
  id, zone, name: `pir-${id}`, class: 'sensor', capabilities: ['alarm_motion'],
});
const door = (id: string, zone: string) => ({
  id, zone, name: `door-${id}`, class: 'sensor', capabilities: ['alarm_contact'],
});
const camera = (id: string, zone: string) => ({
  id, zone, name: `cam-${id}`, class: 'camera', capabilities: ['camera_image'],
});
const speaker = (id: string, zone: string) => ({
  id, zone, name: `spk-${id}`, class: 'speaker', capabilities: ['speaker_playing', 'volume_set'],
});

describe('buildZoneCaps / isUsefulZone', () => {
  it('klassifiserer sensorer, lys, kameraer og lyd pr. rom', () => {
    const caps = buildZoneCaps([light('1', 'a'), motion('2', 'a'), door('3', 'b'), camera('4', 'c'), speaker('5', 'd')]);
    expect(caps.a.hasLights).toBe(true);
    expect(caps.a.sensors.map((s) => s.type)).toEqual(['motion']);
    expect(caps.b.sensors.map((s) => s.type)).toEqual(['contact']);
    expect(caps.c.hasCameras).toBe(true);
    expect(caps.d.hasAudio).toBe(true);
  });

  it('et rom er nyttig bare hvis det har sensor, lys, kamera eller media', () => {
    const caps = buildZoneCaps([light('1', 'a'), motion('2', 'b'), camera('3', 'c'), speaker('4', 'd'),
      { id: '9', zone: 'e', class: 'socket', capabilities: ['onoff'], name: 'plug' }]);
    expect(isUsefulZone(caps.a)).toBe(true);
    expect(isUsefulZone(caps.b)).toBe(true);
    expect(isUsefulZone(caps.c)).toBe(true);
    expect(isUsefulZone(caps.d)).toBe(true);
    expect(isUsefulZone(caps.e)).toBe(false); // bare en stikkontakt
    expect(isUsefulZone(caps.finnesIkke)).toBe(false); // sone uten enheter, f.eks. «1. etasje»
  });

  it('ignorerer enheter uten sone', () => {
    expect(buildZoneCaps([{ id: '1', capabilities: ['alarm_motion'] }])).toEqual({});
  });
});

describe('ZoneDirectory.autocomplete skjuler soner uten nytte', () => {
  async function setup(devices: unknown[]) {
    const homey = createMockHomey();
    const homeyApi = {
      zones: {
        getZones: vi.fn(async () => ({
          floor1: { name: '1. etasje' }, floor2: { name: '2. etasje' }, living: { name: 'Stue' }, bath: { name: 'Bad' },
        })),
      },
      devices: { getDevices: vi.fn(async () => Object.fromEntries((devices as { id: string }[]).map((d) => [d.id, d]))) },
    };
    const zones = new ZoneDirectory(homey as never, homeyApi);
    await zones.refresh();
    return zones;
  }

  it('lister bare rom med sensor, lys, kamera eller media – alfabetisk', async () => {
    const zones = await setup([light('1', 'living'), motion('2', 'bath')]);
    expect(zones.autocomplete('').map((z) => z.name)).toEqual(['Bad', 'Stue']);
  });

  it('faller tilbake til alle soner hvis enhetslisten ikke kan hentes', async () => {
    const homey = createMockHomey();
    const homeyApi = {
      zones: { getZones: vi.fn(async () => ({ a: { name: 'B' }, b: { name: 'A' } })) },
      devices: { getDevices: vi.fn(async () => { throw new Error('nope'); }) },
    };
    const zones = new ZoneDirectory(homey as never, homeyApi);
    await zones.refresh();
    expect(zones.autocomplete('').map((z) => z.name)).toEqual(['A', 'B']);
  });
});
