import { loadSettings, saveSettings } from "@/options/options-storage";
import { createKeyStorage } from "@/security/key-storage";
import { APP_NAME, APP_TAGLINE, COMMON_LANGUAGES } from "@/shared/constants";
import { MSG } from "@/shared/types";
import type { ProviderConfig, UserSettings } from "@/shared/types";
import "./popup.css";

const keyStorage = createKeyStorage();

function activeProvider(s: UserSettings): ProviderConfig | undefined {
  return s.providers.find((p) => p.providerId === s.activeProviderId) ?? s.providers[0];
}

function escape(text: string): string {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

let savedToastTimer: ReturnType<typeof setTimeout> | null = null;

/** Briefly confirms a quick setting change without shifting the layout. */
function showSavedToast(): void {
  let toast = document.getElementById("saved-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "saved-toast";
    toast.textContent = "Saved ✓";
    document.body.appendChild(toast);
  }
  toast.classList.add("show");
  if (savedToastTimer) clearTimeout(savedToastTimer);
  savedToastTimer = setTimeout(() => toast?.classList.remove("show"), 1400);
}

/** Builds <option>s, ensuring the current (possibly custom) value is present. */
function languageOptions(current: string): string {
  const list = [...COMMON_LANGUAGES] as string[];
  if (current && !list.includes(current)) list.unshift(current);
  return list
    .map(
      (lang) =>
        `<option value="${escape(lang)}"${lang === current ? " selected" : ""}>${escape(lang)}</option>`,
    )
    .join("");
}

async function render(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;

  const settings = await loadSettings();
  const provider = activeProvider(settings);
  const hasKey = provider
    ? Boolean(await keyStorage.getApiKey(provider.providerId))
    : false;
  const configured = Boolean(provider && hasKey);

  const statusHtml = configured
    ? `<div class="status ok">
         <span class="dot"></span>
         <span class="info">
           <span class="label">Ready to use</span>
           <span class="sub">${escape(provider!.displayName)} · ${escape(provider!.model)}</span>
         </span>
       </div>`
    : `<div class="status warn">
         <span class="dot"></span>
         <span class="info">
           <span class="label">${provider ? "No API key yet" : "Not configured"}</span>
           <span class="sub">Add your AI provider and key to start.</span>
         </span>
       </div>`;

  const logoUrl = chrome.runtime.getURL("icons/icon-48.png");
  root.innerHTML = `
    <div class="pop">
      <div class="brand"><img src="${logoUrl}" alt="" width="22" height="22" /><h1>${escape(APP_NAME)}</h1></div>
      <p class="tagline">${escape(APP_TAGLINE)}</p>
      ${statusHtml}
      <label class="pick">
        <span>Translate to</span>
        <select id="target">${languageOptions(settings.targetLanguage)}</select>
      </label>
      <label class="pick">
        <span>Your language</span>
        <select id="native">${languageOptions(settings.nativeLanguage)}</select>
      </label>
      <div class="row"><span>Privacy mode</span><b>${settings.privacyMode ? "On" : "Off"}</b></div>
      <div class="tip">
        Select text in any input, <b>right-click → ${escape(APP_NAME)}</b>,
        then preview before replacing. Nothing is changed until you click Replace.
      </div>
      ${configured ? `<button id="test" class="secondary">Test connection</button>` : ""}
      <div id="result" class="result" hidden></div>
      <button id="open">${configured ? "Open settings" : "Set up now"}</button>
      <p class="hint">Your text is never stored. Keys stay on this device.</p>
    </div>`;

  root.querySelector<HTMLButtonElement>("#open")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Quick language switches persist immediately; the context menu label updates
  // automatically via the background storage listener.
  root.querySelector<HTMLSelectElement>("#target")?.addEventListener("change", (e) => {
    settings.targetLanguage = (e.target as HTMLSelectElement).value;
    void saveSettings(settings).then(showSavedToast);
  });
  root.querySelector<HTMLSelectElement>("#native")?.addEventListener("change", (e) => {
    settings.nativeLanguage = (e.target as HTMLSelectElement).value;
    void saveSettings(settings).then(showSavedToast);
  });

  const result = root.querySelector<HTMLDivElement>("#result");
  root.querySelector<HTMLButtonElement>("#test")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (!provider || !result) return;
    btn.disabled = true;
    result.hidden = false;
    result.className = "result testing";
    result.innerHTML = `<span class="spinner"></span><span>Testing connection…</span>`;
    try {
      const apiKey = (await keyStorage.getApiKey(provider.providerId)) ?? "";
      const resp = (await chrome.runtime.sendMessage({
        type: MSG.TEST_CONNECTION,
        provider,
        apiKey,
      })) as { ok: boolean; message: string } | undefined;
      const ok = Boolean(resp?.ok);
      result.className = `result ${ok ? "ok" : "err"}`;
      result.textContent = resp?.message ?? "No response from background.";
    } catch {
      result.className = "result err";
      result.textContent = "Could not reach the extension worker.";
    } finally {
      btn.disabled = false;
    }
  });
}

void render();
