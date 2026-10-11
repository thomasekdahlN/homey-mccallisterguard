'use strict';

/**
 * Backend i18n for event-log entries, Homey Timeline notifications and push
 * notifications. Homey's own multi-language mechanism (app.json / flow cards /
 * Homey.__() locale files) always falls back to English for unsupported
 * languages — this module does the same for text generated at runtime.
 */

export type Lang = 'en' | 'nl' | 'no';
const SUPPORTED_LANGS: readonly Lang[] = ['en', 'nl', 'no'];

interface HomeyI18n { i18n: { getLanguage(): string } }

export function resolveLang(homey: HomeyI18n): Lang {
  const lang = homey.i18n.getLanguage();
  return (SUPPORTED_LANGS as readonly string[]).includes(lang) ? (lang as Lang) : 'en';
}

type Vars = Record<string, string | number>;

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

const MESSAGES = {
  'common.enabled': { en: 'enabled', nl: 'ingeschakeld', no: 'aktivert' },
  'common.disabled': { en: 'disabled', nl: 'uitgeschakeld', no: 'deaktivert' },
  'common.unknown': { en: 'unknown', nl: 'onbekend', no: 'ukjent' },

  // DeterrenceEngine
  'dtr.intruder_moving_toward_reaction_zone': {
    en: 'Intruder moving toward reaction zone {zone}.',
    nl: 'Indringer beweegt richting reactiezone {zone}.',
    no: 'Tyv beveger seg mot reaksjonssone {zone}.',
  },
  'dtr.post_cooldown_failed': {
    en: 'Deterrence (post-cooldown) failed: {error}',
    nl: 'Afschrikking (na afkoeling) mislukt: {error}',
    no: 'Deterrence (post-cooldown) feilet: {error}',
  },
  'dtr.direct_test': {
    en: 'Direct deterrence in zone {zone} (test).',
    nl: 'Directe afschrikking in zone {zone} (test).',
    no: 'Direkte avskrekking i sone {zone} (test).',
  },
  'dtr.stopped': {
    en: 'Deterrence stopped.',
    nl: 'Afschrikking gestopt.',
    no: 'Avskrekking stoppet.',
  },
  'dtr.darkening': {
    en: 'Darkening {zone}: {reason}',
    nl: 'Verduisteren {zone}: {reason}',
    no: 'Mørklegger {zone}: {reason}',
  },

  // CameraManager
  'camera.zone_cache_refresh_failed': {
    en: 'Camera zone cache refresh failed: {error}',
    nl: 'Vernieuwen van camerazonecache mislukt: {error}',
    no: 'Kamera-sone-cache oppdatering feilet: {error}',
  },
  'camera.lights_on_for_capture': {
    en: 'Turning on lights in zone {zone} for camera capture.',
    nl: 'Lichten in zone {zone} inschakelen voor camera-opname.',
    no: 'Slår på lys i sone {zone} for kamera-opptak.',
  },
  'camera.light_flash_failed': {
    en: 'Light flash failed in zone {zone}: {error}',
    nl: 'Lichtflits mislukt in zone {zone}: {error}',
    no: 'Lys-flash feilet i sone {zone}: {error}',
  },
  'camera.snapshot_http_error': {
    en: 'Snapshot: HTTP {status} from camera {camera} ({url}).',
    nl: 'Snapshot: HTTP {status} van camera {camera} ({url}).',
    no: 'Snapshot: HTTP {status} fra kamera {camera} ({url}).',
  },
  'camera.snapshot_empty_buffer': {
    en: 'Snapshot: empty buffer from {camera} — no data from camera.',
    nl: 'Snapshot: lege buffer van {camera} — geen data van camera.',
    no: 'Snapshot: tom buffer fra {camera} — ingen data fra kamera.',
  },
  'camera.snapshot_saved': {
    en: 'Snapshot saved: {camera} in zone {zone} ({kind}, {bytes} B).',
    nl: 'Snapshot opgeslagen: {camera} in zone {zone} ({kind}, {bytes} B).',
    no: 'Snapshot lagret: {camera} i sone {zone} ({kind}, {bytes} B).',
  },
  'camera.kind_alarm': { en: 'alarm', nl: 'alarm', no: 'alarm' },
  'camera.kind_motion': { en: 'motion', nl: 'beweging', no: 'bevegelse' },
  'camera.snapshot_call_failed': {
    en: 'Snapshot request failed for {camera}: {error}',
    nl: 'Snapshot-aanvraag mislukt voor {camera}: {error}',
    no: 'Snapshot-kall feilet for {camera}: {error}',
  },
  'camera.snapshot_cleanup_failed': {
    en: 'Snapshot cleanup failed ({dir}): {error}',
    nl: 'Opschonen van snapshots mislukt ({dir}): {error}',
    no: 'Snapshot-opprydding feilet ({dir}): {error}',
  },
  'camera.snapshot_dir_create_failed': {
    en: 'Could not create snapshot directory {dir}: {error}',
    nl: 'Kon snapshotmap {dir} niet aanmaken: {error}',
    no: 'Kunne ikke opprette snapshot-katalog {dir}: {error}',
  },

  // app.ts
  'app.deterrence_started_timeline': {
    en: 'Deterrence started in {reaction} (motion in {motion}).',
    nl: 'Afschrikking gestart in {reaction} (beweging in {motion}).',
    no: 'Avskrekking startet i {reaction} (bevegelse i {motion}).',
  },
  'app.snapshot_trigger_fired': {
    en: 'Flow trigger «snapshot_taken» fired for {camera} in zone {zone}.',
    nl: 'Flow-trigger «snapshot_taken» geactiveerd voor {camera} in zone {zone}.',
    no: 'Flow-trigger «snapshot_taken» fyrt for {camera} i sone {zone}.',
  },
  'app.snapshot_trigger_failed': {
    en: 'Flow trigger «snapshot_taken» failed: {error}',
    nl: 'Flow-trigger «snapshot_taken» mislukt: {error}',
    no: 'Flow-trigger «snapshot_taken» feilet: {error}',
  },
  'app.away_disarm_redirect': {
    en: 'Away mode disarmed during perimeter window — switching to Perimeter instead.',
    nl: 'Afwezig-modus uitgeschakeld tijdens perimetervenster — schakelt in plaats daarvan over naar Perimeter.',
    no: 'Borte-modus deaktivert i skalltidsvindu — bytter til Skallsikring i stedet.',
  },
  'app.disarm_after_alarm_redirect_suppressed': {
    en: 'Disarming after alarm — Perimeter redirect suppressed.',
    nl: 'Uitschakelen na alarm — Perimeter-omleiding onderdrukt.',
    no: 'Deaktivering etter alarm — Skallsikring-omdirigering undertrykket.',
  },
  'app.perimeter_activated_open_sensors': {
    en: 'Perimeter activated — {count} sensor(s) open and ignored: {names}',
    nl: 'Perimeter ingeschakeld — {count} sensor(en) open en genegeerd: {names}',
    no: 'Skallsikring aktivert — {count} sensor(er) åpen og ignoreres: {names}',
  },
  'app.perimeter_activated': {
    en: 'Perimeter activated.',
    nl: 'Perimeter ingeschakeld.',
    no: 'Skallsikring aktivert.',
  },
  'app.test_deterrence_started': {
    en: 'Test: deterrence in zone {zone} — auto-stop in {seconds}s.',
    nl: 'Test: afschrikking in zone {zone} — automatisch gestopt over {seconds}s.',
    no: 'Test: avskrekking i sone {zone} — auto-stopp om {seconds}s.',
  },
  'app.test_alarm_started': {
    en: 'Test: full alarm (mode=alarm) — auto-stop in {seconds}s.',
    nl: 'Test: volledig alarm (modus=alarm) — automatisch gestopt over {seconds}s.',
    no: 'Test: full alarm (modus=alarm) — auto-stopp om {seconds}s.',
  },
  'app.motion_snapshots_toggled': {
    en: 'Motion snapshots {state}.',
    nl: 'Bewegingssnapshots {state}.',
    no: 'Bevegelsesbilder {state}.',
  },
  'app.perimeter_bypass_activated': {
    en: 'Perimeter bypass activated for {seconds}s — perimeter sensors ignored.',
    nl: 'Perimeter-omzeiling geactiveerd voor {seconds}s — perimetersensoren genegeerd.',
    no: 'Perimeter-bypass aktivert i {seconds}s — perimetersensorer ignoreres.',
  },
  'app.perimeter_bypass_expired': {
    en: 'Perimeter bypass expired — perimeter sensors active again.',
    nl: 'Perimeter-omzeiling verlopen — perimetersensoren weer actief.',
    no: 'Perimeter-bypass utløpt — perimetersensorer aktive igjen.',
  },
  'app.alarm_stopped_log': {
    en: 'Alarm stopped.',
    nl: 'Alarm gestopt.',
    no: 'Alarm stoppet.',
  },
  'app.alarm_stopped_reason_perimeter_ended': {
    en: 'Perimeter alarm ended.',
    nl: 'Perimeteralarm beëindigd.',
    no: 'Skallsikring alarm avsluttet.',
  },
  'app.alarm_stopped_reason_disarmed': {
    en: 'Stopped by user.',
    nl: 'Gestopt door gebruiker.',
    no: 'Stoppet av bruker.',
  },
  'app.alarm_stopped_reason_test_auto': {
    en: 'Test alarm finished (auto-stop).',
    nl: 'Testalarm afgerond (automatisch gestopt).',
    no: 'Test alarm ferdig (auto-stopp).',
  },
  'app.alarm_stopped_reason_mode_change': {
    en: 'Mode changed to {mode}.',
    nl: 'Modus gewijzigd naar {mode}.',
    no: 'Modus endret til {mode}.',
  },
  'app.alarm_stopped_reason_user': {
    en: 'User stopped alarm.',
    nl: 'Gebruiker heeft alarm gestopt.',
    no: 'Bruker stoppet alarm.',
  },
  'app.deterrence_alarm_log': {
    en: '{label} Deterrence in {zone} — {device}.',
    nl: '{label} Afschrikking in {zone} — {device}.',
    no: '{label} Avskrekking i {zone} — {device}.',
  },
  'app.deterrence_timeline': {
    en: '🚨 Deterrence: {device} in {zone}',
    nl: '🚨 Afschrikking: {device} in {zone}',
    no: '🚨 Avskrekking: {device} i {zone}',
  },
  'app.perimeter_sensor_triggered_log': {
    en: '**Perimeter** sensor triggered: {device} in {zone}.',
    nl: '**Perimeter** sensor geactiveerd: {device} in {zone}.',
    no: '**Perimeter** sensor utløst: {device} i {zone}.',
  },
  'app.perimeter_alarm_timeline': {
    en: '🚨 Perimeter: {device} in {zone}',
    nl: '🚨 Perimeter: {device} in {zone}',
    no: '🚨 Skallsikring: {device} i {zone}',
  },
  'app.alarm_triggered_timeline_base': {
    en: '🚨 ALARM triggered',
    nl: '🚨 ALARM geactiveerd',
    no: '🚨 ALARM utløst',
  },
  'app.alarm_triggered_timeline_zone': {
    en: ' in {zone}',
    nl: ' in {zone}',
    no: ' i {zone}',
  },
  'app.perimeter_alarm_stopped_timeline': {
    en: 'Perimeter alarm stopped',
    nl: 'Perimeteralarm gestopt',
    no: 'Skallsikring alarm stoppet',
  },
  'app.alarm_stopped_timeline': {
    en: 'Alarm stopped',
    nl: 'Alarm gestopt',
    no: 'Alarm stoppet',
  },
  'app.perimeter_autostart_deferred': {
    en: 'Perimeter auto-start deferred — alarm recently stopped.',
    nl: 'Automatisch inschakelen van Perimeter uitgesteld — alarm recent gestopt.',
    no: 'Skallsikring-autostart utsatt — alarm nylig stoppet.',
  },
  'app.perimeter_deactivated': {
    en: 'Perimeter deactivated.',
    nl: 'Perimeter uitgeschakeld.',
    no: 'Skallsikring deaktivert.',
  },
  'app.health_check_offline': {
    en: 'Armed, but {count} sensor(s) not reporting: {names}',
    nl: 'Ingeschakeld, maar {count} sensor(en) reageren niet: {names}',
    no: 'Aktivert, men {count} sensor(er) rapporterer ikke: {names}',
  },
  'app.health_check_failed': {
    en: 'Health check failed: {error}',
    nl: 'Gezondheidscontrole mislukt: {error}',
    no: 'Helsesjekk feilet: {error}',
  },
  'app.disarmed_by_with_comment': {
    en: 'Disarmed by {who} — {comment}.',
    nl: 'Uitgeschakeld door {who} — {comment}.',
    no: 'Deaktivert av {who} — {comment}.',
  },
  'app.disarmed_by': {
    en: 'Disarmed by {who}.',
    nl: 'Uitgeschakeld door {who}.',
    no: 'Deaktivert av {who}.',
  },
  'app.disarmed_by_timeline': {
    en: 'Disarmed by {who}',
    nl: 'Uitgeschakeld door {who}',
    no: 'Deaktivert av {who}',
  },
  'app.arrival_with_comment': {
    en: 'Arrival: {who} — {comment}. Perimeter remains active.',
    nl: 'Thuiskomst: {who} — {comment}. Perimeter blijft actief.',
    no: 'Hjemkomst: {who} — {comment}. Skallsikring forblir aktiv.',
  },
  'app.arrival': {
    en: 'Arrival: {who} — Perimeter remains active.',
    nl: 'Thuiskomst: {who} — Perimeter blijft actief.',
    no: 'Hjemkomst: {who} — Skallsikring forblir aktiv.',
  },
  'app.arrival_timeline': {
    en: 'Home: {who}',
    nl: 'Thuis: {who}',
    no: 'Hjemme: {who}',
  },
  'app.comment_log': {
    en: 'Comment: {comment}',
    nl: 'Opmerking: {comment}',
    no: 'Kommentar: {comment}',
  },
  'app.snapshot_open_sensors_failed': {
    en: 'Snapshot of open sensors failed: {error}',
    nl: 'Snapshot van open sensoren mislukt: {error}',
    no: 'Snapshot av åpne sensorer feilet: {error}',
  },
  'app.open_contacts_at_arming': {
    en: '{count} door/window open at arming: {names}',
    nl: '{count} deur(en)/raam(ramen) open bij inschakelen: {names}',
    no: '{count} dør/vindu er åpen(e) ved aktivering: {names}',
  },
  'app.check_open_sensors_failed': {
    en: 'Check of open sensors failed: {error}',
    nl: 'Controle van open sensoren mislukt: {error}',
    no: 'Sjekk av åpne sensorer feilet: {error}',
  },
  'app.motion_entry_delay_started': {
    en: 'Motion: {device} in {zone} — entry delay started ({seconds}s).',
    nl: 'Beweging: {device} in {zone} — ingangsvertraging gestart ({seconds}s).',
    no: 'Bevegelse: {device} i {zone} — inngangsforsinkelse startet ({seconds}s).',
  },
  'app.motion_in_zone': {
    en: 'Motion in zone {zone}.',
    nl: 'Beweging in zone {zone}.',
    no: 'Bevegelse i sone {zone}.',
  },
  'app.entry_delay_started': {
    en: 'Entry delay started ({seconds}s) — disarm to cancel.',
    nl: 'Ingangsvertraging gestart ({seconds}s) — schakel uit om te annuleren.',
    no: 'Inngangsforsinkelse startet ({seconds}s) — deaktiver for å avbryte.',
  },
  'app.contact_opened_in_zone': {
    en: 'Door/window opened in zone {zone}.',
    nl: 'Deur/raam geopend in zone {zone}.',
    no: 'Dør/vindu åpnet i sone {zone}.',
  },
  'app.entry_delay_started_perimeter_bypass': {
    en: 'Entry delay started ({seconds}s) — perimeter sensors ignored for the same period.',
    nl: 'Ingangsvertraging gestart ({seconds}s) — perimetersensoren worden voor dezelfde periode genegeerd.',
    no: 'Inngangsforsinkelse startet ({seconds}s) — perimetersensorer ignoreres i samme periode.',
  },
  'app.perimeter_sensor_opened_entry_delay': {
    en: 'Perimeter sensor opened: {device} in {zone} — entry delay started ({seconds}s).',
    nl: 'Perimetersensor geopend: {device} in {zone} — ingangsvertraging gestart ({seconds}s).',
    no: 'Perimeter-sensor åpnet: {device} i {zone} — inngangsforsinkelse startet ({seconds}s).',
  },
  'app.mode_label_off': {
    en: 'App disabled (Off mode)',
    nl: 'App uitgeschakeld (Uit-modus)',
    no: 'App deaktivert (Av-modus)',
  },
  'app.mode_label_disarmed': {
    en: 'Alarm off',
    nl: 'Alarm uit',
    no: 'Alarm av',
  },
  'app.mode_label_armed': {
    en: 'Alarm on',
    nl: 'Alarm aan',
    no: 'Alarm på',
  },
  'app.mode_label_armed_perimeter': {
    en: 'Alarm perimeter',
    nl: 'Alarm perimeter',
    no: 'Alarm skallsikring',
  },
  'app.mode_label_perimeter_alarm': {
    en: '🚨 Perimeter triggered',
    nl: '🚨 Perimeter geactiveerd',
    no: '🚨 Skallsikring utløst',
  },
  'app.mode_label_deterrence': {
    en: 'Deterrence',
    nl: 'Afschrikking',
    no: 'Avskrekking',
  },
  'app.mode_label_alarm': {
    en: '🚨 ALARM',
    nl: '🚨 ALARM',
    no: '🚨 ALARM',
  },

  // MediaCaster
  'media.stopall_summary': {
    en: 'stopAll: {count} light task(s) ended and lights turned off.',
    nl: 'stopAll: {count} lichttaak/taken beëindigd en lichten uitgeschakeld.',
    no: 'stopAll: {count} lys-oppgave(r) avsluttet og lys slukket.',
  },
  'media.stop_zone_failed': {
    en: 'Stop zone failed: {error}',
    nl: 'Stoppen van zone mislukt: {error}',
    no: 'Stop zone feilet: {error}',
  },
  'media.no_lights_to_blink': {
    en: 'No lights to blink in zone {zone}.',
    nl: 'Geen lampen om te laten knipperen in zone {zone}.',
    no: 'Ingen lys å blinke i sone {zone}.',
  },
  'media.starting_blink': {
    en: 'Starting blinking lights in zone {zone}: {count} light(s), {onSec}s on / {offSec}s off.',
    nl: 'Knipperende lichten starten in zone {zone}: {count} lamp(en), {onSec}s aan / {offSec}s uit.',
    no: 'Starter blinkende lys i sone {zone}: {count} lys, {onSec}s på / {offSec}s av.',
  },

  // EscalationManager
  'escalation.full_escalation': {
    en: 'ALARM: Full escalation — sirens and strobe active.',
    nl: 'ALARM: Volledige escalatie — sirenes en stroboscoop actief.',
    no: 'ALARM: Full eskalering — sirener og strobe aktiv.',
  },
  'escalation.alarm_ended': {
    en: 'Alarm ended — {count} light(s) restored.',
    nl: 'Alarm beëindigd — {count} lamp(en) hersteld.',
    no: 'Alarm avsluttet — {count} lys gjenopprettet.',
  },
  'escalation.trigger_failed': {
    en: 'Alarm escalation failed: {error}',
    nl: 'Alarm-escalatie mislukt: {error}',
    no: 'Alarm-eskalering feilet: {error}',
  },

  // api.ts
  'api.invalid_type_or_filename': {
    en: 'Invalid type or filename.',
    nl: 'Ongeldig type of bestandsnaam.',
    no: 'Ugyldig type eller filnavn.',
  },
  'api.invalid_filename': {
    en: 'Invalid filename.',
    nl: 'Ongeldige bestandsnaam.',
    no: 'Ugyldig filnavn.',
  },
  'api.invalid_type': {
    en: 'Invalid type. Use alarm, motion or all.',
    nl: 'Ongeldig type. Gebruik alarm, motion of all.',
    no: 'Ugyldig type. Bruk alarm, motion eller all.',
  },

  // StateMachine
  'state.invalid_transition': {
    en: 'Invalid mode transition: cannot go from {from} to {to}. Disarm the system first.',
    nl: 'Ongeldige modusovergang: kan niet van {from} naar {to} gaan. Schakel het systeem eerst uit.',
    no: 'Ugyldig modusovergang: kan ikke gå fra {from} til {to}. Deaktiver systemet først.',
  },
  'state.activating_away_exit_delay': {
    en: 'Activating Away mode in {seconds}s (Exit Delay).',
    nl: 'Afwezig-modus wordt geactiveerd over {seconds}s (Exit Delay).',
    no: 'Aktiverer Borte-modus om {seconds}s (Exit Delay).',
  },
  'state.exit_delay_cancelled': {
    en: 'Exit Delay cancelled — mode remains {mode}.',
    nl: 'Exit Delay geannuleerd — modus blijft {mode}.',
    no: 'Exit Delay avbrutt — modus forblir {mode}.',
  },
  'state.entry_detected_countdown': {
    en: 'Entry detected. Countdown {seconds}s.',
    nl: 'Binnenkomst gedetecteerd. Aftellen {seconds}s.',
    no: 'Innpassering oppdaget. Nedtelling {seconds}s.',
  },
  'state.mode_log': {
    en: 'Mode: {mode}.',
    nl: 'Modus: {mode}.',
    no: 'Modus: {mode}.',
  },
  'state.mode_listener_failed': {
    en: 'Mode listener failed: {error}',
    nl: 'Modus-listener mislukt: {error}',
    no: 'Mode listener feilet: {error}',
  },

  // App resilience
  'app.startup_retry': {
    en: 'Startup step "{step}" failed ({error}) — retrying in {seconds}s.',
    nl: 'Opstartstap "{step}" mislukt ({error}) — opnieuw proberen over {seconds}s.',
    no: 'Oppstartssteg "{step}" feilet ({error}) — prøver igjen om {seconds}s.',
  },
  'app.state_recovered': {
    en: 'App restarted during {mode} — restored to {restored}.',
    nl: 'App herstart tijdens {mode} — hersteld naar {restored}.',
    no: 'Appen ble startet på nytt under {mode} — gjenopprettet til {restored}.',
  },
  'app.entry_delay_cancelled': {
    en: 'Entry delay cancelled.',
    nl: 'Ingangsvertraging geannuleerd.',
    no: 'Inngangsforsinkelse avbrutt.',
  },
  'app.sensor_listener_added': {
    en: 'Now monitoring new sensor {device}.',
    nl: 'Nieuwe sensor {device} wordt nu bewaakt.',
    no: 'Overvåker nå ny sensor {device}.',
  },
  'app.task_failed': {
    en: 'Background task failed: {error}',
    nl: 'Achtergrondtaak mislukt: {error}',
    no: 'Bakgrunnsoppgave feilet: {error}',
  },

  // SimulationEngine
  'sim.started': {
    en: 'Kevin mode started (presence simulation).',
    nl: 'Kevin-modus gestart (aanwezigheidssimulatie).',
    no: 'Kevin-modus startet (tilstedeværelsessimulering).',
  },
  'sim.stopped': {
    en: 'Kevin mode stopped',
    nl: 'Kevin-modus gestopt',
    no: 'Kevin-modus stoppet',
  },
  'sim.stopped_outside_window': {
    en: 'Kevin mode stopped (outside time window)',
    nl: 'Kevin-modus gestopt (buiten tijdvenster)',
    no: 'Kevin-modus stoppet (utenfor tidsvindu)',
  },
  'sim.cycle_failed': {
    en: 'Kevin cycle failed: {error}',
    nl: 'Kevin-cyclus mislukt: {error}',
    no: 'Kevin-cycle feilet: {error}',
  },
  'sim.lights_on': {
    en: 'Kevin mode: lights on — {names}.',
    nl: 'Kevin-modus: lichten aan — {names}.',
    no: 'Kevin-modus: lys på — {names}.',
  },
  'sim.lights_off_default': {
    en: 'Kevin mode: lights off',
    nl: 'Kevin-modus: lichten uit',
    no: 'Kevin-modus: lys av',
  },
  'sim.lights_off_with_prefix': {
    en: '{prefix}: lights off',
    nl: '{prefix}: lichten uit',
    no: '{prefix}: lys av',
  },
} as const satisfies Record<string, Record<Lang, string>>;

export type MessageKey = keyof typeof MESSAGES;

export function t(homey: HomeyI18n, key: MessageKey, vars?: Vars): string {
  const lang = resolveLang(homey);
  const table = MESSAGES[key];
  const template = table[lang] ?? table.en;
  return format(template, vars);
}
