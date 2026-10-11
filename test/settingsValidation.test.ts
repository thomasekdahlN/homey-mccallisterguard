import { describe, expect, it } from 'vitest';
import { isSafeSnapshotUrl, redactUrl, sanitizeSettingsPatch } from '../lib/settingsValidation';

describe('sanitizeSettingsPatch', () => {
  it('fjerner ukjente nøkler og ikke-objekter', () => {
    expect(sanitizeSettingsPatch({ evil: 1, entry_delay: 30 })).toEqual({ entry_delay: 30 });
    expect(sanitizeSettingsPatch(null)).toEqual({});
    expect(sanitizeSettingsPatch('x')).toEqual({});
  });

  it('forkaster NaN, null og tomme tall i stedet for å overskrive med 0', () => {
    const out = sanitizeSettingsPatch({ entry_delay: null, exit_delay: Number.NaN, escalation_minutes: '' });
    expect(out).toEqual({});
  });

  it('klamper tall til grenser', () => {
    const out = sanitizeSettingsPatch({ entry_delay: -5, snapshot_max_count: 0, camera_alarm_burst: 9999 });
    expect(out.entry_delay).toBe(0);
    expect(out.snapshot_max_count).toBe(1);
    expect(out.camera_alarm_burst).toBe(50);
  });

  it('godtar tall sendt som tekst', () => {
    expect(sanitizeSettingsPatch({ entry_delay: '45' }).entry_delay).toBe(45);
  });

  it('validerer klokkeslett', () => {
    const out = sanitizeSettingsPatch({ bedtime: '23:30', armed_perimeter_on: '22:00:00', armed_perimeter_off: '6:00' });
    expect(out.bedtime).toBe('23:30');
    expect(out.armed_perimeter_on).toBeUndefined();
    expect(out.armed_perimeter_off).toBe('06:00');
  });

  it('sikrer at random_max ikke er mindre enn random_min', () => {
    const out = sanitizeSettingsPatch({ random_min: 30, random_max: 10 });
    expect(out.random_max).toBe(30);
  });

  it('beholder bare strenger i sensorlister, inkl. arming_check_excluded', () => {
    const out = sanitizeSettingsPatch({ arming_check_excluded: ['a', 5, 'b'], perimeter_sensors: 'nope' });
    expect(out.arming_check_excluded).toEqual(['a', 'b']);
    expect(out.perimeter_sensors).toBeUndefined();
  });

  it('filtrerer kamera-URL-er og blokkerer prototype-nøkler', () => {
    const body = JSON.parse('{"camera_snapshot_urls":{"ok":"http://192.168.1.5/s.jpg","bad":"javascript:alert(1)","cred":"http://u:p@h/x","__proto__":"x"}}');
    const out = sanitizeSettingsPatch(body);
    expect(out.camera_snapshot_urls).toEqual({ ok: 'http://192.168.1.5/s.jpg' });
  });
});

describe('url helpers', () => {
  it('godtar kun http(s) uten credentials', () => {
    expect(isSafeSnapshotUrl('https://cam.local/snap.jpg')).toBe(true);
    expect(isSafeSnapshotUrl('ftp://cam/snap.jpg')).toBe(false);
    expect(isSafeSnapshotUrl('http://u:p@cam/snap.jpg')).toBe(false);
  });

  it('fjerner credentials fra URL før logging', () => {
    expect(redactUrl('http://user:secret@cam/s.jpg')).toBe('http://cam/s.jpg');
    expect(redactUrl('not a url')).toBe('[invalid-url]');
  });
});
