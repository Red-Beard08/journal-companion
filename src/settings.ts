import { App, PluginSettingTab, Setting } from "obsidian";
import type JournalCompanion from "./main";
import { normalizeSettings } from "./utils";

export class JournalSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: JournalCompanion) { super(app, plugin); }
  display(): void {
    const el = this.containerEl; el.empty(); el.createEl("h2", { text: "Journal Companion" });
    new Setting(el).setName("Storage").setHeading();
    this.text(el, "Root folder", "Vault-relative root for new journal records.", "rootFolder");
    this.text(el, "Daily-note folder", "Folder for new daily notes.", "daily");
    this.text(el, "Seasons folder", "Folder for season definition notes.", "seasons");
    this.text(el, "Areas folder", "Folder for user-defined area notes.", "areas");
    this.text(el, "Reviews folder", "Folder for generated review notes.", "reviews");
    this.text(el, "Dashboard path", "Vault-relative path for the Journal Companion dashboard note.", "dashboardPath");
    this.text(el, "Legacy source folder", "Existing daily notes are read here during compatibility and migration.", "legacySourceFolder");
    new Setting(el).setName("Index filename").addText(text => text.setValue(this.plugin.settings.files.index).onChange(async value => { this.plugin.settings.files.index = value.trim() || "Journal Companion Index.md"; await this.plugin.saveSettings(); }));

    new Setting(el).setName("Naming").setHeading();
    new Setting(el).setName("Daily filename format").setDesc("Required before creating notes. Tokens: YYYY, MMM, MM, DD, ddd. Suggested existing format: YYYY-MMM-DD-ddd.").addText(text => text.setValue(this.plugin.settings.dailyFormat).onChange(async value => { this.plugin.settings.dailyFormat = value.trim() || "YYYY-MMM-DD-ddd"; await this.plugin.saveSettings(); }));
    new Setting(el).setName("ID prefix").addText(text => text.setValue(this.plugin.settings.naming.idPrefix).onChange(async value => { this.plugin.settings.naming.idPrefix = value.trim().replace(/[^A-Za-z0-9_-]/g, "-") || "JRN"; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Setup complete").setDesc("Enable this after reviewing the daily filename format.").addToggle(toggle => toggle.setValue(this.plugin.settings.setupComplete).onChange(async value => { this.plugin.settings.setupComplete = value; await this.plugin.saveSettings(); }));

    new Setting(el).setName("Taxonomy").setHeading();
    new Setting(el).setName("Manage journal areas").setDesc("Create, archive, and review fully user-defined prompts.").addButton(button => button.setButtonText("Manage areas").onClick(() => this.plugin.manageAreas()));
    new Setting(el).setName("Optional starter areas").setDesc("Creates a small starter set only when explicitly enabled.").addToggle(toggle => toggle.setValue(this.plugin.settings.starterAreasEnabled).onChange(async value => { this.plugin.settings.starterAreasEnabled = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Review cadences").setDesc("Generated review notes can be daily, weekly, monthly, or quarterly.").addText(text => text.setValue(this.plugin.settings.reviewCadences.join(", ")).onChange(async value => { this.plugin.settings.reviewCadences = value.split(",").map(item => item.trim()).filter((item): item is typeof this.plugin.settings.reviewCadences[number] => ["daily", "weekly", "monthly", "quarterly"].includes(item)); await this.plugin.saveSettings(); }));

    new Setting(el).setName("Defaults").setHeading();
    new Setting(el).setName("Default goal recurrence").addDropdown(dropdown => dropdown.addOptions({ daily: "Daily", weekdays: "Selected weekdays", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" }).setValue(String(this.plugin.settings.defaults.goalRecurrence ?? "daily")).onChange(async value => { this.plugin.settings.defaults.goalRecurrence = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Default report range").addDropdown(dropdown => dropdown.addOptions({ "7": "7 days", "30": "30 days", "90": "90 days", season: "Current season", all: "All history" }).setValue(this.plugin.settings.reportRange).onChange(async value => { this.plugin.settings.reportRange = value as JournalCompanion["settings"]["reportRange"]; await this.plugin.saveSettings(); }));

    new Setting(el).setName("Dashboard / UI").setHeading();
    new Setting(el).setName("Open dashboard on startup").addToggle(toggle => toggle.setValue(this.plugin.settings.dashboard.startup).onChange(async value => { this.plugin.settings.dashboard.startup = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Automatic refresh (seconds)").setDesc("0 disables the timer.").addText(text => text.setValue(String(this.plugin.settings.dashboard.autoRefreshSeconds)).onChange(async value => { this.plugin.settings.dashboard.autoRefreshSeconds = Math.max(0, Number(value) || 0); await this.plugin.saveSettings(); }));
    new Setting(el).setName("Show empty sections").addToggle(toggle => toggle.setValue(this.plugin.settings.dashboard.compact === false).onChange(async value => { this.plugin.settings.dashboard.compact = !value; await this.plugin.saveSettings(); }));

    new Setting(el).setName("Prayer Library integration").setHeading();
    new Setting(el).setName("Enable prayer widget").addToggle(toggle => toggle.setValue(this.plugin.settings.prayer.enabled).onChange(async value => { this.plugin.settings.prayer.enabled = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Prayer Library plugin ID").addText(text => text.setValue(this.plugin.settings.prayer.pluginId).onChange(async value => { this.plugin.settings.prayer.pluginId = value.trim() || "prayer-library"; await this.plugin.saveSettings(); }));
    new Setting(el).setName("Daily prayer selection").setDesc("Prayer Library controls categories, schedules, rotation counts, and the final list. Journal Companion mirrors that list exactly for today’s journal and dashboard.");
    new Setting(el).setName("Show Scripture references").addToggle(toggle => toggle.setValue(this.plugin.settings.prayer.showScripture).onChange(async value => { this.plugin.settings.prayer.showScripture = value; await this.plugin.saveSettings(); }));

    new Setting(el).setName("Automation").setHeading();
    new Setting(el).setName("Create daily note on startup").setDesc("Off by default; explicit Open/Create Today remains available.").addToggle(toggle => toggle.setValue(this.plugin.settings.createOnStartup).onChange(async value => { this.plugin.settings.createOnStartup = value; await this.plugin.saveSettings(); }));

    new Setting(el).setName("Migration").setHeading();
    new Setting(el).addButton(button => button.setButtonText("Preview legacy migration").onClick(() => void this.plugin.previewMigration()));
    new Setting(el).addButton(button => button.setButtonText("Run migration").setWarning().onClick(() => void this.plugin.confirmMigration()));
    new Setting(el).addButton(button => button.setButtonText("Verify migration").onClick(() => void this.plugin.verifyMigration()));
    new Setting(el).addButton(button => button.setButtonText("Restore latest migration backup").setWarning().onClick(() => void this.plugin.confirmRestore()));

    new Setting(el).setName("Privacy").setHeading();
    new Setting(el).setName("Privacy reminder").setDesc("Records are ordinary Markdown files; this plugin does not encrypt them.").addToggle(toggle => toggle.setValue(this.plugin.settings.privacy.showReminder).onChange(async value => { this.plugin.settings.privacy.showReminder = value; await this.plugin.saveSettings(); }));
  }

  private text(container: HTMLElement, name: string, desc: string, key: "rootFolder" | "daily" | "seasons" | "areas" | "reviews" | "dashboardPath" | "legacySourceFolder"): void {
    new Setting(container).setName(name).setDesc(desc).addText(text => text.setValue(key === "rootFolder" ? this.plugin.settings.rootFolder : key === "dashboardPath" ? this.plugin.settings.dashboardPath : key === "legacySourceFolder" ? this.plugin.settings.legacySourceFolder : this.plugin.settings.folders[key]).onChange(async value => {
      if (key === "rootFolder") this.plugin.settings.rootFolder = normalizeSettings({ ...this.plugin.settings, rootFolder: value }).rootFolder;
      else if (key === "dashboardPath") this.plugin.settings.dashboardPath = normalizeSettings({ ...this.plugin.settings, dashboardPath: value }).dashboardPath;
      else if (key === "legacySourceFolder") this.plugin.settings.legacySourceFolder = normalizeSettings({ ...this.plugin.settings, legacySourceFolder: value }).legacySourceFolder;
      else this.plugin.settings.folders[key] = normalizeSettings({ ...this.plugin.settings, folders: { ...this.plugin.settings.folders, [key]: value } }).folders[key];
      await this.plugin.saveSettings();
    }));
  }
}
