export const REPAIR_SOUND_LS_KEY = "rt_repair_notify_sound_id";

export type RepairSoundOption = { id: string; label: string; file: string };

/** Verfügbare Klingeltöne (Dateien in `public/sounds/`). */
export const REPAIR_SOUND_OPTIONS: RepairSoundOption[] = [
  { id: "epica", label: "Epica / TheGrefg", file: "musica-thegrefg-epica.mp3" },
  { id: "jefe", label: "Jefe", file: "jefe.mp3" },
  { id: "dear-sister", label: "Dear Sister …", file: "mmm-whatcha-say_WzxhjD0.mp3" },
  { id: "mafia-city", label: "Mafia City", file: "source-mafia-city-ad-music.mp3" },
  { id: "fox-sports", label: "Fox Sports", file: "toca-a-musica-do-fox-sports.mp3" },
];

export function repairSoundUrlForFile(file: string): string {
  return `/sounds/${file}`;
}

export function getRepairNotificationSoundUrl(): string {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(REPAIR_SOUND_LS_KEY) : null;
  const opt = REPAIR_SOUND_OPTIONS.find((o) => o.id === raw) ?? REPAIR_SOUND_OPTIONS[0];
  return repairSoundUrlForFile(opt.file);
}

export function getRepairNotificationSoundId(): string {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(REPAIR_SOUND_LS_KEY) : null;
  const opt = REPAIR_SOUND_OPTIONS.find((o) => o.id === raw);
  return opt?.id ?? REPAIR_SOUND_OPTIONS[0].id;
}

export function setRepairNotificationSoundId(id: string): void {
  if (!REPAIR_SOUND_OPTIONS.some((o) => o.id === id)) return;
  localStorage.setItem(REPAIR_SOUND_LS_KEY, id);
}
