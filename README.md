# Journal Companion

Journal Companion is a mobile-compatible, Markdown-first daily journal for seasons, recurring goals, focuses, reviews, and optional Prayer Library integration. It is published by Red-Beard under the MIT license.

## Install and first use

Install the folder into `.obsidian/plugins/journal-companion`, enable it, then open **Journal Companion settings**. Choose a daily filename format and enable **Setup complete**. The plugin does not create a note just because Obsidian starts unless the startup option is explicitly enabled.

Use **New Journal Entry** to create today’s note, **New season** to define goals and focuses, and **Manage journal areas** to add prompts. Journal Companion allows one daily entry per calendar date; repeated dashboard/widget actions open that existing entry instead of creating another. Weekly, monthly, and quarterly reviews are separate records. The dashboard opens native notes in another tab so your overview remains available.

## Storage and Markdown

Clean installations default to `Journal Companion/` with `Daily/`, `Seasons/`, `Areas/`, `Reviews/`, and backups. Existing `Journal/` notes are read in compatibility mode. Daily notes contain a bounded managed block for checklists, focus reminders, prompts, and prayer links; personal writing below it is not replaced. Goals are ordinary Markdown checkboxes and remain editable without the plugin.

## Seasons, goals, focuses, and reviews

Seasons can overlap. Goals support daily, weekly, monthly, quarterly, or selected-weekday recurrence. Focuses are ordered reminders with optional dates and Scripture references. Review actions create editable weekly, monthly, or quarterly notes. Areas are user-defined; the optional starter pack is off by default.

## Prayer Library

When Prayer Library exposes its public bridge, creating (or opening today through the dashboard) adds a `Prayers for today` section inside the managed daily block. Each item is a normal Markdown checkbox with a wikilink, category, optional Scripture, and a small `journal-prayer:<id>` marker used only to synchronize the checkbox with Prayer Library. The title and text remain easy to read and edit in source mode. Checking an item in the note records it as prayed; dashboard and widget buttons update the same checkbox and prayer history.

If the bridge or plugin is unavailable, the prayer section is omitted and the rest of the journal remains fully usable. No duplicate prayer history is created and no network access is required by Journal Companion. The bridge uses `getDailyPrayers(date, categories)`, `markPrayed(prayerId, date)`, and `openPrayer(prayerId)`; it is optional and does not make Prayer Library a runtime dependency.

## Migration

Migration is staged and explicit: preview, backup, migrate, verify, and restore. Preview is non-mutating. Backups are created under the configured root and failed records remain readable through compatibility mode. Filenames are not renamed during schema migration. Existing Periodic Notes, Calendar, Dataview, Templater, and timeline plugins remain installed and untouched; disable them manually only after verifying the replacement workflow.

## Mobile support and limitations

Forms use native Obsidian controls, date pickers, one scroll container, safe-area padding, and keyboard-safe bottom spacing. The plugin stores ordinary Markdown and does not provide encryption. It does not infer seasons for migrated notes or guess historical goal completion.

## Development

Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, and `npm run validate`. A pinned Foundation adapter is bundled in `src/foundation-vendor.ts`, so the public project has no machine-specific dependency. The Journal Companion dashboard can register a widget with Red-Beard Dashboard through its public `registerWidget()` contract.
