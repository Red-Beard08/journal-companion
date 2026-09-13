import type { DashboardWidgetContext, DashboardWidgetDefinition as FoundationWidgetDefinition, RedBeardSettingsBase } from "./foundation-vendor";

export const PLUGIN_ID = "journal-companion";
export const VIEW_ID = "journal-companion-dashboard";
export const DAILY_TYPE = "journal-companion-daily";
export const SEASON_TYPE = "journal-companion-season";
export const AREA_TYPE = "journal-companion-area";
export const DAILY_START = "<!-- journal-companion:daily-managed-start -->";
export const DAILY_END = "<!-- journal-companion:daily-managed-end -->";
export const SEASON_GOALS_START = "<!-- journal-companion:goals-start -->";
export const SEASON_GOALS_END = "<!-- journal-companion:goals-end -->";
export const SEASON_FOCUSES_START = "<!-- journal-companion:focuses-start -->";
export const SEASON_FOCUSES_END = "<!-- journal-companion:focuses-end -->";

export type SeasonStatus = "active" | "completed" | "archived";
export type GoalRecurrence = "daily" | "weekly" | "monthly" | "quarterly" | "weekdays";
export type ReviewCadence = "daily" | "weekly" | "monthly" | "quarterly";

export interface GoalDefinition {
  id: string;
  title: string;
  recurrence: GoalRecurrence;
  weekdays?: number[];
  active: boolean;
  scripture?: string[];
  guidance?: string;
}

export interface FocusDefinition {
  id: string;
  text: string;
  order: number;
  active: boolean;
  startDate?: string;
  endDate?: string;
  scripture?: string[];
}

export interface SeasonRecord {
  file: import("obsidian").TFile;
  id: string;
  name: string;
  status: SeasonStatus;
  startDate?: string;
  endDate?: string;
  goals: GoalDefinition[];
  focuses: FocusDefinition[];
  scripture: string[];
}

export interface AreaRecord {
  file: import("obsidian").TFile;
  id: string;
  name: string;
  order: number;
  status: "active" | "archived";
  prompt: string;
  scripture: string[];
}

export interface DailyRecord {
  file: import("obsidian").TFile;
  id: string;
  date: string;
  seasonIds: string[];
  legacy: boolean;
  content: string;
  managedContent: string;
}

export interface JournalSettings extends RedBeardSettingsBase {
  rootFolder: string;
  folders: RedBeardSettingsBase["folders"] & { daily: string; seasons: string; areas: string; reviews: string };
  files: RedBeardSettingsBase["files"] & { index: string };
  dashboardPath: string;
  legacySourceFolder: string;
  dailyFormat: string;
  setupComplete: boolean;
  reportRange: "7" | "30" | "90" | "season" | "all";
  prayer: {
    enabled: boolean;
    pluginId: string;
    categories: string[];
    dailyCount: number;
    showScripture: boolean;
    showHistory: boolean;
  };
  starterAreasEnabled: boolean;
  createOnStartup: boolean;
  reviewCadences: ReviewCadence[];
}

export type JournalWidgetRenderer = (ctx: DashboardWidgetContext<JournalSettings> & { journal: JournalRepositoryLike }, container: HTMLElement) => void | Promise<void>;
export interface JournalWidgetDefinition extends Omit<FoundationWidgetDefinition<JournalSettings>, "defaultLayout" | "render"> {
  defaultLayout?: Partial<{ x: number; w: number; mobileW: number; h: number; order: number; visible: boolean; locked: boolean }>;
  render: JournalWidgetRenderer;
}

export interface JournalContext extends DashboardWidgetContext<JournalSettings> { journal: JournalRepositoryLike; }

export interface JournalRepositoryLike {
  getDaily(date?: string): Promise<DailyRecord | null>;
  getSeasons(): Promise<SeasonRecord[]>;
  getAreas(): Promise<AreaRecord[]>;
  getRecent(limit: number): Promise<DailyRecord[]>;
  getGoalStats(seasonIds: string[], days: number): Promise<{ total: number; complete: number; streak: number; due: number }>;
  getPrayerBridge(): PrayerLibraryBridge | null;
}

export interface PrayerSummary { id: string; title: string; text: string; category: string; scripture?: string[]; prayed: boolean; }
export interface PrayerLibraryBridge {
  getDailyPrayers(date: string, categories: string[]): Promise<PrayerSummary[]>;
  markPrayed(prayerId: string, date: string): Promise<void>;
  openPrayer(prayerId: string): void;
}
