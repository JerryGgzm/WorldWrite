# Chrome Web Store — Submission checklist

## 0. One-time setup
- [ ] A Chrome Web Store **developer account** (one-time **$5** registration fee).
- [ ] Decide the publisher name shown on the listing.

## 1. Package the build
The store needs a ZIP of the **built** extension (the `dist/` folder), not the
source.

```bash
npm run build
cd dist && zip -r ../worldwrite.zip . && cd ..
```

Upload `worldwrite.zip`. (`dist/manifest.json` must be at the ZIP root — the
command above does that.)

- [ ] `worldwrite.zip` created from `dist/`
- [ ] manifest version bumped if this is an update (`package.json` `version`)

## 2. Graphic assets

| Asset | Size | Required? | Status |
|---|---|---|---|
| Store icon | **128×128** PNG | Required | ✅ `dist/icons/icon-128.png` |
| Screenshots | **1280×800** PNG | **At least 1** (up to 5) | ✅ 4 ready in `store/screenshots/out/` |
| Small promo tile | **440×280** PNG/JPEG | Optional (recommended) | ✅ `store/screenshots/out/ww-tile-440x280.png` |
| Marquee promo tile | **1400×560** PNG/JPEG | Optional | ✅ `store/screenshots/out/ww-marquee-1400x560.png` |

### Screenshots (ready — `store/screenshots/out/`)
Captured from the real overlay UI at exactly 1280×800:
1. `ww-01-translate.png` — hero: translate your text → English.
2. `ww-02-menu.png` — right-click menu, two clear sections.
3. `ww-03-explain.png` — "Understand this message" (read-only).
4. `ww-04-refine.png` — refine pills + composer + "Show changes" diff.

To regenerate or tweak captions, see `store/screenshots/README.md`.
- Avoid showing any real API key (the mocks contain none).

## 3. Store listing fields
- [ ] Name (≤45) — see `STORE_LISTING.md`
- [ ] Summary (≤132) — see `STORE_LISTING.md`
- [ ] Detailed description — see `STORE_LISTING.md`
- [ ] Category: **Productivity**
- [ ] Language: English

## 4. Privacy tab
- [ ] Single purpose — see `PERMISSIONS_JUSTIFICATION.md`
- [ ] Justify `contextMenus`, `storage`, host `<all_urls>` — same file
- [ ] "Uses remote code?" → **No**
- [ ] Data usage disclosures — same file
- [ ] Certify the 3 data-use statements
- [ ] **Privacy policy URL** — host `PRIVACY_POLICY.md` publicly and paste the URL
      (e.g. GitHub Pages). Required.

## 5. Distribution
- [ ] Visibility: Public / Unlisted (your choice)
- [ ] Regions: all or selected
- [ ] Pricing: Free

## 6. Before you click "Submit for review"
- [ ] Reinstall `dist/` unpacked once more and smoke-test: translate, polish,
      explain, replace, options save + test connection, popup.
- [ ] Confirm only `contextMenus` + `storage` + host `<all_urls>` are requested.
- [ ] Replace the contact email in `PRIVACY_POLICY.md` and the security contact
      link in `.github/ISSUE_TEMPLATE/config.yml`.
- [ ] Set the GitHub repo URL in the listing's "Open source" line if public.

## Notes
- Review usually takes from a few hours to a few business days. Broad host
  permissions (`<all_urls>`) can lengthen review — the justification text is
  written to address this.
- Keep the source tag/commit that matches the uploaded ZIP for reproducibility.
```
