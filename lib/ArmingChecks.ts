'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import type Notifier from './Notifier';
import type { GuardSettings } from './types';
import { t } from './i18n';

/** Pre-flight checks that run when the system is armed. */
export default class ArmingChecks {

  constructor(
    private readonly homey: Homey,
    private readonly homeyApi: any,
    private readonly log: EventLog,
    private readonly notifier: Notifier,
    private readonly getSettings: () => GuardSettings,
  ) { }

  /** Warns about sensors that are offline when leaving the disarmed state. */
  async runHealthCheck(): Promise<void> {
    try {
      const devices = await this.homeyApi.devices.getDevices();
      const sensors = Object.values(devices).filter((d: any) => Array.isArray(d.capabilities)
        && (d.capabilities.includes('alarm_motion') || d.capabilities.includes('alarm_contact')));
      const offline: string[] = [];
      for (const s of sensors as any[]) {
        if (s.available === false) offline.push(s.name || s.id);
      }
      if (offline.length > 0) {
        const msg = t(this.homey, 'app.health_check_offline', { count: offline.length, names: offline.join(', ') });
        this.log.add('warning', msg);
        this.notifier.timeline(`⚠️ ${msg}`);
        this.homey.flow.getTriggerCard('health_check_failed')
          .trigger({ offline_count: offline.length })
          .catch(() => { /* best-effort */ });
      }
    } catch (err) {
      this.log.add('warning', t(this.homey, 'app.health_check_failed', { error: (err as Error).message }));
    }
  }

  /**
   * Warns about open door/window contact sensors when arming in Away mode. Sensors the user has
   * opted out of the check (e.g. interior doors that are often open) are skipped.
   */
  async checkOpenContactSensors(): Promise<void> {
    try {
      const devices = await this.homeyApi.devices.getDevices();
      const open: string[] = [];
      const excluded = new Set(this.getSettings().arming_check_excluded ?? []);
      for (const device of Object.values(devices) as any[]) {
        if (!Array.isArray(device.capabilities)) continue;
        if (!device.capabilities.includes('alarm_contact')) continue;
        if (excluded.has(String(device.id))) continue;
        if (device.capabilitiesObj?.alarm_contact?.value === true) open.push(device.name || device.id);
      }
      if (open.length > 0) {
        const msg = t(this.homey, 'app.open_contacts_at_arming', { count: open.length, names: open.join(', ') });
        this.log.add('warning', msg);
        this.notifier.timeline(`⚠️ ${msg}`);
        try {
          await this.homey.flow.getTriggerCard('open_sensors_at_arming').trigger({
            count: open.length,
            names: open.join(', '),
            mode: 'armed',
          }, { mode: 'armed' });
        } catch { /* best-effort */ }
      }
    } catch (err) {
      this.log.add('warning', t(this.homey, 'app.check_open_sensors_failed', { error: (err as Error).message }));
    }
  }

}
