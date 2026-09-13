import { App, Modal, Notice, Setting } from "obsidian";
import { prepareMobileModal, replaceManagedBlock } from "./foundation-vendor";
import { SEASON_FOCUSES_END, SEASON_FOCUSES_START, SEASON_GOALS_END, SEASON_GOALS_START, type FocusDefinition, type GoalDefinition, type SeasonRecord } from "./types";
import { ensureFolders, frontmatterForArea, frontmatterForSeason, stableId, today } from "./utils";
import { safeFilename } from "./foundation-vendor";
import type JournalCompanion from "./main";

function textValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string { return input.value.trim(); }
function splitLines(value: string): string[] { return value.split("\n").map(line => line.trim()).filter(Boolean); }

export class ConfirmModal extends Modal {
  constructor(app: App, private message: string, private confirm: () => Promise<void> | void) { super(app); }
  onOpen(): void {
    prepareMobileModal(this);
    this.contentEl.createEl("h2", { text: "Please confirm" });
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl).addButton(button => button.setButtonText("Confirm").setCta().onClick(async () => { await this.confirm(); this.close(); })).addButton(button => button.setButtonText("Cancel").onClick(() => this.close()));
  }
}

export class SeasonModal extends Modal {
  private nameInput!: HTMLInputElement;
  private startInput!: HTMLInputElement;
  private endInput!: HTMLInputElement;
  private statusInput!: HTMLSelectElement;
  private goalsInput!: HTMLTextAreaElement;
  private focusesInput!: HTMLTextAreaElement;
  private scriptureInput!: HTMLTextAreaElement;
  constructor(app: App, private plugin: JournalCompanion, private existing?: SeasonRecord) { super(app); }
  onOpen(): void {
    prepareMobileModal(this, "journal-companion-modal");
    this.contentEl.createEl("h2", { text: this.existing ? "Edit season" : "New season" });
    new Setting(this.contentEl).setName("Season name").addText(text => { this.nameInput = text.inputEl; text.setValue(this.existing?.name ?? ""); });
    new Setting(this.contentEl).setName("Start date").addText(text => { this.startInput = text.inputEl; this.startInput.type = "date"; text.setValue(this.existing?.startDate ?? today()); });
    new Setting(this.contentEl).setName("End date (optional)").addText(text => { this.endInput = text.inputEl; this.endInput.type = "date"; text.setValue(this.existing?.endDate ?? ""); });
    new Setting(this.contentEl).setName("Status").addDropdown(dropdown => { this.statusInput = dropdown.selectEl; dropdown.addOptions({ active: "Active", completed: "Completed", archived: "Archived" }); dropdown.setValue(this.existing?.status ?? "active"); });
    new Setting(this.contentEl).setName("Goals").setDesc("One per line. Add `| daily`, `| weekly`, `| monthly`, `| quarterly`, or `| weekdays` after a goal when needed.").addTextArea(area => { this.goalsInput = area.inputEl; area.inputEl.rows = 6; area.setValue((this.existing?.goals ?? []).map(goal => `${goal.title} | ${goal.recurrence}`).join("\n")); });
    new Setting(this.contentEl).setName("Focuses").setDesc("One reminder per line.").addTextArea(area => { this.focusesInput = area.inputEl; area.inputEl.rows = 5; area.setValue((this.existing?.focuses ?? []).map(focus => focus.text).join("\n")); });
    new Setting(this.contentEl).setName("Scripture references").addTextArea(area => { this.scriptureInput = area.inputEl; area.inputEl.rows = 3; area.setValue((this.existing?.scripture ?? []).join(", ")); });
    new Setting(this.contentEl).addButton(button => button.setButtonText("Save season").setCta().onClick(() => void this.save())).addButton(button => button.setButtonText("Cancel").onClick(() => this.close()));
  }
  private async save(): Promise<void> {
    const name = textValue(this.nameInput);
    if (!name) { new Notice("Season name is required."); return; }
    const parseGoals = (): GoalDefinition[] => splitLines(this.goalsInput.value).map((line, index) => { const [title, rawRecurrence] = line.split("|").map(item => item.trim()); const recurrence = ["daily", "weekly", "monthly", "quarterly", "weekdays"].includes(rawRecurrence) ? rawRecurrence as GoalDefinition["recurrence"] : "daily"; return { id: this.existing?.goals[index]?.id ?? stableId("GL", `${name}:${title}`), title, recurrence, active: true }; });
    const goals = parseGoals();
    const focuses: FocusDefinition[] = splitLines(this.focusesInput.value).map((text, index) => ({ id: this.existing?.focuses[index]?.id ?? stableId("FOC", `${name}:${text}`), text, order: index, active: true }));
    const scripture = this.scriptureInput.value.split(",").map(item => item.trim()).filter(Boolean);
    if (this.existing) {
      await this.plugin.app.fileManager.processFrontMatter(this.existing.file, frontmatter => { frontmatter.name = name; frontmatter.status = this.statusInput.value; frontmatter.start_date = this.startInput.value || undefined; frontmatter.end_date = this.endInput.value || undefined; frontmatter.goals = goals; frontmatter.focuses = focuses; frontmatter.scripture = scripture; frontmatter.updated = new Date().toISOString(); });
      await this.plugin.app.vault.process(this.existing.file, current => replaceManagedBlock(replaceManagedBlock(current, { start: SEASON_GOALS_START, end: SEASON_GOALS_END }, JSON.stringify(goals, null, 2)), { start: SEASON_FOCUSES_START, end: SEASON_FOCUSES_END }, JSON.stringify(focuses, null, 2)));
    } else {
      await ensureFolders(this.plugin.app.vault, [this.plugin.settings.folders.seasons]);
      const id = stableId("SEA", `${name}:${Date.now()}`); const path = `${this.plugin.settings.folders.seasons}/${safeFilename(name)}.md`;
      const body = `\n# ${name}\n\n${SEASON_GOALS_START}\n${JSON.stringify(goals, null, 2)}\n${SEASON_GOALS_END}\n\n${SEASON_FOCUSES_START}\n${JSON.stringify(focuses, null, 2)}\n${SEASON_FOCUSES_END}\n`;
      await this.plugin.app.vault.create(path, `${frontmatterForSeason(id, name).replace("goals: []", `goals: ${JSON.stringify(goals)}`).replace("focuses: []", `focuses: ${JSON.stringify(focuses)}`).replace("scripture: []", `scripture: ${JSON.stringify(scripture)}`)}${body}`);
    }
    new Notice("Season saved."); this.close(); await this.plugin.refresh();
  }
}

export class AreaManagerModal extends Modal {
  constructor(app: App, private plugin: JournalCompanion) { super(app); }
  onOpen(): void { this.render(); }
  private render(): void {
    prepareMobileModal(this, "journal-companion-modal"); this.contentEl.empty(); this.contentEl.createEl("h2", { text: "Manage journal areas" });
    void this.plugin.repository.getAreas().then(areas => { areas.forEach(area => { const row = new Setting(this.contentEl).setName(area.name).setDesc(area.prompt || "No prompt"); row.addButton(button => button.setButtonText(area.status === "archived" ? "Reactivate" : "Archive").onClick(async () => { await this.plugin.app.fileManager.processFrontMatter(area.file, fm => { fm.status = area.status === "archived" ? "active" : "archived"; fm.updated = new Date().toISOString(); }); this.render(); })); }); });
    let name = ""; let prompt = ""; const setting = new Setting(this.contentEl).setName("New area"); setting.addText(text => text.setPlaceholder("Name").onChange(value => name = value)); setting.addText(text => text.setPlaceholder("Prompt").onChange(value => prompt = value)); setting.addButton(button => button.setButtonText("Add").setCta().onClick(async () => { if (!name.trim()) return; await ensureFolders(this.plugin.app.vault, [this.plugin.settings.folders.areas]); const id = stableId("ARE", `${name}:${Date.now()}`); await this.plugin.app.vault.create(`${this.plugin.settings.folders.areas}/${safeFilename(name)}.md`, frontmatterForArea(id, name.trim(), prompt.trim())); this.render(); }));
    new Setting(this.contentEl).addButton(button => button.setButtonText("Close").onClick(() => this.close()));
  }
}
