import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import CameraManager from '../lib/CameraManager';
import { DEFAULT_SETTINGS } from '../lib/types';
import { createMockHomey } from './helpers/mockHomey';

function setup(imageUrl: string) {
  const homey = {
    ...createMockHomey(),
    api: {
      getLocalUrl: vi.fn(async () => 'http://192.168.1.10/'),
      getOwnerApiToken: vi.fn(async () => 'SECRET-TOKEN'),
    },
  };
  const log = { add: vi.fn() };
  const api = { images: { getImages: vi.fn(async () => ({})) }, devices: { getDevices: vi.fn(async () => ({})) } };
  const cm = new CameraManager(homey as never, api, log as never, () => ({ ...DEFAULT_SETTINGS }));
  (cm as unknown as { zoneCameraCache: Map<string, unknown> }).zoneCameraCache = new Map([
    ['z1', [{ id: 'c1', name: 'Cam', imageUrl }]],
  ]);
  return { cm, log };
}

describe('CameraManager token-sikkerhet', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sender ALDRI Homey-token til en ekstern/manuell kamera-URL', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { cm } = setup('http://192.168.1.99/snapshot.jpg');
    await cm.captureMotionBurst('z1', false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sender token til Homey selv (relativ URL)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { cm } = setup('/api/image/abc');
    await cm.captureMotionBurst('z1', false);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://192.168.1.10/api/image/abc');
    expect(init.headers.Authorization).toBe('Bearer SECRET-TOKEN');
  });

  it('starter ikke overlappende bursts for samme sone', async () => {
    let release: () => void = () => { /* set below */ };
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn(async () => { await gate; return { ok: false, status: 500 }; });
    vi.stubGlobal('fetch', fetchMock);
    const { cm } = setup('http://192.168.1.99/snapshot.jpg');
    const first = cm.captureMotionBurst('z1', false);
    await new Promise((r) => { setTimeout(r, 10); });
    await cm.captureMotionBurst('z1', false); // hoppes over
    release();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
