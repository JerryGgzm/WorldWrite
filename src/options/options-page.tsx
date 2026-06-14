import { useCallback, useEffect, useRef, useState } from "react";
import {
  BEHAVIORS,
  PROVIDER_KEY_HELP,
  PROVIDER_PRESETS,
  TONES,
} from "@/shared/constants";
import { MSG } from "@/shared/types";
import type {
  ProviderConfig,
  TestConnectionResponse,
  UserSettings,
} from "@/shared/types";
import {
  exportSettings,
  loadSettings,
  parseImportedSettings,
  saveSettings,
} from "./options-storage";
import { createKeyStorage } from "@/security/key-storage";

const keyStorage = createKeyStorage();

function getActiveProvider(s: UserSettings): ProviderConfig {
  return (
    s.providers.find((p) => p.providerId === s.activeProviderId) ??
    s.providers[0]
  );
}

type Banner = { kind: "ok" | "err"; text: string } | null;

export function OptionsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keyStored, setKeyStored] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saveBanner, setSaveBanner] = useState<Banner>(null);
  const [keyBanner, setKeyBanner] = useState<Banner>(null);
  const [testBanner, setTestBanner] = useState<Banner>(null);
  const [testing, setTesting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSettings().then(async (s) => {
      setSettings(s);
      const existing = await keyStorage.getApiKey(s.activeProviderId);
      setKeyStored(Boolean(existing));
    });
  }, []);

  const provider = settings ? getActiveProvider(settings) : null;

  const patchProvider = useCallback(
    (patch: Partial<ProviderConfig>) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const active = getActiveProvider(prev);
        const updated: ProviderConfig = { ...active, ...patch };
        const providers = prev.providers.some(
          (p) => p.providerId === updated.providerId,
        )
          ? prev.providers.map((p) =>
              p.providerId === active.providerId ? updated : p,
            )
          : [...prev.providers, updated];
        return {
          ...prev,
          providers,
          activeProviderId: updated.providerId,
        };
      });
    },
    [],
  );

  const applyPreset = useCallback(
    async (presetId: string) => {
      const preset = PROVIDER_PRESETS.find((p) => p.providerId === presetId);
      if (!preset || !preset.enabled || !settings) return;
      setSettings((prev) => {
        if (!prev) return prev;
        const existing = prev.providers.find(
          (p) => p.providerId === preset.providerId,
        );
        const next: ProviderConfig = existing ?? {
          providerId: preset.providerId,
          displayName: preset.displayName,
          baseUrl: preset.baseUrl,
          model: preset.model,
          apiFormat: preset.apiFormat,
        };
        const providers = prev.providers.some(
          (p) => p.providerId === next.providerId,
        )
          ? prev.providers
          : [...prev.providers, next];
        return { ...prev, providers, activeProviderId: next.providerId };
      });
      const existing = await keyStorage.getApiKey(preset.providerId);
      setKeyStored(Boolean(existing));
      setApiKey("");
    },
    [settings],
  );

  const patchSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const onSaveAll = useCallback(async () => {
    if (!settings) return;
    await saveSettings(settings);
    setSaveBanner({ kind: "ok", text: "Settings saved." });
    setTimeout(() => setSaveBanner(null), 2500);
  }, [settings]);

  const onSaveKey = useCallback(async () => {
    if (!settings || !provider) return;
    if (!apiKey.trim()) {
      setKeyBanner({ kind: "err", text: "Enter an API key first." });
      return;
    }
    await keyStorage.saveApiKey(
      provider.providerId,
      apiKey.trim(),
      settings.sessionOnlyKey,
    );
    setKeyStored(true);
    setApiKey("");
    setKeyBanner({
      kind: "ok",
      text: settings.sessionOnlyKey
        ? "Key stored for this browser session only."
        : "Key saved locally on this device.",
    });
  }, [apiKey, provider, settings]);

  const onDeleteKey = useCallback(async () => {
    if (!provider) return;
    await keyStorage.deleteApiKey(provider.providerId);
    setKeyStored(false);
    setApiKey("");
    setKeyBanner({ kind: "ok", text: "Key deleted." });
  }, [provider]);

  const onTestConnection = useCallback(async () => {
    if (!provider) return;
    setTesting(true);
    setTestBanner(null);
    try {
      const keyToUse = apiKey.trim() || (await keyStorage.getApiKey(provider.providerId)) || "";
      const resp = (await chrome.runtime.sendMessage({
        type: MSG.TEST_CONNECTION,
        provider,
        apiKey: keyToUse,
      })) as TestConnectionResponse;
      setTestBanner({
        kind: resp.ok ? "ok" : "err",
        text: resp.message,
      });
    } catch {
      setTestBanner({ kind: "err", text: "Could not reach the provider." });
    } finally {
      setTesting(false);
    }
  }, [apiKey, provider]);

  const onExport = useCallback(() => {
    if (!settings) return;
    const blob = new Blob([exportSettings(settings)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inline-ai-assistant-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [settings]);

  const onImport = useCallback(async (file: File) => {
    const text = await file.text();
    try {
      const imported = parseImportedSettings(text);
      setSettings(imported);
      setSaveBanner({
        kind: "ok",
        text: "Imported. Review and click Save to apply.",
      });
    } catch {
      setSaveBanner({ kind: "err", text: "Invalid settings file." });
    }
  }, []);

  if (!settings || !provider) {
    return <div className="page">Loading…</div>;
  }

  return (
    <div className="page">
      <div className="brand-row">
        <img
          className="brand-logo"
          src={chrome.runtime.getURL("icons/icon-128.png")}
          alt=""
          width={36}
          height={36}
        />
        <h1>WorldWrite</h1>
      </div>
      <p className="tagline">Write in your language. Be understood anywhere.</p>
      <p className="subtitle">
        An inline communication assistant for writing, translating, and
        understanding messages across languages. Use your own AI — your text is
        processed only by the provider you configure below.
      </p>

      <section className="card what-you-can-do">
        <h2>What you can do</h2>
        <ul className="capabilities">
          <li>
            <strong>Translate</strong> what you write into another language.
          </li>
          <li>
            <strong>Polish</strong> your writing to sound natural and fluent.
          </li>
          <li>
            <strong>Make it professional</strong> for work and formal messages.
          </li>
          <li>
            <strong>Custom rewrite</strong> with your own instruction.
          </li>
          <li>
            <strong>Understand & translate</strong> messages you receive — for
            reading only, nothing on the page changes.
          </li>
        </ul>
      </section>

      <section className="card getting-started">
        <h2>Getting started — 3 steps</h2>
        <ol className="steps">
          <li>
            Set your <strong>Native language</strong> (your first language) and
            your <strong>Target writing language</strong> below.
          </li>
          <li>
            Pick an <strong>AI provider</strong>, get a free/paid API key from
            its website, paste it, and click <strong>Save key</strong>. Use{" "}
            <strong>Test connection</strong> to confirm it works.
          </li>
          <li>
            On any web page, select text, <strong>right-click</strong> →{" "}
            <em>WorldWrite</em>, and pick an action. You will always see a
            preview before anything is replaced.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Languages</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="native">Native language</label>
            <input
              id="native"
              type="text"
              value={settings.nativeLanguage}
              onChange={(e) => patchSettings({ nativeLanguage: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="target">Target writing language</label>
            <input
              id="target"
              type="text"
              value={settings.targetLanguage}
              onChange={(e) => patchSettings({ targetLanguage: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>AI Provider</h2>
        <div className="field">
          <label htmlFor="preset">Provider preset</label>
          <select
            id="preset"
            value={
              PROVIDER_PRESETS.some((p) => p.providerId === provider.providerId)
                ? provider.providerId
                : ""
            }
            onChange={(e) => void applyPreset(e.target.value)}
          >
            <option value="">Custom</option>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.providerId} value={p.providerId} disabled={!p.enabled}>
                {p.displayName}
                {p.enabled ? "" : " (coming soon)"}
              </option>
            ))}
          </select>
          <div className="hint">
            OpenAI, Anthropic (Claude), Google Gemini, OpenRouter and DeepSeek
            are available now. More providers are coming soon.
          </div>
        </div>
        <div className="field">
          <label htmlFor="model">Model name</label>
          <input
            id="model"
            type="text"
            value={provider.model}
            onChange={(e) => patchProvider({ model: e.target.value })}
          />
          <div className="hint">
            Pick a preset above and this is filled for you. Change it only if you
            want a different model.
          </div>
        </div>
        <details className="advanced">
          <summary>Advanced settings (optional)</summary>
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              type="text"
              value={provider.displayName}
              onChange={(e) => patchProvider({ displayName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="baseUrl">API base URL</label>
            <input
              id="baseUrl"
              type="url"
              value={provider.baseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => patchProvider({ baseUrl: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="apiFormat">API format</label>
            <select
              id="apiFormat"
              value={provider.apiFormat}
              onChange={(e) =>
                patchProvider({ apiFormat: e.target.value as ProviderConfig["apiFormat"] })
              }
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="gemini">Google Gemini</option>
            </select>
            <div className="hint">
              Use Anthropic for Claude via api.anthropic.com and Gemini for
              Google models. Claude/Gemini through an OpenAI-compatible gateway
              (e.g. OpenRouter) should stay on OpenAI-compatible.
            </div>
          </div>
        </details>
      </section>

      <section className="card">
        <h2>API Key</h2>
        <div className="field">
          <label htmlFor="apiKey">
            API key for {provider.displayName}
          </label>
          <div className="inline">
            <input
              id="apiKey"
              type={showKey ? "text" : "password"}
              value={apiKey}
              placeholder={keyStored ? "•••••••• (stored)" : "Paste your key"}
              autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <div className="key-state">
            {keyStored
              ? settings.sessionOnlyKey
                ? "A key is stored for this browser session only."
                : "A key is stored locally on this device."
              : "No key stored yet."}
          </div>
          {PROVIDER_KEY_HELP[provider.providerId] ? (
            <div className="hint">
              Don’t have a key?{" "}
              <a
                href={PROVIDER_KEY_HELP[provider.providerId]}
                target="_blank"
                rel="noreferrer"
              >
                Get an API key for {provider.displayName} →
              </a>
            </div>
          ) : (
            <div className="hint">
              Local providers (Ollama, LM Studio, LiteLLM) usually don’t need a
              key — enter any value if one is required.
            </div>
          )}
        </div>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.sessionOnlyKey}
            onChange={(e) =>
              patchSettings({ sessionOnlyKey: e.target.checked })
            }
          />
          <span>
            <span className="label">Do not persist key</span>
            <div className="hint">
              Keep the key only for the current browser session
              (chrome.storage.session). It is cleared when the browser closes.
            </div>
          </span>
        </label>

        <div className="actions">
          <button type="button" className="primary" onClick={onSaveKey}>
            Save key
          </button>
          <button type="button" onClick={onTestConnection} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button type="button" className="danger" onClick={onDeleteKey}>
            Delete key
          </button>
        </div>
        {keyBanner && (
          <div className={`status ${keyBanner.kind}`}>{keyBanner.text}</div>
        )}
        {testBanner && (
          <div className={`status ${testBanner.kind}`}>{testBanner.text}</div>
        )}
        <div className="key-state">
          Your key is stored locally and sent only to the provider URL above. It
          is never written to logs, page content, or exported settings.
        </div>
      </section>

      <section className="card">
        <h2>Defaults</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="tone">Default tone</label>
            <select
              id="tone"
              value={settings.defaultTone}
              onChange={(e) =>
                patchSettings({ defaultTone: e.target.value as UserSettings["defaultTone"] })
              }
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="behavior">Default behavior</label>
            <select
              id="behavior"
              value={settings.defaultBehavior}
              onChange={(e) =>
                patchSettings({
                  defaultBehavior: e.target.value as UserSettings["defaultBehavior"],
                })
              }
            >
              {BEHAVIORS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Privacy</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.privacyMode}
            onChange={(e) => patchSettings({ privacyMode: e.target.checked })}
          />
          <span>
            <span className="label">
              Privacy mode {settings.privacyMode ? "(on)" : "(off)"}
            </span>
            <div className="hint">
              On by default. Only the text you select is sent to your provider.
              Nothing is stored: no selected text, no AI responses, no history,
              no page URL or title, no surrounding context.
            </div>
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            disabled={settings.privacyMode}
            checked={!settings.privacyMode && settings.contextAwareMode}
            onChange={(e) =>
              patchSettings({ contextAwareMode: e.target.checked })
            }
          />
          <span>
            <span className="label">Context-aware mode</span>
            <div className="hint">
              Allow sending limited surrounding context. Disabled while privacy
              mode is on.
            </div>
          </span>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            disabled={settings.privacyMode}
            checked={!settings.privacyMode && settings.saveLocalHistory}
            onChange={(e) =>
              patchSettings({ saveLocalHistory: e.target.checked })
            }
          />
          <span>
            <span className="label">Save local rewrite history</span>
            <div className="hint">
              Store recent rewrites locally on this device only. Disabled while
              privacy mode is on.
            </div>
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Backup</h2>
        <div className="actions">
          <button type="button" onClick={onExport}>
            Export settings
          </button>
          <button type="button" onClick={() => importInputRef.current?.click()}>
            Import settings
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImport(file);
            }}
          />
        </div>
        <div className="privacy-banner">
          Exported files never include your API key.
        </div>
      </section>

      <div className="sticky-save">
        <button type="button" className="primary" onClick={onSaveAll}>
          Save all settings
        </button>
        {saveBanner && (
          <div className={`status ${saveBanner.kind}`}>{saveBanner.text}</div>
        )}
      </div>
    </div>
  );
}
