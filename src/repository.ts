import type { App, TFile, Vault } from "obsidian";
import { DAILY_TYPE, AREA_TYPE, SEASON_TYPE, type AreaRecord, type DailyRecord, type GoalDefinition, type JournalRepositoryLike, type JournalSettings, type PrayerLibraryBridge, type SeasonRecord, type FocusDefinition } from "./types";
import { activeSeasonsFor, parseDateFromFilename, parseJsonBlock, stableId } from "./utils";
import { SEASON_FOCUSES_END, SEASON_FOCUSES_START, SEASON_GOALS_END, SEASON_GOALS_START } from "./types";

function list(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map(item => item.trim()).filter(Boolean) : typeof value === "string" ? value.split(",").map(item => item.trim()).filter(Boolean) : []; }
function frontmatter(app: App, file: TFile): Record<string, unknown> { return (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>; }

export class JournalRepository implements JournalRepositoryLike {
  constructor(private app: App, private settings: JournalSettings) {}
  private markdownFiles(prefix?: string): TFile[] { return this.app.vault.getMarkdownFiles().filter(file => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`)); }

  async getDaily(date?: string): Promise<DailyRecord | null> {
    const target = date ?? new Date().toISOString().slice(0, 10);
    const files = this.markdownFiles(this.settings.folders.daily).concat(this.markdownFiles(this.settings.legacySourceFolder));
    for (const file of [...new Set(files)]) {
      const fm = frontmatter(this.app, file);
      const parsed = String(fm.date ?? parseDateFromFilename(file.basename) ?? "");
      if (parsed !== target || (file.path === this.settings.legacySourceFolder)) continue;
      const content = await this.app.vault.cachedRead(file);
      const marker = content.indexOf("\n---\n", 4);
      const body = marker >= 0 ? content.slice(marker + 5) : content;
      return { file, id: String(fm.journal_id ?? fm.id ?? stableId("JRN", file.path)), date: target, seasonIds: list(fm.seasons), legacy: fm.type !== DAILY_TYPE, content, managedContent: body };
    }
    return null;
  }

  async getSeasons(): Promise<SeasonRecord[]> {
    const files = this.markdownFiles(this.settings.folders.seasons);
    const result: SeasonRecord[] = [];
    for (const file of files) {
      const fm = frontmatter(this.app, file);
      if (String(fm.type ?? "") !== SEASON_TYPE) continue;
      const content = await this.app.vault.cachedRead(file);
      result.push({ file, id: String(fm.season_id ?? fm.id ?? stableId("SEA", file.path)), name: String(fm.name ?? file.basename), status: ["active", "completed", "archived"].includes(String(fm.status)) ? String(fm.status) as SeasonRecord["status"] : "active", startDate: fm.start_date ? String(fm.start_date) : undefined, endDate: fm.end_date ? String(fm.end_date) : undefined, goals: Array.isArray(fm.goals) ? fm.goals as GoalDefinition[] : parseJsonBlock<GoalDefinition[]>(content, SEASON_GOALS_START, SEASON_GOALS_END, []), focuses: Array.isArray(fm.focuses) ? fm.focuses as FocusDefinition[] : parseJsonBlock<FocusDefinition[]>(content, SEASON_FOCUSES_START, SEASON_FOCUSES_END, []), scripture: list(fm.scripture) });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAreas(): Promise<AreaRecord[]> {
    const result: AreaRecord[] = [];
    for (const file of this.markdownFiles(this.settings.folders.areas)) {
      const fm = frontmatter(this.app, file);
      if (String(fm.type ?? "") !== AREA_TYPE) continue;
      result.push({ file, id: String(fm.area_id ?? stableId("ARE", file.path)), name: String(fm.name ?? file.basename), order: Number(fm.order) || 1, status: String(fm.status) === "archived" ? "archived" : "active", prompt: String(fm.prompt ?? ""), scripture: list(fm.scripture) });
    }
    return result.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  async getRecent(limit: number): Promise<DailyRecord[]> {
    const files = this.markdownFiles(this.settings.folders.daily).concat(this.markdownFiles(this.settings.legacySourceFolder));
    const records: DailyRecord[] = [];
    for (const file of [...new Set(files)]) {
      const fm = frontmatter(this.app, file); const date = String(fm.date ?? parseDateFromFilename(file.basename) ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const content = await this.app.vault.cachedRead(file); const marker = content.indexOf("\n---\n", 4); const body = marker >= 0 ? content.slice(marker + 5) : content;
      records.push({ file, id: String(fm.journal_id ?? fm.id ?? stableId("JRN", file.path)), date, seasonIds: list(fm.seasons), legacy: fm.type !== DAILY_TYPE, content, managedContent: body });
    }
    return records.sort((a, b) => b.date.localeCompare(a.date) || b.file.stat.mtime - a.file.stat.mtime).slice(0, limit);
  }

  async getGoalStats(seasonIds: string[], days: number): Promise<{ total: number; complete: number; streak: number; due: number }> {
    const seasons = (await this.getSeasons()).filter(season => seasonIds.length === 0 || seasonIds.includes(season.id));
    const records = await this.getRecent(Math.max(days, 1)); let total = 0; let complete = 0; let due = 0; let streak = 0;
    for (const record of records) {
      const dueGoals = seasons.flatMap(season => season.goals.filter(goal => goal.active).filter(goal => goal.recurrence === "daily" || goal.recurrence === "weekdays").map(goal => goal.id));
      const lines = record.managedContent.split("\n"); const ids = lines.filter(line => /- \[[ xX]\]/.test(line)).map(line => /journal-goal:([^\s>]+)/.exec(line)?.[1]).filter(Boolean) as string[];
      total += dueGoals.length; due += dueGoals.length; complete += lines.filter(line => /- \[[xX]\]/.test(line)).length;
      if (record.date === new Date().toISOString().slice(0, 10) && dueGoals.length && dueGoals.every(id => lines.some(line => line.includes(`journal-goal:${id}`) && /- \[[xX]\]/.test(line)))) streak = 1;
      void ids;
    }
    return { total, complete: Math.min(complete, total), streak, due };
  }

  getPrayerBridge(): PrayerLibraryBridge | null {
    if (!this.settings.prayer.enabled) return null;
    const plugin = (this.app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(this.settings.prayer.pluginId) as (Partial<PrayerLibraryBridge> & { getPrayers?: () => Array<{ id: string; title: string; text: string; category: string; scripture?: string[]; prayed?: string[]; file?: TFile }>; markPrayed?: (prayer: unknown, date: string) => Promise<void> }) | undefined;
    if (!plugin) return null;
    if (typeof plugin.getDailyPrayers === "function" && typeof plugin.markPrayed === "function" && typeof plugin.openPrayer === "function") return plugin as PrayerLibraryBridge;
    if (typeof plugin.getPrayers !== "function" || typeof plugin.markPrayed !== "function") return null;
    return {
      getDailyPrayers: async (date, categories) => plugin.getPrayers!().filter(prayer => !categories.length || categories.some(category => category.toLowerCase() === prayer.category.toLowerCase())).map(prayer => ({ id: prayer.id, title: prayer.title, text: prayer.text, category: prayer.category, scripture: prayer.scripture, prayed: prayer.prayed?.includes(date) ?? false })),
      markPrayed: async (prayerId, date) => { const prayer = plugin.getPrayers!().find(item => item.id === prayerId); if (prayer) await plugin.markPrayed!(prayer, date); },
      openPrayer: prayerId => { const prayer = plugin.getPrayers!().find(item => item.id === prayerId); if (prayer?.file) void this.app.workspace.getLeaf(true).openFile(prayer.file); },
    };
  }
}

export async function activeSeasons(repo: JournalRepository): Promise<SeasonRecord[]> { return activeSeasonsFor(await repo.getSeasons()); }

export function vaultFor(repo: JournalRepository): Vault { return (repo as unknown as { app: App }).app.vault; }
