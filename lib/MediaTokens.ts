'use strict';

import type Homey from 'homey/lib/Homey';

export const APP_ID = 'com.ekdahl.mccallister-guard';

const MEDIA_FILES = [
  { id: 'media_alarm_beep', file: 'alarm-beep.ogg', title: 'Media: Alarm beep' },
  { id: 'media_fire_alarm', file: 'fire-alarm.ogg', title: 'Media: Fire alarm' },
  { id: 'media_guard_dog', file: 'guard-dog.ogg', title: 'Media: Guard dog (audio)' },
  { id: 'media_intruder_voice', file: 'intruder-voice.m4a', title: 'Media: Intruder warning (voice)' },
  { id: 'media_police_siren', file: 'police-siren.ogg', title: 'Media: Police siren' },
  { id: 'media_blue_lights', file: 'blue-lights.mp4', title: 'Media: Blue lights (video)' },
  { id: 'media_cop_silhouette', file: 'cop-silhouette.mp4', title: 'Media: Cop silhouette (video)' },
  { id: 'media_large_dog', file: 'large-dog.mp4', title: 'Media: Large dog (video)' },
] as const;

/** URL of a bundled media file on this Homey's local network address. */
export async function mediaUrl(homey: Homey, file: string): Promise<string> {
  const rawBase: string = await (homey as any).api.getLocalUrl();
  return `${rawBase.replace(/\/$/, '')}/app/${APP_ID}/assets/media/${file}`;
}

/** Registers the bundled media files as global string flow tokens. */
export async function registerMediaTokens(homey: Homey): Promise<void> {
  for (const entry of MEDIA_FILES) {
    const url = await mediaUrl(homey, entry.file);
    const token = await homey.flow.createToken(entry.id, { type: 'string', title: entry.title, value: url });
    await token.setValue(url);
  }
}
