'use strict';

import type Homey from 'homey/lib/Homey';
import type EventLog from './EventLog';
import { t } from './i18n';

/** Small helpers for running async work safely inside timers and during startup. */
export default class Tasks {

  constructor(
    private readonly homey: Homey,
    private readonly log: EventLog,
  ) { }

  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => { this.homey.setTimeout(resolve, ms); });
  }

  /** Wraps an async timer callback so a rejection is logged instead of crashing the app. */
  safe(fn: () => Promise<void>): () => void {
    return () => {
      fn().catch((err) => {
        try { this.log.add('warning', t(this.homey, 'app.task_failed', { error: (err as Error).message })); } catch { /* best-effort */ }
      });
    };
  }

  /** Runs an async step, retrying with exponential backoff (2 s, 4 s, 8 s … capped at 30 s). */
  async retry<T>(step: string, fn: () => Promise<T>, attempts: number): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= attempts) throw err;
        const seconds = Math.min(2 ** attempt, 30);
        this.log.add('warning', t(this.homey, 'app.startup_retry', { step, error: (err as Error).message, seconds }));
        await this.sleep(seconds * 1000);
      }
    }
  }

}
