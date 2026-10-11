'use strict';

import {
  classify, isCamera, sensorType, SensorType,
} from './Capabilities';

export interface ZoneSensor { id: string; name: string; type: SensorType }
export interface ZoneLight { id: string; name: string }
export interface ZoneCamera { id: string; name: string }

/** What the devices placed in one Homey zone can do for this app. */
export interface ZoneCaps {
  hasAudio: boolean;
  hasVideo: boolean;
  hasLights: boolean;
  hasCameras: boolean;
  audioDevices: string[];
  videoDevices: string[];
  lightDevices: string[];
  lights: ZoneLight[];
  cameras: ZoneCamera[];
  sensors: ZoneSensor[];
}

function emptyCaps(): ZoneCaps {
  return {
    hasAudio: false,
    hasVideo: false,
    hasLights: false,
    hasCameras: false,
    audioDevices: [],
    videoDevices: [],
    lightDevices: [],
    lights: [],
    cameras: [],
    sensors: [],
  };
}

/** Groups the devices by zone and records which of them the app can use. */
export function buildZoneCaps(devices: Iterable<any>): Record<string, ZoneCaps> {
  const caps: Record<string, ZoneCaps> = {};
  for (const d of devices) {
    if (!d?.zone) continue;
    const c = caps[d.zone] ?? (caps[d.zone] = emptyCaps());
    const k = classify(d);
    const name = String(d.name ?? d.id ?? '');
    if (k.isAudio) { c.hasAudio = true; c.audioDevices.push(name); }
    if (k.isVideo) { c.hasVideo = true; c.videoDevices.push(name); }
    if (k.isLight) {
      c.hasLights = true;
      c.lightDevices.push(name);
      c.lights.push({ id: String(d.id), name });
    }
    if (isCamera(d)) { c.hasCameras = true; c.cameras.push({ id: String(d.id), name }); }
    const st = sensorType(d);
    if (st) c.sensors.push({ id: String(d.id), name, type: st });
  }
  return caps;
}

/**
 * A zone is only useful to the guard when it holds at least one sensor, light, camera or media
 * device. Pure containers such as "1st floor" or "Upstairs" are not rooms the system can act on.
 */
export function isUsefulZone(caps: ZoneCaps | undefined): boolean {
  if (!caps) return false;
  return caps.sensors.length > 0 || caps.hasLights || caps.hasCameras || caps.hasAudio || caps.hasVideo;
}
