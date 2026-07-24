export const WORKSPACE_PREFERENCES_STORAGE_KEY = "palimnote.workspace-preferences";

export const THEME_OPTIONS = ["system", "light", "dark"] as const;
export const FONT_SIZE_OPTIONS = ["small", "medium", "large"] as const;
export const READING_WIDTH_OPTIONS = ["compact", "comfortable", "wide"] as const;
export const SCRIPT_DISPLAY_OPTIONS = ["original", "transliteration"] as const;

export type WorkspaceTheme = (typeof THEME_OPTIONS)[number];
export type WorkspaceFontSize = (typeof FONT_SIZE_OPTIONS)[number];
export type WorkspaceReadingWidth = (typeof READING_WIDTH_OPTIONS)[number];
export type WorkspaceScriptDisplay = (typeof SCRIPT_DISPLAY_OPTIONS)[number];

export interface WorkspacePreferences {
  theme: WorkspaceTheme;
  fontSize: WorkspaceFontSize;
  readingWidth: WorkspaceReadingWidth;
  focusMode: boolean;
  scriptDisplay: WorkspaceScriptDisplay;
  soundEnabled: boolean;
  motionEnabled: boolean;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  theme: "system",
  fontSize: "medium",
  readingWidth: "comfortable",
  focusMode: false,
  scriptDisplay: "original",
  soundEnabled: true,
  motionEnabled: true,
};

function isOption<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === "string" && options.includes(value);
}

/** Normalizes persisted JSON so old or malformed values never break the shell. */
export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  const candidate = value && typeof value === "object" ? value as Partial<WorkspacePreferences> : {};
  return {
    theme: isOption(candidate.theme, THEME_OPTIONS) ? candidate.theme : DEFAULT_WORKSPACE_PREFERENCES.theme,
    fontSize: isOption(candidate.fontSize, FONT_SIZE_OPTIONS) ? candidate.fontSize : DEFAULT_WORKSPACE_PREFERENCES.fontSize,
    readingWidth: isOption(candidate.readingWidth, READING_WIDTH_OPTIONS)
      ? candidate.readingWidth
      : DEFAULT_WORKSPACE_PREFERENCES.readingWidth,
    focusMode: typeof candidate.focusMode === "boolean" ? candidate.focusMode : DEFAULT_WORKSPACE_PREFERENCES.focusMode,
    scriptDisplay: isOption(candidate.scriptDisplay, SCRIPT_DISPLAY_OPTIONS)
      ? candidate.scriptDisplay
      : DEFAULT_WORKSPACE_PREFERENCES.scriptDisplay,
    soundEnabled: typeof candidate.soundEnabled === "boolean" ? candidate.soundEnabled : DEFAULT_WORKSPACE_PREFERENCES.soundEnabled,
    motionEnabled: typeof candidate.motionEnabled === "boolean" ? candidate.motionEnabled : DEFAULT_WORKSPACE_PREFERENCES.motionEnabled,
  };
}
