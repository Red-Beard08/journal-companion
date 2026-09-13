/* Pinned snapshot of the Red-Beard Foundation adapters.
 * Keeping these small helpers in the bundle makes this repository portable
 * while preserving the same contract as the shared Foundation package. */

import type { App, Modal, TFile, Vault } from "obsidian";

export interface RedBeardSettingsBase {
  settingsVersion: number;
  rootFolder: string;
  folders: Record<string, string>;
  files: Record<string, string>;
  naming: { idPrefix: string; filenameTemplate: string; dateFormat: string };
  taxonomy: { categories: string[]; statuses: string[]; archived: string[] };
  defaults: Record<string, string | number | boolean>;
  dashboard: { startup: boolean; autoRefreshSeconds: number; compact: boolean };
  migration: { sourceFolder: string; mode: "copy" | "in-place"; lastRun?: string };
  privacy: { showReminder: boolean };
}

export interface DashboardWidgetLayout { w: number; mobileW: number; h: number; order?: number; }
export interface DashboardWidgetContext<TSettings = unknown> {
  app: App;
  vault: Vault;
  settings: TSettings;
  refresh: () => Promise<void> | void;
  openNote: (path: string) => Promise<void> | void;
  notice: (message: string) => void;
}
export interface DashboardWidgetDefinition<TSettings = unknown> {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  defaultLayout: DashboardWidgetLayout;
  mobile?: "stack" | "responsive" | "hidden";
  settingsSchema?: unknown;
  render: (ctx: DashboardWidgetContext<TSettings>, container: HTMLElement) => void | Promise<void>;
  update?: (ctx: DashboardWidgetContext<TSettings>, container: HTMLElement) => void | Promise<void>;
  cleanup?: () => void;
}

export function normalizeVaultPath(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (/^[/\\]{2}/.test(trimmed)) return "";
  const raw = trimmed.replace(/[\\]+/g, "/").replace(/^\/+/, "");
  if (!raw || /^[A-Za-z]:\//.test(raw)) return "";
  const segments = raw.split("/").filter(segment => segment && segment !== ".");
  if (segments.some(segment => segment === "..")) return "";
  return segments.join("/");
}

export function normalizeVaultFolder(value: string, fallback: string): string {
  return normalizeVaultPath(value) || normalizeVaultPath(fallback);
}

export function normalizeVaultFile(value: string, fallback: string): string {
  const normalized = normalizeVaultPath(value) || normalizeVaultPath(fallback);
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

export function safeFilename(value: string, fallback = "Untitled"): string {
  const cleaned = String(value ?? "").normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/[. ]+$/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 120);
}

export function replaceManagedBlock(text: string, markers: { start: string; end: string }, body: string): string {
  const replacement = `${markers.start}\n${body.trimEnd()}\n${markers.end}`;
  const start = text.indexOf(markers.start);
  if (start >= 0) {
    const bodyStart = start + markers.start.length;
    const end = text.indexOf(markers.end, bodyStart);
    if (end >= 0) return `${text.slice(0, start)}${replacement}${text.slice(end + markers.end.length)}`;
  }
  const prefix = text.trimEnd();
  return prefix ? `${prefix}\n\n${replacement}\n` : `${replacement}\n`;
}

export async function ensureVaultFolders(vault: Vault, folders: string[]): Promise<void> {
  const ordered = [...new Set(folders.map(folder => normalizeVaultFolder(folder, "")).filter(Boolean))].sort((a, b) => a.split("/").length - b.split("/").length);
  for (const folder of ordered) {
    const segments = folder.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (vault.getAbstractFileByPath(current)) continue;
      try { await vault.createFolder(current); } catch { if (!vault.getAbstractFileByPath(current)) throw new Error(`Could not create folder: ${current}`); }
    }
  }
}

export async function writeTextIfChanged(vault: Vault, file: TFile, next: string): Promise<boolean> {
  const current = await vault.read(file);
  if (current === next) return false;
  await vault.process(file, () => next);
  return true;
}

export function prepareMobileModal(modal: Modal, extraClass?: string): void {
  modal.modalEl.addClass("rb-addon-modal");
  if (extraClass) modal.modalEl.addClass(extraClass);
  modal.contentEl.addClass("rb-addon-modal-content");
  modal.contentEl.setAttr("tabindex", "-1");
}

export function namespacedCommandId(pluginId: string, action: string): string {
  return `${pluginId}:${action}`.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
}
