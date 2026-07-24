import { WORKSPACE_PREFERENCES_STORAGE_KEY } from "@/lib/workspacePreferences";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";

/** Applies locally persisted presentation preferences before React hydrates. */
export function PreferenceBootstrap({ fallbackPreferences }: { fallbackPreferences?: WorkspacePreferences }) {
  const fallback = JSON.stringify(fallbackPreferences ?? {});
  const script = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(WORKSPACE_PREFERENCES_STORAGE_KEY)});var p=raw?JSON.parse(raw):${fallback};var theme=p.theme||'system';var resolved=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;var root=document.documentElement;root.dataset.theme=resolved;root.dataset.themePreference=theme;root.dataset.fontSize=p.fontSize||'medium';root.dataset.readingWidth=p.readingWidth||'comfortable';root.dataset.focusMode=String(Boolean(p.focusMode));root.dataset.scriptDisplay=p.scriptDisplay||'original';root.dataset.motion=p.motionEnabled===false?'reduced':'full'}catch(_){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
