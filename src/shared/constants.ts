import type {
  ApiFormat,
  DefaultBehavior,
  ProviderConfig,
  RewriteAction,
  SiteType,
  Tone,
  UserSettings,
} from "./types";

export const STORAGE_KEYS = {
  SETTINGS: "iaa_settings_v1",
  /** API keys are stored under this namespaced object keyed by providerId. */
  API_KEYS: "iaa_api_keys_v1",
  HISTORY: "iaa_history_v1",
  /** Last custom instruction; only written when privacyMode is off. */
  LAST_INSTRUCTION: "iaa_last_instruction_v1",
} as const;

/** Upper bound on a persisted custom instruction to avoid bloating storage. */
export const MAX_INSTRUCTION_LENGTH = 500;

/** Common languages offered as quick picks in the toolbar popup. */
export const COMMON_LANGUAGES = [
  "English",
  "Chinese",
  "Spanish",
  "French",
  "German",
  "Japanese",
  "Korean",
  "Portuguese",
  "Italian",
  "Russian",
  "Arabic",
  "Hindi",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Dutch",
  "Turkish",
  "Polish",
] as const;

/** Visible product name, used in the context menu root, popup, options, etc. */
export const APP_NAME = "WorldWrite";
export const APP_TAGLINE = "Write in your language. Be understood anywhere.";

export const CONTEXT_MENU_PARENT_ID = "iaa_root";

/** Actions for a message the user received: read-only, never replace anything. */
export const READ_ONLY_ACTIONS: RewriteAction[] = ["translate_to_native", "explain"];

export type ContextMenuEntry =
  | { kind: "separator"; id: string }
  | { kind: "action"; id: RewriteAction; titleTemplate: string };

// Flat, actionable, verb-first items. A separator divides the two intents:
//   1. Actions for text the user WROTE (replaces the selected text).
//   2. Actions for a message the user RECEIVED (read-only).
// {targetLanguage} / {nativeLanguage} are substituted with the user's settings.
export const CONTEXT_MENU_ITEMS: ContextMenuEntry[] = [
  { kind: "action", id: "translate", titleTemplate: "Translate my text to {targetLanguage}" },
  { kind: "action", id: "polish", titleTemplate: "Polish my {targetLanguage}" },
  {
    kind: "action",
    id: "make_professional",
    titleTemplate: "Make my {targetLanguage} more professional",
  },
  { kind: "action", id: "custom", titleTemplate: "Custom rewrite…" },
  { kind: "separator", id: "iaa_sep_1" },
  { kind: "action", id: "explain", titleTemplate: "Explain this message" },
  {
    kind: "action",
    id: "translate_to_native",
    titleTemplate: "Translate this message to {nativeLanguage}",
  },
];

/** Drives the modal: dynamic title, mode subtitle, and result labels. */
export interface ActionMeta {
  action: RewriteAction;
  title: string;
  subtitle: string;
  selectedLabel: string;
  resultLabel: string;
  incoming: boolean;
  canReplace: boolean;
}

const SUB_OUTGOING = "For text you wrote";
const SUB_INCOMING = "For a message you received";

export function getActionMeta(
  action: RewriteAction,
  langs: { targetLanguage: string; nativeLanguage: string },
): ActionMeta {
  const target = langs.targetLanguage || "the target language";
  const native = langs.nativeLanguage || "your language";
  switch (action) {
    case "translate":
      return outgoing(action, `Translate to ${target}`, "Translation");
    case "polish":
      return outgoing(action, `Polish ${target}`, "Suggestion");
    case "make_professional":
      return outgoing(action, `Make ${target} more professional`, "Suggestion");
    case "explain":
      return incoming(action, "Understand this message", "Meaning");
    case "translate_to_native":
      return incoming(action, `Translate to ${native}`, "Translation");
    case "custom":
    default:
      return outgoing(action, "Custom rewrite", "Suggestion");
  }
}

function outgoing(
  action: RewriteAction,
  title: string,
  resultLabel: string,
): ActionMeta {
  return {
    action,
    title,
    subtitle: SUB_OUTGOING,
    selectedLabel: "Selected text",
    resultLabel,
    incoming: false,
    canReplace: true,
  };
}

function incoming(
  action: RewriteAction,
  title: string,
  resultLabel: string,
): ActionMeta {
  return {
    action,
    title,
    subtitle: SUB_INCOMING,
    selectedLabel: "Selected message",
    resultLabel,
    incoming: true,
    canReplace: false,
  };
}

export const TONES: { value: Tone; label: string }[] = [
  { value: "natural", label: "Natural" },
  { value: "professional", label: "Professional" },
  { value: "concise", label: "Concise" },
  { value: "friendly", label: "Friendly" },
  { value: "direct", label: "Direct" },
  { value: "academic", label: "Academic" },
  { value: "casual", label: "Casual" },
];

export const BEHAVIORS: { value: DefaultBehavior; label: string }[] = [
  { value: "preserve_meaning_strictly", label: "Preserve meaning strictly" },
  { value: "fix_grammar_only", label: "Fix grammar only" },
  { value: "rewrite_naturally", label: "Rewrite naturally" },
  { value: "translate_naturally", label: "Translate naturally" },
  { value: "translate_literally", label: "Translate literally" },
];

/**
 * Tone / context hints injected into the prompt for known sites. These are only
 * used for phrasing guidance and never sent as page content.
 */
export const SITE_PROMPT_HINTS: Record<SiteType, string> = {
  linkedin:
    "Use a professional, warm, concise tone. Avoid sounding overly salesy.",
  email: "Use a polite, clear, professional tone.",
  slack: "Use a concise, natural, conversational tone.",
  github: "Use a precise, technical, clear tone.",
  twitter: "Use a casual, concise, engaging tone.",
  generic: "",
};

/** Maps hostname fragments to a SiteType for tone adaptation. */
export const SITE_HOST_MAP: { match: RegExp; site: SiteType }[] = [
  { match: /mail\.google\.com|outlook\.(live|office)\.com|mail\.proton\.me/, site: "email" },
  { match: /linkedin\.com/, site: "linkedin" },
  { match: /slack\.com/, site: "slack" },
  { match: /github\.com/, site: "github" },
  { match: /(twitter|x)\.com/, site: "twitter" },
];

export const DEFAULT_PROVIDER: ProviderConfig = {
  providerId: "openai",
  displayName: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiFormat: "openai-compatible",
};

/** Presets that pre-fill the base URL and API format for popular providers. */
export const PROVIDER_PRESETS: {
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  apiFormat: ApiFormat;
  /** Whether this preset is currently selectable in the options dropdown. */
  enabled: boolean;
}[] = [
  { providerId: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiFormat: "openai-compatible", enabled: true },
  { providerId: "anthropic", displayName: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", apiFormat: "anthropic", enabled: true },
  { providerId: "gemini", displayName: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash", apiFormat: "gemini", enabled: true },
  { providerId: "openrouter", displayName: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4.5", apiFormat: "openai-compatible", enabled: true },
  { providerId: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiFormat: "openai-compatible", enabled: true },
  { providerId: "groq", displayName: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", apiFormat: "openai-compatible", enabled: false },
  { providerId: "together", displayName: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", apiFormat: "openai-compatible", enabled: false },
  { providerId: "ollama", displayName: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "llama3.1", apiFormat: "openai-compatible", enabled: false },
  { providerId: "lmstudio", displayName: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", model: "local-model", apiFormat: "openai-compatible", enabled: false },
  { providerId: "litellm", displayName: "LiteLLM", baseUrl: "http://localhost:4000/v1", model: "gpt-4o-mini", apiFormat: "openai-compatible", enabled: false },
];

/** Where each provider lets the user create an API key (for the options page). */
export const PROVIDER_KEY_HELP: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
  openrouter: "https://openrouter.ai/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  groq: "https://console.groq.com/keys",
  together: "https://api.together.ai/settings/api-keys",
};

export const DEFAULT_SETTINGS: UserSettings = {
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  defaultTone: "natural",
  defaultBehavior: "rewrite_naturally",
  activeProviderId: DEFAULT_PROVIDER.providerId,
  providers: [DEFAULT_PROVIDER],
  privacyMode: true,
  contextAwareMode: false,
  saveLocalHistory: false,
  sessionOnlyKey: false,
};

/** Request timeout before the UI offers retry/cancel, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 15_000;

export const MAX_SELECTION_LENGTH = 12_000;
