import { Notice, Plugin, TFile } from "obsidian";
import { registerDashboardModule } from "./dashboard-bridge";
import { JournalDashboardView } from "./dashboard";
import { JournalMigration } from "./migration";
import { AreaManagerModal, ConfirmModal, MigrationPreviewModal, SeasonModal } from "./modals";
import { JournalRepository } from "./repository";
import { JournalSettingsTab } from "./settings";
import { PLUGIN_ID, VIEW_ID, type JournalSettings, type JournalWidgetDefinition, type SeasonRecord } from "./types";
import { activeSeasonsFor, defaultSettings, ensureFolders, frontmatterForDaily, normalizeSettings, parseDateFromFilename, renderDailyManagedBlock, safeDailyPath, stableId, today } from "./utils";
import { safeFilename } from "./foundation-vendor";

export default class JournalCompanion extends Plugin {
  settings: JournalSettings = defaultSettings();
  repository!: JournalRepository;
  selectedSeasonIds: string[] = [];
  private migration!: JournalMigration;
  private refreshTimer?: number;
  private dailyCreation?: Promise<void>;

  async onload(): Promise<void> {
    this.settings = { ...defaultSettings(), ...(await this.loadData() ?? {}) } as JournalSettings;
    this.settings = normalizeSettings(this.settings);
    this.repository = new JournalRepository(this.app, this.settings);
    this.migration = new JournalMigration(this.app, this.settings, () => this.refresh());
    this.registerView(VIEW_ID, leaf => new JournalDashboardView(leaf, this));
    this.addSettingTab(new JournalSettingsTab(this.app, this));
    this.addRibbonIcon("book-open", "Open Journal Companion", () => void this.openDashboard());
    const commands: [string, string, () => void | Promise<void>][] = [
      ["open-dashboard", "Open Journal Companion dashboard", () => this.openDashboard()],
      ["open-today", "Open today's journal note", () => this.openToday(false)],
      ["new-today", "New Journal Entry", () => this.openToday(true)],
      ["new-season", "Add or edit season", () => this.newSeason()],
      ["manage-goals", "Manage goals", () => this.newSeason()],
      ["manage-focuses", "Manage focuses", () => this.newSeason()],
      ["manage-areas", "Manage journal areas", () => this.manageAreas()],
      ["open-weekly-review", "Open weekly review", () => this.openReview("weekly")],
      ["open-monthly-review", "Open monthly review", () => this.openReview("monthly")],
      ["open-quarterly-review", "Open quarterly review", () => this.openReview("quarterly")],
      ["refresh", "Refresh journal summaries", () => this.refresh()],
      ["preview-migration", "Preview legacy journal migration", () => this.previewMigration()],
      ["run-migration", "Run legacy journal migration", () => this.confirmMigration()],
      ["verify-migration", "Verify journal migration", () => this.verifyMigration()],
      ["restore-migration", "Restore latest journal migration backup", () => this.confirmRestore()],
      ["open-settings", "Open Journal Companion settings", () => this.openSettings()],
    ];
    commands.forEach(([id, name, callback]) => this.addCommand({ id, name, callback }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file instanceof TFile && this.isDailyFile(file)) void this.syncCheckedPrayers(file);
    }));
    this.registerDashboardWidget();
    if (this.settings.dashboard.autoRefreshSeconds > 0) this.refreshTimer = window.setInterval(() => void this.refresh(), this.settings.dashboard.autoRefreshSeconds * 1000);
    if (this.settings.createOnStartup && this.settings.setupComplete) void this.openToday(true);
    if (this.settings.dashboard.startup) void this.openDashboard();
  }

  async onunload(): Promise<void> { if (this.refreshTimer) window.clearInterval(this.refreshTimer); this.app.workspace.detachLeavesOfType(VIEW_ID); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); await this.refresh(); }

  async openDashboard(): Promise<void> { const leaf = this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_ID, active: true }); this.app.workspace.revealLeaf(leaf); }
  openNote(path: string): void { void this.app.workspace.openLinkText(path, "", true); }
  openSettings(): void { const setting = (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting; setting.open(); setting.openTabById(PLUGIN_ID); }
  newSeason(existing?: SeasonRecord): void { new SeasonModal(this.app, this, existing).open(); }
  manageAreas(): void { new AreaManagerModal(this.app, this).open(); }

  async openToday(create: boolean): Promise<void> {
    if (!this.settings.setupComplete) { new Notice("Choose and confirm a daily filename format in Journal Companion settings first."); this.openSettings(); return; }
    const date = today(); const existing = await this.repository.getDaily(date);
    if (existing) { if (this.repository.getPrayerBridge()) await this.refreshDailyFile(existing.file, date); this.openNote(existing.file.path); return; }
    if (!create) { new Notice("Today's journal note does not exist yet. Use New Journal Entry to create it."); return; }
    // Keep creation serialized so two taps (or a dashboard plus the widget) cannot race into two notes for one date.
    if (this.dailyCreation) return this.dailyCreation;
    this.dailyCreation = this.createTodayIfMissing(date).finally(() => { this.dailyCreation = undefined; });
    return this.dailyCreation;
  }

  private async createTodayIfMissing(date: string): Promise<void> {
    const existing = await this.repository.getDaily(date);
    if (existing) { this.openNote(existing.file.path); return; }
    await ensureFolders(this.app.vault, [this.settings.folders.daily]);
    const seasons = activeSeasonsFor(await this.repository.getSeasons(), date); const areas = await this.repository.getAreas(); const prayers = this.repository.getPrayerBridge() ? await this.repository.getDailyPrayers(date) : undefined;
    const path = safeDailyPath(this.settings, date); const id = stableId(this.settings.naming.idPrefix || "JRN", `${date}:${Date.now()}`);
    const atPath = this.app.vault.getAbstractFileByPath(path);
    if (atPath instanceof TFile) { this.openNote(atPath.path); return; }
    const body = `# ${date}\n\n${renderDailyManagedBlock(seasons, areas, date, "", prayers)}\n\n## Personal writing\n\n`;
    const file = await this.app.vault.create(path, `${frontmatterForDaily(id, date, this.settings, seasons.map(s => s.id))}${body}`); this.openNote(file.path); await this.refresh();
  }

  async refresh(): Promise<void> { this.repository = new JournalRepository(this.app, this.settings); for (const leaf of this.app.workspace.getLeavesOfType(VIEW_ID)) { const view = leaf.view as JournalDashboardView; await view.render(); } }
  async markPrayerPrayed(prayerId: string, date = today()): Promise<void> {
    await this.repository.markPrayerPrayed(prayerId, date);
    const daily = await this.repository.getDaily(date);
    if (!daily) return;
    await this.app.vault.process(daily.file, content => content.split("\n").map(line => line.includes(`journal-prayer:${prayerId}`) ? line.replace("- [ ]", "- [x]") : line).join("\n"));
  }
  private isDailyFile(file: TFile): boolean { return file.path.startsWith(`${this.settings.folders.daily}/`); }
  private async refreshDailyFile(file: TFile, date: string): Promise<void> {
    const seasons = activeSeasonsFor(await this.repository.getSeasons(), date); const areas = await this.repository.getAreas(); const prayers = this.repository.getPrayerBridge() ? await this.repository.getDailyPrayers(date) : undefined;
    await this.app.vault.process(file, current => {
      const marker = current.indexOf("\n---\n", 4); const head = marker >= 0 ? current.slice(0, marker + 5) : ""; const body = marker >= 0 ? current.slice(marker + 5) : current;
      const nextBody = renderDailyManagedBlock(seasons, areas, date, body, prayers);
      return nextBody === body ? current : `${head}${nextBody}${nextBody.endsWith("\n") ? "" : "\n"}`;
    });
  }
  private async syncCheckedPrayers(file: TFile): Promise<void> {
    const bridge = this.repository.getPrayerBridge(); if (!bridge) return;
    const content = await this.app.vault.cachedRead(file);
    const cachedDate = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.date ?? "");
    const embeddedDate = /^date:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(content)?.[1] ?? "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(cachedDate) ? cachedDate : embeddedDate || parseDateFromFilename(file.basename) || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const ids = [...content.matchAll(/- \[[xX]\][^\n]*journal-prayer:([^\s]+)\s*-->/g)].map(match => match[1]);
    for (const id of [...new Set(ids)]) { try { await bridge.markPrayed(id, date); } catch { /* prayer records may be unavailable during plugin reload */ } }
  }
  async openReview(cadence: "weekly" | "monthly" | "quarterly"): Promise<void> { await ensureFolders(this.app.vault, [this.settings.folders.reviews]); const date = today(); const path = `${this.settings.folders.reviews}/${safeFilename(`${cadence}-${date}`)}.md`; const existing = this.app.vault.getAbstractFileByPath(path); if (existing instanceof TFile) { this.openNote(path); return; } const title = `${cadence[0].toUpperCase()}${cadence.slice(1)} review — ${date}`; const file = await this.app.vault.create(path, `---\ntype: journal-companion-review\ncadence: ${cadence}\ndate: ${date}\ncreated: ${new Date().toISOString()}\nupdated: ${new Date().toISOString()}\n---\n\n# ${title}\n\n## Wins\n\n- \n\n## What needs attention\n\n- \n\n## Next steps\n\n- \n`); this.openNote(file.path); }

  async previewMigration(): Promise<void> { const report = await this.migration.preview(); if (report.items.length) new MigrationPreviewModal(this.app, report).open(); else new Notice("No legacy journal notes found."); }
  confirmMigration(): void { new ConfirmModal(this.app, "Back up recognized legacy journal notes and add Journal Companion metadata?", async () => { await this.migration.migrate(); }).open(); }
  async verifyMigration(): Promise<void> { await this.migration.verify(); }
  confirmRestore(): void { new ConfirmModal(this.app, "Restore the latest journal migration backup over current notes?", () => this.migration.restoreLatest()).open(); }

  private registerDashboardWidget(): void {
    const dashboard = (this.app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("red-beard-dashboard") as { registerWidget?: (definition: JournalWidgetDefinition) => () => void } | undefined;
    if (!dashboard?.registerWidget) return;
    dashboard.registerWidget({ id: "journal-companion/today", name: "Journal Companion", description: "Today’s journal status and current focuses.", icon: "book-open", defaultLayout: { w: 4, mobileW: 12, h: 3, order: 20 }, mobile: "responsive", render: async (_ctx, container) => { const daily = await this.repository.getDaily(today()); container.createEl("strong", { text: daily ? "Today’s journal entry" : "Today’s journal is not created" }); container.createEl("p", { text: daily ? daily.date : "Create one entry for today; weekly and other reviews remain separate." }); const button = container.createEl("button", { text: daily ? "Open today’s journal" : "Create today’s journal" }); button.onclick = () => void this.openToday(true); } });
  }
}
// Red-Beard Dashboard integration: launcher module and independent summary widget.
const rbDisposals = new WeakMap<object, () => void>();
const rbOnload = JournalCompanion.prototype.onload;
JournalCompanion.prototype.onload = async function(this: JournalCompanion) {
  await rbOnload.call(this);
  const disposals = [registerDashboardModule(this.app, { id: "journal-companion", name: "Journal Companion", command: "journal-companion:open-dashboard", icon: "book-open", description: "Today’s journal status and current focuses.", order: 20 })];
  rbDisposals.set(this, () => disposals.forEach(dispose => dispose()));
};
const rbOnunload = JournalCompanion.prototype.onunload;
JournalCompanion.prototype.onunload = async function(this: JournalCompanion) {
  rbDisposals.get(this)?.();
 if (rbOnunload) await rbOnunload.call(this);
};
