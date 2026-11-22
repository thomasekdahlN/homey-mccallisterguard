'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { SNAPSHOT_DIR_ALARM, SNAPSHOT_DIR_MOTION } from './types';

/** Snapshot metadata returned by the snapshot list endpoints. */
export interface SnapshotMeta {
  filename: string;
  timestamp: number;
  size: number;
}

export type SnapshotType = 'alarm' | 'motion';

const SNAPSHOT_FILENAME_RE = /^[0-9]+-[0-9a-f]+\.jpg$/i;

export function isSnapshotType(value: unknown): value is SnapshotType {
  return value === 'alarm' || value === 'motion';
}

export function snapshotDir(type: SnapshotType): string {
  return type === 'alarm' ? SNAPSHOT_DIR_ALARM : SNAPSHOT_DIR_MOTION;
}

/** Builds a sorted (newest-first) list of snapshot metadata from a directory. */
export function listSnapshotDir(dir: string): SnapshotMeta[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => SNAPSHOT_FILENAME_RE.test(f))
      .map((filename) => {
        const timestamp = parseInt(filename.split('-')[0], 10);
        let size = 0;
        try { size = fs.statSync(path.join(dir, filename)).size; } catch { /* best-effort */ }
        return { filename, timestamp, size };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // newest first
  } catch {
    return [];
  }
}

/** True when `filename` is a plain snapshot basename (guards against path traversal). */
export function isValidSnapshotFilename(filename: unknown): filename is string {
  return typeof filename === 'string'
    && path.basename(filename) === filename
    && SNAPSHOT_FILENAME_RE.test(filename);
}

/** Reads one snapshot as base64. The caller must validate type and filename first. */
export function readSnapshotBase64(type: SnapshotType, filename: string): string {
  return fs.readFileSync(path.join(snapshotDir(type), filename)).toString('base64');
}
