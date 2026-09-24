import type { App, TFile, Vault } from "obsidian";
import { DAILY_TYPE, AREA_TYPE, SEASON_TYPE, type AreaRecord, type DailyRecord, type GoalDefinition, type JournalRepositoryLike, type JournalSettings, type PrayerLibraryBridge, type PrayerSummary, type SeasonRecord, type FocusDefinition } from "./types";
import { activeSeasonsFor, isDue, parseDateFromFilename, parseJsonBlock, stableId } from "./utils";
import { SEASON_FOCUSES_END, SEASON_FOCUSES_START, SEASON_GOALS_END, SEASON_GOALS_START } from "./types";

function list(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map(item => item.trim()).filter(Boolean) : typeof value === "string" ? value.split(",").map(item => item.trim()).filter(Boolean) : []; }
function frontmatter(app: App, file: TFile): Record<string, unknown> { return (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>; }
function dashboardExcluded(app: App, file: TFile): boolean { const value = frontmatter(app, file).dashboard_exclude; return value === true || String(value ?? "").toLowerCase() === "true"; }

export class JournalRepository implements JournalRepositoryLike {
  constructor(private app: App, private settings: JournalSettings) {}
  private markdownFiles(prefix?: string): TFile[] { return this.app.vault.getMarkdownFiles().filter(file => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`)); }

  async getDaily(date?: string): Promise<DailyRecord | null> {
    const target = date ?? new Date().toISOString().slice(0, 10);
    const files = this.markdownFiles(this.settings.folders.daily).concat(this.markdownFiles(this.settings.legacySourceFolder));
    for (const file of [...new Set(files)]) {
      if (dashboardExcluded(this.app, file)) continue;
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

  private async getAllDaily(): Promise<DailyRecord[]> {
    const files = this.markdownFiles(this.settings.folders.daily).concat(this.markdownFiles(this.settings.legacySourceFolder));
    const records: DailyRecord[] = [];
    for (const file of [...new Set(files)]) {
      if (dashboardExcluded(this.app, file)) continue;
      const fm = frontmatter(this.app, file); const date = String(fm.date ?? parseDateFromFilename(file.basename) ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const content = await this.app.vault.cachedRead(file); const marker = content.indexOf("\n---\n", 4); const body = marker >= 0 ? content.slice(marker + 5) : content;
      records.push({ file, id: String(fm.journal_id ?? fm.id ?? stableId("JRN", file.path)), date, seasonIds: list(fm.seasons), legacy: fm.type !== DAILY_TYPE, content, managedContent: body });
    }
    return records.sort((a, b) => b.date.localeCompare(a.date) || b.file.stat.mtime - a.file.stat.mtime);
  }

  async getRecent(limit: number): Promise<DailyRecord[]> {
    return (await this.getAllDaily()).slice(0, Math.max(limit, 0));
  }

  async getGoalStats(seasonIds: string[], days: number, seasonToDate = false): Promise<import("./types").GoalProgress> {
    const allSeasons = await this.getSeasons();
    const seasons = allSeasons.filter(season => seasonIds.length === 0 || seasonIds.includes(season.id));
    const records = await this.getAllDaily();
    const byDate = new Map(records.map(record => [record.date, record]));
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - Math.max(days, 1) + 1);
    const iso = (value: Date): string => value.toISOString().slice(0, 10);
    const dateValue = (value: string | undefined, fallback: string): string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value as string : fallback;
    const maxDate = (a: string, b: string): string => a > b ? a : b;
    const minDate = (a: string, b: string): string => a < b ? a : b;
    const selectedStarts = seasons.map(season => season.startDate).filter((value): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? ""));
    const globalFrom = seasonToDate && selectedStarts.length ? selectedStarts.sort()[0] : iso(rangeStart);
    const globalTo = seasons.length ? seasons.map(season => dateValue(season.endDate, todayIso)).sort()[seasons.length - 1] > todayIso ? todayIso : minDate(todayIso, seasons.map(season => dateValue(season.endDate, todayIso)).sort()[seasons.length - 1]) : todayIso;
    const isChecked = (record: DailyRecord | undefined, goalId: string): boolean => !!record?.managedContent.split("\n").some(line => line.includes(`journal-goal:${goalId}`) && /- \[[xX]\]/.test(line));
    const daysBetween = (from: string, to: string): number => {
      const start = new Date(`${from}T12:00:00`); const end = new Date(`${to}T12:00:00`);
      return start > end ? 0 : Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    };
    let total = 0; let complete = 0; let activeGoals = 0;
    const seasonStats: import("./types").GoalProgressSeason[] = [];
    for (const season of seasons) {
      const from = maxDate(globalFrom, dateValue(season.startDate, globalFrom));
      const to = minDate(globalTo, dateValue(season.endDate, globalTo));
      const goals = season.goals.filter(goal => goal.active);
      let seasonTotal = 0; let seasonComplete = 0;
      activeGoals += goals.length;
      for (let cursor = new Date(`${from}T12:00:00`); iso(cursor) <= to; cursor.setDate(cursor.getDate() + 1)) {
        const date = iso(cursor); const record = byDate.get(date);
        for (const goal of goals) {
          if (!isDue(goal, date)) continue;
          seasonTotal += 1;
          if (isChecked(record, goal.id)) seasonComplete += 1;
        }
      }
      total += seasonTotal; complete += seasonComplete;
      seasonStats.push({ id: season.id, name: season.name, total: seasonTotal, complete: seasonComplete, due: Math.max(0, seasonTotal - seasonComplete), percent: seasonTotal ? Math.round(seasonComplete / seasonTotal * 100) : 0, activeGoals: goals.length, fromDate: from, toDate: to });
    }
    let streak = 0;
    if (seasons.length) {
      for (let cursor = new Date(`${todayIso}T12:00:00`); iso(cursor) >= globalFrom; cursor.setDate(cursor.getDate() - 1)) {
        const date = iso(cursor); const dueGoals = seasons.flatMap(season => season.goals.filter(goal => isDue(goal, date)));
        if (!dueGoals.length) continue;
        if (!dueGoals.every(goal => isChecked(byDate.get(date), goal.id))) break;
        streak += 1;
      }
    }
    return { total, complete, streak, due: Math.max(0, total - complete), percent: total ? Math.round(complete / total * 100) : 0, activeGoals, elapsedDays: daysBetween(globalFrom, globalTo), fromDate: seasons.length ? globalFrom : undefined, toDate: seasons.length ? globalTo : undefined, seasons: seasonStats };
  }

  getPrayerBridge(): PrayerLibraryBridge | null {
    if (!this.settings.prayer.enabled) return null;
    const plugin = (this.app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(this.settings.prayer.pluginId) as (Partial<PrayerLibraryBridge> & { getPrayers?: () => Array<{ id: string; title: string; text: string; category: string; scripture?: string[]; prayed?: string[]; file?: TFile }>; markPrayed?: (prayer: unknown, date: string) => Promise<void>; markPrayedById?: (prayerId: string, date: string) => Promise<void> }) | undefined;
    if (!plugin || typeof plugin.getDailyPrayers !== "function" || typeof plugin.markPrayed !== "function" || typeof plugin.openPrayer !== "function") return null;
    return {
      getDailyPrayers: async (date, categories) => (await plugin.getDailyPrayers!(date, categories)).map(item => ({ ...item, path: item.path })),
      markPrayed: async (prayerId, date) => { if (plugin.markPrayedById) { await plugin.markPrayedById(prayerId, date); return; } const prayer = plugin.getPrayers?.().find(item => item.id === prayerId); if (prayer) await plugin.markPrayed!(prayer, date); },
      openPrayer: prayerId => plugin.openPrayer!(prayerId),
    };
  }

  async getDailyPrayers(date = new Date().toISOString().slice(0, 10)): Promise<PrayerSummary[]> {
    const bridge = this.getPrayerBridge();
    if (!bridge) return [];
    try { return await bridge.getDailyPrayers(date, []); } catch { return []; }
  }

  async markPrayerPrayed(prayerId: string, date = new Date().toISOString().slice(0, 10)): Promise<void> {
    const bridge = this.getPrayerBridge();
    if (bridge) await bridge.markPrayed(prayerId, date);
  }
}

export async function activeSeasons(repo: JournalRepository): Promise<SeasonRecord[]> { return activeSeasonsFor(await repo.getSeasons()); }

export function vaultFor(repo: JournalRepository): Vault { return (repo as unknown as { app: App }).app.vault; }
