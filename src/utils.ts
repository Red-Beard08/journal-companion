import type { TFile, Vault } from "obsidian";
import { replaceManagedBlock, normalizeVaultFile, normalizeVaultFolder, safeFilename } from "./foundation-vendor";
import { DAILY_END, DAILY_START, type GoalDefinition, type JournalSettings, type SeasonRecord } from "./types";

export const STARTER_AREAS = [
  ["Gratitude", "What can I receive with thankfulness today?"],
  ["Scripture", "What truth from Scripture should shape my thoughts and actions today?"],
  ["Relationships", "Who needs patient, faithful love from me today?"],
  ["Health", "How will I steward my body, rest, and attention today?"],
  ["Reflection", "What did I learn, and where do I need to grow?"],
] as const;

export function today(): string { return new Date().toISOString().slice(0, 10); }

export function parseDateFromFilename(name: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(name);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const named = /^(\d{4})-([A-Za-z]{3})-(\d{1,2})/.exec(name);
  if (!named) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[2].toLowerCase());
  if (month < 0) return null;
  return `${named[1]}-${String(month + 1).padStart(2, "0")}-${named[3].padStart(2, "0")}`;
}

export function formatDate(date: Date, format: string): string {
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()];
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  return format.replace(/YYYY/g, String(date.getFullYear())).replace(/MMM/g, month).replace(/MM/g, String(date.getMonth() + 1).padStart(2, "0")).replace(/DD/g, String(date.getDate()).padStart(2, "0")).replace(/ddd/g, weekday);
}

export function normalizeSettings(raw: unknown): JournalSettings {
  const defaults = defaultSettings();
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawFolders = value.folders && typeof value.folders === "object" ? value.folders as Record<string, unknown> : {};
  const folders = {
    ...defaults.folders,
    ...Object.fromEntries(Object.entries(rawFolders).map(([key, item]) => [key, normalizeVaultFolder(String(item), defaults.folders[key] ?? key)])),
  } as JournalSettings["folders"];
  const rawFiles = value.files && typeof value.files === "object" ? value.files as Record<string, unknown> : {};
  const files = {
    ...defaults.files,
    ...Object.fromEntries(Object.entries(rawFiles).map(([key, item]) => [key, normalizeVaultFile(String(item), defaults.files[key] ?? `${key}.md`)])),
  } as JournalSettings["files"];
  const rootFolder = normalizeVaultFolder(String(value.rootFolder ?? defaults.rootFolder), defaults.rootFolder);
  const dashboardPath = normalizeVaultFile(String(value.dashboardPath ?? defaults.dashboardPath), defaults.dashboardPath);
  const prayerRaw = value.prayer && typeof value.prayer === "object" ? value.prayer as Record<string, unknown> : {};
  const reportRange = ["7", "30", "90", "season", "all"].includes(String(value.reportRange)) ? String(value.reportRange) as JournalSettings["reportRange"] : defaults.reportRange;
  return {
    ...defaults,
    ...value,
    rootFolder,
    folders,
    files,
    dashboardPath,
    legacySourceFolder: normalizeVaultFolder(String(value.legacySourceFolder ?? defaults.legacySourceFolder), defaults.legacySourceFolder),
    dailyFormat: String(value.dailyFormat ?? defaults.dailyFormat).trim() || defaults.dailyFormat,
    setupComplete: value.setupComplete === true,
    reportRange,
    prayer: {
      ...defaults.prayer,
      ...prayerRaw,
      enabled: prayerRaw.enabled !== false,
      pluginId: String(prayerRaw.pluginId ?? defaults.prayer.pluginId).trim() || defaults.prayer.pluginId,
      categories: Array.isArray(prayerRaw.categories) ? prayerRaw.categories.map(String).map(s => s.trim()).filter(Boolean) : defaults.prayer.categories,
      dailyCount: Math.max(0, Math.min(50, Number(prayerRaw.dailyCount) || defaults.prayer.dailyCount)),
      showScripture: prayerRaw.showScripture !== false,
      showHistory: prayerRaw.showHistory === true,
    },
    starterAreasEnabled: value.starterAreasEnabled === true,
    createOnStartup: value.createOnStartup === true,
    reviewCadences: Array.isArray(value.reviewCadences) ? value.reviewCadences.filter((item): item is JournalSettings["reviewCadences"][number] => ["daily", "weekly", "monthly", "quarterly"].includes(String(item))) : defaults.reviewCadences,
  } as JournalSettings;
}

export function defaultSettings(): JournalSettings {
  const root = "Journal Companion";
  return {
    settingsVersion: 1,
    rootFolder: root,
    folders: { records: "Records", profiles: "Profiles", archive: "Archive", reports: "Reports", backups: "Backups", daily: `${root}/Daily`, seasons: `${root}/Seasons`, areas: `${root}/Areas`, reviews: `${root}/Reviews` },
    files: { index: "Journal Companion Index.md", summary: "Summary.md", journal: "Migration Journal.md" },
    naming: { idPrefix: "JRN", filenameTemplate: "{date}", dateFormat: "YYYY-MM-DD" },
    taxonomy: { categories: [], statuses: ["active", "completed", "archived"], archived: ["archived"] },
    defaults: { goalRecurrence: "daily", reviewCadence: "weekly" },
    dashboard: { startup: false, autoRefreshSeconds: 0, compact: false },
    migration: { sourceFolder: "Journal", mode: "in-place" },
    privacy: { showReminder: false },
    dashboardPath: `${root}/Journal Companion Dashboard.md`,
    legacySourceFolder: "Journal",
    dailyFormat: "YYYY-MMM-DD-ddd",
    setupComplete: false,
    reportRange: "30",
    prayer: { enabled: true, pluginId: "prayer-library", categories: [], dailyCount: 3, showScripture: true, showHistory: false },
    starterAreasEnabled: false,
    createOnStartup: false,
    reviewCadences: ["weekly", "monthly", "quarterly"],
  };
}

export function stableId(prefix: string, seed: string): string {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${Math.abs(hash >>> 0).toString(36).toUpperCase().slice(0, 8)}`;
}

export function safeDailyPath(settings: JournalSettings, date: string): string {
  return `${settings.folders.daily}/${safeFilename(formatDate(new Date(`${date}T12:00:00`), settings.dailyFormat), date)}.md`;
}

export function isDue(goal: GoalDefinition, date: string): boolean {
  if (!goal.active) return false;
  const value = new Date(`${date}T12:00:00`);
  if (goal.recurrence === "daily") return true;
  if (goal.recurrence === "weekly" || goal.recurrence === "weekdays") return goal.weekdays?.length ? goal.weekdays.includes(value.getDay()) : value.getDay() === 1;
  if (goal.recurrence === "monthly") return value.getDate() === 1;
  return value.getMonth() % 3 === 0 && value.getDate() === 1;
}

export function activeSeasonsFor(seasons: SeasonRecord[], date = today()): SeasonRecord[] {
  return seasons.filter(season => season.status === "active" && (!season.startDate || season.startDate <= date) && (!season.endDate || season.endDate >= date));
}

export function parseJsonBlock<T>(text: string, start: string, end: string, fallback: T): T {
  const a = text.indexOf(start); if (a < 0) return fallback;
  const b = text.indexOf(end, a + start.length); if (b < 0) return fallback;
  try { return JSON.parse(text.slice(a + start.length, b).trim()) as T; } catch { return fallback; }
}

export function renderDailyManagedBlock(seasons: SeasonRecord[], areas: import("./types").AreaRecord[], date: string, existing = ""): string {
  const lines: string[] = ["## Today", "", `Date: ${date}`, ""];
  const dueGoals = seasons.flatMap(season => season.goals.filter(goal => isDue(goal, date)).map(goal => ({ season, goal })));
  if (dueGoals.length) {
    lines.push("### Goals", "");
    let lastSeason = "";
    for (const item of dueGoals) {
      if (item.season.id !== lastSeason) { lines.push(`**${item.season.name}**`); lastSeason = item.season.id; }
      lines.push(`- [ ] ${item.goal.title} <!-- journal-goal:${item.goal.id} -->`);
    }
    lines.push("");
  }
  const focuses = seasons.flatMap(season => season.focuses.filter(focus => focus.active && (!focus.startDate || focus.startDate <= date) && (!focus.endDate || focus.endDate >= date)).map(focus => ({ season, focus })));
  if (focuses.length) { lines.push("### Focuses", "", ...focuses.map(item => `- ${item.focus.text} — *${item.season.name}*`), ""); }
  if (areas.length) { lines.push("### Journal prompts", "", ...areas.filter(area => area.status === "active").sort((a, b) => a.order - b.order).map(area => `#### ${area.name}\n\n${area.prompt || ""}\n\nResponse: \n`)); }
  return replaceManagedBlock(existing, { start: DAILY_START, end: DAILY_END }, lines.join("\n"));
}

export async function ensureFolders(vault: Vault, paths: string[]): Promise<void> {
  for (const path of paths.map(item => normalizeVaultFolder(item, "")).filter(Boolean)) {
    const segments = path.split("/"); let current = "";
    for (const segment of segments) { current = current ? `${current}/${segment}` : segment; if (vault.getAbstractFileByPath(current)) continue; try { await vault.createFolder(current); } catch { if (!vault.getAbstractFileByPath(current)) throw new Error(`Could not create folder: ${current}`); } }
  }
}

export function frontmatterForDaily(id: string, date: string, settings: JournalSettings, seasons: string[] = []): string {
  return `---\ntype: journal-companion-daily\nschema_version: 1\njournal_id: ${id}\ndate: ${date}\nseasons: ${JSON.stringify(seasons)}\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\ntags: [journal]\n---\n\n`;
}

export function frontmatterForSeason(id: string, name: string): string {
  return `---\ntype: journal-companion-season\nschema_version: 1\nseason_id: ${id}\nname: ${JSON.stringify(name)}\nstatus: active\nstart_date: ${today()}\ngoals: []\nfocuses: []\nscripture: []\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\n---\n\n# ${name}\n`;
}

export function frontmatterForArea(id: string, name: string, prompt: string): string {
  return `---\ntype: journal-companion-area\nschema_version: 1\narea_id: ${id}\nname: ${JSON.stringify(name)}\norder: 1\nstatus: active\nprompt: ${JSON.stringify(prompt)}\nscripture: []\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\n---\n\n# ${name}\n\n${prompt}\n`;
}

export async function writeManagedDaily(vault: Vault, file: TFile, seasons: SeasonRecord[], areas: import("./types").AreaRecord[], date: string): Promise<void> {
  await vault.process(file, current => {
    const marker = current.indexOf("\n---\n", 4);
    const head = marker >= 0 ? current.slice(0, marker + 5) : "";
    const body = marker >= 0 ? current.slice(marker + 5) : current;
    const nextBody = renderDailyManagedBlock(seasons, areas, date, body);
    return `${head}${nextBody}${nextBody.endsWith("\n") ? "" : "\n"}`;
  });
}
