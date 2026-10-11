'use strict';

import type Homey from 'homey/lib/Homey';
import type CameraManager from './CameraManager';
import type EventLog from './EventLog';
import type StateMachine from './StateMachine';
import type ZoneDirectory from './ZoneDirectory';
import { t } from './i18n';

/** Snapshot images are unregistered after 60 s — never attach one older than this to a trigger. */
const SNAPSHOT_FRESH_MS = 55_000;

/**
 * Connects camera snapshots to the rest of the app: remembers the latest image (so alarm triggers can
 * carry it, while it is still valid) and fires the `snapshot_taken` flow trigger.
 */
export default class SnapshotRelay {

  private latestImage: any = null;
  private latestAt = 0;

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
    private readonly stateMachine: StateMachine,
    private readonly zones: ZoneDirectory,
  ) { }

  attach(cameras: CameraManager): void {
    cameras.onSnapshot((zoneId, _cameraId, cameraName, image) => {
      this.latestImage = image;
      this.latestAt = Date.now();
      const zoneName = this.zones.labelOf(zoneId);
      const tokens = {
        zone: zoneName,
        sensor: cameraName,
        sensor_type: 'camera',
        mode: this.stateMachine.getMode(),
        timestamp: new Date().toISOString(),
        snapshot: image,
      };
      this.homey.flow.getTriggerCard('snapshot_taken').trigger(tokens, { zoneId })
        .then(() => {
          this.log.add('info', t(this.homey, 'app.snapshot_trigger_fired', { camera: cameraName, zone: zoneName }), zoneId);
        })
        .catch((err) => {
          this.log.add('warning', t(this.homey, 'app.snapshot_trigger_failed', { error: (err as Error).message }), zoneId);
        });
    });
  }

  /** Latest snapshot, or null when Homey has already unregistered the image. */
  getFresh(): any {
    if (this.latestImage === null) return null;
    if (Date.now() - this.latestAt > SNAPSHOT_FRESH_MS) {
      this.latestImage = null;
      return null;
    }
    return this.latestImage;
  }

}
