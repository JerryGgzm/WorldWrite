# Chrome Web Store — Privacy practices & permission justifications

The dashboard's **Privacy practices** tab asks you to justify each permission,
declare a single purpose, and disclose data usage. Paste these answers.

---

## Single purpose

```
WorldWrite lets users transform text they select inside web pages — translate, polish, rewrite, or understand it — using the user's own AI provider key, showing a preview before any text is replaced.
```

## Permission justifications

### `contextMenus`
```
Adds the "WorldWrite" right-click menu so the user can run an action (translate, polish, make professional, custom rewrite, explain, translate received message) on the text they selected.
```

### `storage`
```
Stores the user's own settings locally (language preferences, chosen AI provider/model, tone) and the user's API key in the extension's storage so requests can be made. No user-selected text or AI results are stored. API keys are read only by the background service worker and are never sent to web pages.
```

### Host permission: `<all_urls>`
```
Two reasons:
1) The content script must be able to run on any page so the user can transform text in any input field they choose.
2) The background must be able to send the selected text to whatever AI provider endpoint the user configures (e.g. api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, openrouter.ai, api.deepseek.com, or any custom OpenAI-compatible URL). Because the endpoint is user-configurable, a specific host list cannot be predeclared.
```

> Note: The extension does NOT request `tabs`, `activeTab`, or `scripting`. The
> content script is statically declared, and tab messaging uses only `tab.id`.

## Remote code

```
No. The extension does not load or execute any remote code. All scripts are bundled in the package. It only makes data API calls (fetch) to the AI provider the user configures.
```

---

## Data usage disclosures (checkboxes)

When asked "What user data do you collect or use?":

- **Personally identifiable information:** No
- **Health information:** No
- **Financial / payment information:** No
- **Authentication information:** **Yes** — the user's AI provider API key is
  stored locally on the device so requests can be authenticated. It is never
  transmitted to us; it is sent only to the user's chosen AI provider. We have no
  servers and do not receive any data.
- **Personal communications:** The text the user selects is sent to the user's
  chosen AI provider to perform the requested action. It is **not** collected,
  stored, or sent to the developer. Processing is transient.
- **Location, web history, user activity, website content (collected by us):** No

Certify all three statements:
- [x] I do not sell or transfer user data to third parties (outside approved use cases).
- [x] I do not use or transfer user data for purposes unrelated to the item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending.

## Privacy policy URL

A privacy policy is required because of the broad host permission and handling of
user-provided text/keys. Host `store/PRIVACY_POLICY.md` somewhere public (e.g.
GitHub Pages or your site) and paste that URL here.
