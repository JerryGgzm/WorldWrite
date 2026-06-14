import {
  APP_NAME,
  CONTEXT_MENU_ITEMS,
  CONTEXT_MENU_PARENT_ID,
} from "@/shared/constants";
import { MSG } from "@/shared/types";
import type { RewriteAction, UserSettings } from "@/shared/types";
import { loadSettings } from "@/options/options-storage";

function titleFor(template: string, settings: UserSettings): string {
  return template
    .replace("{targetLanguage}", settings.targetLanguage)
    .replace("{nativeLanguage}", settings.nativeLanguage);
}

/** Recreates the context menu tree using the latest language settings. */
export async function rebuildContextMenu(): Promise<void> {
  const settings = await loadSettings();
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: CONTEXT_MENU_PARENT_ID,
    title: APP_NAME,
    contexts: ["editable", "selection"],
  });

  for (const item of CONTEXT_MENU_ITEMS) {
    if (item.kind === "separator") {
      chrome.contextMenus.create({
        id: item.id,
        parentId: CONTEXT_MENU_PARENT_ID,
        type: "separator",
        contexts: ["editable", "selection"],
      });
      continue;
    }
    chrome.contextMenus.create({
      id: item.id,
      parentId: CONTEXT_MENU_PARENT_ID,
      title: titleFor(item.titleTemplate, settings),
      contexts: ["editable", "selection"],
    });
  }
}

const ACTION_IDS = new Set<string>(
  CONTEXT_MENU_ITEMS.filter((i) => i.kind === "action").map((i) => i.id),
);

/** Wires menu clicks to the originating tab's content script. */
export function registerContextMenuClicks(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.parentMenuItemId !== CONTEXT_MENU_PARENT_ID) return;
    if (!tab?.id) return;
    if (!ACTION_IDS.has(String(info.menuItemId))) return;
    const action = info.menuItemId as RewriteAction;
    void loadSettings().then((settings) => {
      chrome.tabs
        .sendMessage(
          tab.id!,
          {
            type: MSG.CONTEXT_MENU_ACTION,
            action,
            targetLanguage: settings.targetLanguage,
            nativeLanguage: settings.nativeLanguage,
          },
          { frameId: info.frameId },
        )
        .catch(() => {
          // The content script may not be injected on this page (e.g. chrome://).
          // Silent here; selection-level errors are surfaced inside the content
          // script on supported pages.
        });
    });
  });
}
