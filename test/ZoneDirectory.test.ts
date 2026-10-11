import { describe, expect, it, vi } from 'vitest';
import ZoneDirectory, { compareZoneNames, sortByZoneName } from '../lib/ZoneDirectory';
import { createMockHomey } from './helpers/mockHomey';

describe('zone sorting', () => {
  it('sorterer alfabetisk uavhengig av store/små bokstaver', () => {
    const names = ['stue', 'Bad', 'Kjøkken', 'arbeidsrom'];
    expect([...names].sort((a, b) => compareZoneNames(a, b))).toEqual(['arbeidsrom', 'Bad', 'Kjøkken', 'stue']);
  });

  it('sorterer naturlig: tall som tall, ikke som tekst', () => {
    const names = ['Soverom 10', 'Soverom 2', 'Soverom 1'];
    expect([...names].sort((a, b) => compareZoneNames(a, b))).toEqual(['Soverom 1', 'Soverom 2', 'Soverom 10']);
  });

  it('plasserer æ, ø, å sist med norsk språk', () => {
    const names = ['Å-rom', 'Øvre', 'Stue', 'Ærfugl', 'Bad'];
    expect(sortByZoneName(names.map((name) => ({ name })), 'no').map((z) => z.name))
      .toEqual(['Bad', 'Stue', 'Ærfugl', 'Øvre', 'Å-rom']);
  });

  it('endrer ikke den opprinnelige listen og tåler manglende navn', () => {
    const input = [{ name: 'B' }, {}, { name: 'A' }];
    const sorted = sortByZoneName(input);
    expect(input[0].name).toBe('B');
    expect(sorted.map((z) => z.name)).toEqual([undefined, 'A', 'B']);
  });
});

describe('ZoneDirectory.autocomplete', () => {
  async function setup(language = 'en') {
    const homey = createMockHomey({}, language);
    const homeyApi = {
      zones: {
        getZones: vi.fn(async () => ({
          1: { name: 'Stue' }, 2: { name: 'bad' }, 3: { name: 'Kjøkken' }, 4: { name: 'Gang' },
        })),
      },
    };
    const zones = new ZoneDirectory(homey as never, homeyApi);
    await zones.refresh();
    return zones;
  }

  it('returnerer rom i alfabetisk rekkefølge', async () => {
    const zones = await setup();
    expect(zones.autocomplete('').map((z) => z.name)).toEqual(['bad', 'Gang', 'Kjøkken', 'Stue']);
  });

  it('filtrerer og beholder alfabetisk rekkefølge', async () => {
    const zones = await setup();
    expect(zones.autocomplete('g').map((z) => z.name)).toEqual(['Gang']);
    expect(zones.autocomplete('K').map((z) => z.name)).toEqual(['Kjøkken']);
  });
});
