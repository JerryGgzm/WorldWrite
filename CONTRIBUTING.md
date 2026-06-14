# Contributing to WorldWrite

Thanks for your interest in improving **WorldWrite** — an inline communication
assistant for writing, translating, and understanding messages across languages.

This guide explains how to set up the project, the rules every change must
follow, and how to submit your work.

> By contributing, you agree that your contributions are licensed under the
> project's [MIT License](LICENSE).

---

## Non-negotiable principles

WorldWrite operates on text the user selects inside web pages, using the user's
own AI API key. **Any change must preserve these guarantees** — PRs that weaken
them will not be merged:

1. **Privacy by default.** Only the selected text, the chosen action, language
   settings, and an optional custom instruction may leave the browser. Never
   send the page URL, page title, surrounding context, or full page content
   unless the user has explicitly opted out of privacy mode.
2. **Never store user text.** No selected text, AI responses, or history may be
   persisted unless the user has explicitly enabled local history (privacy mode
   off).
3. **API keys never leave the background.** Keys are read only by the background
   service worker, sent only in request headers (never in URLs, bodies, the DOM,
   logs, or exported settings), and never returned to content scripts or pages.
4. **Preview-first, no auto-replace.** Text on the page is replaced only after an
   explicit user action (the Replace button / shortcut). Always show a preview
   first and keep the original visible for review.
5. **Never change the user's meaning.** Prompts must preserve meaning and must
   not invent facts.

If a feature seems to require breaking one of these, open an issue to discuss it
first.

---

## Development setup

Requirements: **Node 18+**.

```bash
npm install        # install dependencies
npm run build      # typecheck + production build into dist/
npm run dev        # watch build for development
npm test           # run the unit test suite (Vitest)
```

### Loading the extension locally

1. Run `npm run build` (or `npm run dev`).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. After each rebuild, click the reload icon on the extension card.

For manual testing, open `test-pages/index.html` (textarea, inputs,
contenteditable, Shadow DOM) and also try real sites like Gmail, LinkedIn,
X/Twitter, and GitHub.

---

## Code standards

- **TypeScript everywhere.** The build runs `tsc --noEmit`; it must pass with no
  errors.
- **Keep it typed and lint-clean.** Avoid `any`; prefer the shared types in
  `src/shared/types.ts`.
- **No stray logging.** Do not add `console.log` / `console.error`, especially
  anywhere that could touch an API key or user text.
- **Comments explain intent, not the obvious.** Don't narrate what the code does;
  explain non-obvious trade-offs or constraints.
- **Match the existing style** and file structure (see the Architecture section
  in the [README](README.md)).
- **Add or update tests** for any logic change (see below).

---

## Tests

All changes to logic should be covered by unit tests:

```bash
npm test
```

The suite covers the prompt builder, provider adapters, the LLM client error
mapping and output cleanup, key storage, the privacy guard, input adapters, the
selection manager, action metadata, and the diff. Please keep the suite green.

When you add a feature, add tests in `test/` following the existing patterns —
especially for anything touching prompts, privacy, error handling, or key
storage.

---

## Submitting changes

1. **Open an issue first** for non-trivial features or anything that affects
   privacy, security, or the prompt/meaning guarantees.
2. Fork the repo and create a branch from `main`
   (e.g. `feat/explain-tone`, `fix/overlay-clamp`).
3. Make your change, keeping commits focused and descriptive.
4. Run `npm run build` and `npm test` — both must pass.
5. Open a Pull Request that:
   - describes **what** changed and **why**;
   - notes any impact on the principles above (and confirms none are weakened);
   - includes screenshots/GIFs for UI changes;
   - links the related issue.

### Commit / PR style

- Use clear, imperative messages: `add Gemini adapter`, `fix overlay clamping`.
- Prefer small, reviewable PRs over large ones.

---

## Reporting bugs & requesting features

Open a GitHub issue with:

- **Bugs:** what you did, what you expected, what happened, your browser version,
  the provider/model in use, and (if relevant) the input field / site. **Never
  paste your API key** or any private text into an issue.
- **Features:** the problem you're trying to solve and your proposed approach.

---

## Security

If you find a vulnerability (e.g. a way to leak an API key or user text), please
**do not open a public issue**. Report it privately to the maintainer so it can
be fixed before disclosure.

Thanks for helping make WorldWrite better!
