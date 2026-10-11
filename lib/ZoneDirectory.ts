'use strict';

import type Homey from 'homey/lib/Homey';

const REFRESH_MS = 60_000;

/**
 * Case-insensitive, language-aware, natural ("Room 2" before "Room 10") comparison of zone names.
 * Use it everywhere zones are listed so the order is the same in the dashboard and in flow cards.
 */
export function compareZoneNames(a: string, b: string, language = 'en'): number {
  try {
    return String(a ?? '').localeCompare(String(b ?? ''), language, { sensitivity: 'base', numeric: true });
  } catch {
    return String(a ?? '').localeCompare(String(b ?? ''));
  }
}

/** Returns a copy of `items` sorted alphabetically by their zone name. */
export function sortByZoneName<T extends { name?: string }>(items: T[], language = 'en'): T[] {
  return [...items].sort((x, y) => compareZoneNames(x.name ?? '', y.name ?? '', language));
}

/** Cached zone names plus lookups used for log messages and flow-card autocomplete. */
export default class ZoneDirectory {

  private names = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly homey: Homey,
    private readonly homeyApi: any,
  ) { }

  /** Loads the zones once and keeps the cache fresh in the background. */
  async start(): Promise<void> {
    await this.refresh();
    this.timer = this.homey.setInterval(() => { this.refresh().catch(() => { /* best-effort */ }); }, REFRESH_MS);
  }

  stop(): void {
    if (this.timer) this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  /** Cached zone name, or undefined when unknown. */
  nameOf(zoneId: string): string | undefined {
    return this.names.get(zoneId);
  }

  /** Cached zone name, falling back to the id. */
  labelOf(zoneId: string): string {
    return this.names.get(zoneId) ?? zoneId;
  }

  async refresh(): Promise<void> {
    try {
      const zones = await this.homeyApi.zones.getZones();
      const next = new Map<string, string>();
      for (const [id, z] of Object.entries(zones as Record<string, { name?: string }>)) {
        if (z?.name) next.set(id, z.name);
      }
      this.names = next;
    } catch { /* best-effort */ }
  }

  /** Fresh zone and device names for a sensor event (falls back to ids when the API fails). */
  async resolveNames(zoneId: string, deviceId: string): Promise<{ zoneName: string; deviceName: string }> {
    let zoneName = this.labelOf(zoneId);
    let deviceName = deviceId;
    try {
      const zones = await this.homeyApi.zones.getZones();
      const name = (zones as any)[zoneId]?.name;
      if (name) {
        zoneName = name;
        this.names.set(zoneId, name);
      }
    } catch { /* best-effort */ }
    try {
      const device = await this.homeyApi.devices.getDevice({ id: deviceId });
      deviceName = (device as any)?.name ?? deviceId;
    } catch { /* best-effort */ }
    return { zoneName, deviceName };
  }

  /** Autocomplete results for flow-card zone arguments, in alphabetical order. */
  autocomplete(query: string): { id: string; name: string }[] {
    const q = (query ?? '').toLowerCase();
    const results: { id: string; name: string }[] = [];
    for (const [id, name] of this.names) {
      if (!q || name.toLowerCase().includes(q)) results.push({ id, name });
    }
    return sortByZoneName(results, this.homey.i18n.getLanguage());
  }

}
