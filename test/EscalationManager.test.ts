import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import EscalationManager from '../lib/EscalationManager';
import { createMockHomey } from './helpers/mockHomey';

function device(id: string, cls: string, caps: string[], values: Record<string, unknown> = {}) {
  const capabilitiesObj: Record<string, { value: unknown }> = {};
  for (const [k, v] of Object.entries(values)) capabilitiesObj[k] = { value: v };
  return {
    id, class: cls, capabilities: caps, capabilitiesObj, setCapabilityValue: vi.fn(async () => { /* noop */ }),
  };
}

describe('EscalationManager', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(devs: ReturnType<typeof device>[]) {
    const homey = createMockHomey();
    const api = { devices: { getDevices: vi.fn(async () => Object.fromEntries(devs.map((d) => [d.id, d]))) } };
    const log = { add: vi.fn() };
    return { mgr: new EscalationManager(homey as never, api, log as never), api };
  }

  it('strober kun lys — aldri støpsler eller andre onoff-enheter', async () => {
    const light = device('l', 'light', ['onoff', 'dim'], { onoff: false });
    const plug = device('p', 'socket', ['onoff'], { onoff: true });
    const { mgr } = setup([light, plug]);
    await mgr.triggerCrisis();
    await vi.advanceTimersByTimeAsync(1000);
    expect(light.setCapabilityValue).toHaveBeenCalled();
    expect(plug.setCapabilityValue).not.toHaveBeenCalled();
    await mgr.cancel();
  });

  it('gjenoppretter lysenes tidligere tilstand ved avslutning', async () => {
    const wasOn = device('a', 'light', ['onoff'], { onoff: true });
    const wasOff = device('b', 'light', ['onoff'], { onoff: false });
    const { mgr } = setup([wasOn, wasOff]);
    await mgr.triggerCrisis();
    await vi.advanceTimersByTimeAsync(500);
    await mgr.cancel();
    const last = (d: typeof wasOn) => (d.setCapabilityValue.mock.calls.at(-1) as unknown as [{ value: boolean }])[0].value;
    expect(last(wasOn)).toBe(true);
    expect(last(wasOff)).toBe(false);
    expect(mgr.isInCrisis()).toBe(false);
  });

  it('gjenoppretter høyttalervolum', async () => {
    const speaker = device('s', 'speaker', ['volume_set', 'speaker_playing'], { volume_set: 0.3, speaker_playing: false });
    const { mgr } = setup([speaker]);
    await mgr.triggerCrisis();
    await mgr.cancel();
    const volumeCalls = (speaker.setCapabilityValue.mock.calls as unknown as [{ capabilityId: string; value: number }][])
      .map(([c]) => c).filter((c) => c.capabilityId === 'volume_set');
    expect(volumeCalls[0].value).toBe(1);
    expect(volumeCalls.at(-1)?.value).toBe(0.3);
  });

  it('lar seg trigge på nytt hvis enhetslisten feiler (ingen låst krise-tilstand)', async () => {
    const { mgr, api } = setup([]);
    api.devices.getDevices.mockRejectedValueOnce(new Error('boom'));
    await expect(mgr.triggerCrisis()).rejects.toThrow('boom');
    expect(mgr.isInCrisis()).toBe(false);
    await expect(mgr.triggerCrisis()).resolves.toBeUndefined();
    await mgr.cancel();
  });

  it('lar ikke strobe-tick overlappe selv om enhetskall er trege', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = device('l', 'light', ['onoff'], { onoff: false });
    slow.setCapabilityValue = vi.fn(async () => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => { setTimeout(r, 1500); });
      inFlight -= 1;
    });
    const { mgr } = setup([slow]);
    await mgr.triggerCrisis();
    await vi.advanceTimersByTimeAsync(6000);
    expect(maxInFlight).toBe(1);
    const cancelled = mgr.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    await cancelled;
  });
});
