import { App, Notice, TFile, TFolder } from "obsidian";
import { ensureVaultFolders } from "./foundation-vendor";
import { DAILY_TYPE, type JournalSettings } from "./types";
import { parseDateFromFilename, renderDailyManagedBlock, stableId, today } from "./utils";

export interface MigrationItem { path: string; date: string; needsMetadata: boolean; hasManagedBlock: boolean; }
export interface MigrationReport { source: string; items: MigrationItem[]; migrated: number; failed: string[]; backupPath?: string; journalPath?: string; }

function isLegacy(app: App, file: TFile, source: string): boolean {
  if (!file.path.startsWith(`${source}/`) && file.path !== source) return false;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  return String(fm.type ?? "") !== DAILY_TYPE || !fm.journal_id;
}

export class JournalMigration {
  constructor(private app: App, private settings: JournalSettings, private refresh: () => Promise<void>) {}

  async preview(): Promise<MigrationReport> {
    const files = this.app.vault.getMarkdownFiles().filter(file => isLegacy(this.app, file, this.settings.legacySourceFolder));
    const items: MigrationItem[] = [];
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const date = String(fm.date ?? parseDateFromFilename(file.basename) ?? "");
      items.push({ path: file.path, date, needsMetadata: String(fm.type ?? "") !== DAILY_TYPE || !fm.journal_id, hasManagedBlock: content.includes("<!-- journal-companion:daily-managed-start -->") });
    }
    return { source: this.settings.legacySourceFolder, items, migrated: 0, failed: [] };
  }

  async migrate(): Promise<MigrationReport> {
    const preview = await this.preview();
    if (!preview.items.length) { new Notice("No legacy journal notes need migration."); return preview; }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.settings.rootFolder}/Backups/Migration-${stamp}`;
    await ensureVaultFolders(this.app.vault, [backupPath, this.settings.folders.daily]);
    for (const item of preview.items) {
      const file = this.app.vault.getAbstractFileByPath(item.path);
      if (!(file instanceof TFile)) continue;
      try {
        const original = await this.app.vault.read(file);
        const backupFile = `${backupPath}/${item.path.replace(/\//g, "__")}`;
        const backup = await this.app.vault.create(backupFile, original);
        if (await this.app.vault.read(backup) !== original) throw new Error("Backup verification failed; source was not changed.");
        await this.app.fileManager.processFrontMatter(file, fm => {
          const date = String(fm.date ?? parseDateFromFilename(file.basename) ?? today());
          fm.type = DAILY_TYPE; fm.schema_version = 1; fm.journal_id = String(fm.journal_id ?? stableId("JRN", file.path)); fm.date = date;
          fm.seasons = Array.isArray(fm.seasons) ? fm.seasons : []; fm.created = fm.created ?? new Date(file.stat.ctime).toISOString(); fm.updated = new Date().toISOString();
          const tags: string[] = Array.isArray(fm.tags) ? fm.tags.map(String) : typeof fm.tags === "string" ? [fm.tags] : []; fm.tags = [...new Set([...tags.map((tag: string) => tag.replace(/^#/, "")), "journal"])];
        });
        await this.app.vault.process(file, current => {
          const marker = current.indexOf("\n---\n", 4);
          const head = marker >= 0 ? current.slice(0, marker + 5) : "";
          const body = marker >= 0 ? current.slice(marker + 5) : current;
          const date = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.date ?? item.date ?? today());
          const managed = renderDailyManagedBlock([], [], date, body);
          return `${head}${managed}${managed.endsWith("\n") ? "" : "\n"}`;
        });
        preview.migrated++;
      } catch (error) { preview.failed.push(`${item.path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    preview.backupPath = backupPath;
    const journalPath = `${this.settings.rootFolder}/${this.settings.files.journal}`;
    await ensureVaultFolders(this.app.vault, [this.settings.rootFolder]);
    const journal = `---\ntype: journal-companion-migration\ncreated: ${new Date().toISOString()}\nbackup: ${backupPath}\n---\n\n# Migration ${stamp}\n\n- Migrated: ${preview.migrated}\n- Failed: ${preview.failed.length}\n\n${preview.failed.map(item => `- ${item}`).join("\n")}`;
    const existingJournal = this.app.vault.getAbstractFileByPath(journalPath);
    if (existingJournal instanceof TFile) await this.app.vault.process(existingJournal, () => journal); else await this.app.vault.create(journalPath, journal);
    preview.journalPath = journalPath;
    new Notice(`Journal migration complete: ${preview.migrated} migrated, ${preview.failed.length} failed.`);
    await this.refresh();
    return preview;
  }

  async verify(): Promise<{ total: number; valid: number; missing: string[] }> {
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${this.settings.legacySourceFolder}/`) || file.path.startsWith(`${this.settings.folders.daily}/`));
    const missing: string[] = [];
    for (const file of files) { const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}; if (String(fm.type ?? "") !== DAILY_TYPE || !fm.journal_id) missing.push(file.path); }
    const result = { total: files.length, valid: files.length - missing.length, missing }; new Notice(`Journal verification: ${result.valid}/${result.total} valid.`); return result;
  }

  async restoreLatest(): Promise<void> {
    const backups = this.app.vault.getAbstractFileByPath(`${this.settings.rootFolder}/Backups`);
    if (!(backups instanceof TFolder)) { new Notice("No migration backups found."); return; }
    const folder = backups.children.filter(child => child instanceof TFolder).sort((a, b) => b.name.localeCompare(a.name))[0];
    if (!(folder instanceof TFolder)) { new Notice("No migration backups found."); return; }
    let restored = 0;
    for (const child of folder.children) { if (!(child instanceof TFile)) continue; const path = child.name.replace(/__/g, "/"); const original = await this.app.vault.read(child); const target = this.app.vault.getAbstractFileByPath(path); if (target instanceof TFile) await this.app.vault.process(target, () => original); else await this.app.vault.create(path, original); restored++; }
    new Notice(`Restored ${restored} journal notes from ${folder.name}.`); await this.refresh();
  }
}
