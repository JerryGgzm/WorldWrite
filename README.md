# WorldWrite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Repository: <https://github.com/JerryGgzm/WorldWrite>

**Write in your language. Be understood anywhere.**

An open-source Chrome extension (Manifest V3) — an inline communication
assistant for **writing, translating, polishing, and understanding messages
across languages**, using **your own AI API key**.

Highlight text anywhere, transform it with your own AI API, preview the result,
and replace in-place **only after approval**. Received a message in another
language? Translate or explain it for reading only — nothing on the page is
changed.

## Core principles

1. **Never auto-replace** your text — preview first, replace only on click.
2. **Never change your original meaning** — every prompt enforces meaning
   preservation and forbids adding facts.
3. **Never collect or store** your input. Privacy mode is **on by default**.
4. **You use your own AI API key** (any OpenAI-compatible endpoint).
5. Works in the **common input fields** across the web.

## Features

- Right-click any selected text and choose an action. The menu is split into two
  intents:
  - **For text you wrote** (replaces after preview): Translate to your target
    language, Polish, Make more professional, Custom rewrite.
  - **For a message you received** (read-only, never replaces): Explain this
    message, Translate to your native language.
- **Preview overlay** with a dynamic, task-specific title, original vs. result,
  optional word-level diff with a change summary, quick-tweak pills, a free-text
  follow-up composer, and **Replace / Copy / Regenerate / Cancel** + a short
  **Undo** after replacing.
- **Toolbar popup** showing status, quick language switches and a "Test
  connection" button; **keyboard shortcuts** (Esc to close, Enter to send a
  follow-up, Cmd/Ctrl+Enter to replace).
- Works with `<textarea>`, `<input>` (text/search/url/email/tel), basic
  `contenteditable`, same-origin iframes and open Shadow DOM.
- **Privacy by default**: only the selected text (plus your language/tone
  settings and an optional custom instruction) is ever sent to your provider.
  No page URL, page title, surrounding context, or history is sent or stored.
- **API key safety**: keys live only in `chrome.storage` (local or
  session-only), are read only by the background service worker, never reach the
  page DOM/console, and are never included in exported settings.
- Cancellable, non-blocking requests with stale-response protection.

## Install & build

Requirements: Node 18+.

```bash
npm install        # install dependencies
npm run build      # typecheck + production build into dist/
npm run dev        # Vite dev server with HMR for development
npm test           # run the unit test suite (Vitest)
```

### Load the extension in Chrome

1. Run `npm run build` (or `npm run dev`).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Click the extension icon (or open its options) and configure your provider.

## Configuration

Open the options page and set:

- **Native language** and **Target writing language**
- **AI provider** — pick a preset or enter any OpenAI-compatible base URL
- **API key** — Save / Test connection / Delete; optionally "do not persist"
  (session-only)
- **Model name**, **Default tone**, **Default behavior**
- **Privacy mode** (on by default), optional local history / context-aware mode

### Supported providers

Three API formats are supported. Selectable presets right now are **OpenAI,
Anthropic (Claude), Google Gemini, OpenRouter and DeepSeek**; more presets are
listed as "coming soon", and the **Custom** option still accepts any
OpenAI-compatible base URL via Advanced settings.

- **OpenAI-compatible** chat completions — e.g. OpenAI, OpenRouter, DeepSeek (and
  any other OpenAI-compatible endpoint via Custom).
- **Anthropic (Claude)** Messages API — `api.anthropic.com` using `x-api-key`
  auth and the `anthropic-version` header.
- **Google Gemini** `generateContent` API — `generativelanguage.googleapis.com`
  using `x-goog-api-key` auth (the key is sent as a header, never in the URL).

Pick the matching preset (or set **API format** accordingly) to use Claude or
Gemini models directly. To use them through an OpenAI-compatible gateway such as
OpenRouter, keep the format on **OpenAI-compatible**.

## Privacy

With privacy mode on (default), a request body contains **only**:

```
selected_text
user_selected_action
user_language_settings
user_custom_instruction (if provided)
```

No page URL, page title, surrounding context or full page content is sent, and
nothing (selected text, AI responses, history) is stored. You may opt out in the
settings to enable local history or context-aware mode.

## Architecture

```
scripts/
  build.mjs                 # deterministic MV3 build: generates manifest.json,
                            # bundles content script + service worker as IIFEs
src/
  background/
    service-worker.ts       # request/cancel dispatch, key access, test connection
    context-menu.ts         # context menu creation + click routing
  content/
    content-script.ts       # rewrite lifecycle state machine (preview-first)
    selection-manager.ts    # captures/validates the user's selection
    input-adapter.ts        # Textarea / Input / ContentEditable / Fallback adapters
    overlay.ts              # closed Shadow-DOM preview overlay
    diff.ts                 # word-level diff for the overlay
  options/
    options-page.tsx        # React settings UI
    options-storage.ts      # settings load/save/export (never includes keys)
  popup/
    popup.ts                # toolbar popup: status, language switch, test connection
  api/
    llm-client.ts           # fetch + timeout/abort + error mapping + output cleanup
    provider-adapters.ts    # OpenAI-compatible / Anthropic / Gemini adapters
    prompt-builder.ts       # stable, meaning-preserving prompts per action/site
  security/
    key-storage.ts          # API key storage (local/session), isolated from settings
    privacy-guard.ts        # enforces what may leave the browser / be stored
  shared/
    types.ts | constants.ts | errors.ts
```

### Request flow (API key never enters the page)

```
content script  -> chrome.runtime.sendMessage({ type, requestId, payload })
background       -> reads API key from chrome.storage (background only)
                 -> builds prompt + calls provider (OpenAI-compatible)
                 -> returns cleaned text (or a safe error code)
content script   -> shows preview overlay; replaces only on Replace click
```

### Extending

- **New provider format**: add a `ProviderAdapter` in
  `src/api/provider-adapters.ts` and register it in the `ADAPTERS` map.
- **New prompt/template or site**: extend `src/api/prompt-builder.ts` and
  `SITE_PROMPT_HINTS` / `SITE_HOST_MAP` in `src/shared/constants.ts`.
- **New input type**: implement the `InputAdapter` interface in
  `src/content/input-adapter.ts` and add it to `createAdapterForTarget`.

## Testing

```bash
npm test
```

Unit tests cover the PromptBuilder (incl. the 8 stability scenarios), provider
adapter, LLM client error mapping & output cleanup, KeyStorage, PrivacyGuard,
the input adapters, the SelectionManager and the diff.

### Manual testing

Open `test-pages/index.html` in the browser with the extension loaded. It
includes `<textarea>`, `<input>` (text/search/email), basic and nested
`contenteditable`, and a Shadow DOM field. Also try Gmail compose, LinkedIn
messages/comments, X/Twitter post box, and GitHub issue/comment fields.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for
development setup, the project's privacy/security principles, and the PR flow.

## License

MIT — see [LICENSE](LICENSE).
