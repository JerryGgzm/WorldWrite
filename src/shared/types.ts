// Shared type definitions used across background, content and options contexts.

export type RewriteAction =
  | "translate"
  | "translate_to_native"
  | "explain"
  | "polish"
  | "fix_grammar"
  | "make_professional"
  | "make_concise"
  | "custom";

export type SiteType =
  | "email"
  | "linkedin"
  | "slack"
  | "github"
  | "twitter"
  | "generic";

export type Tone =
  | "natural"
  | "professional"
  | "concise"
  | "friendly"
  | "direct"
  | "academic"
  | "casual";

export type DefaultBehavior =
  | "preserve_meaning_strictly"
  | "fix_grammar_only"
  | "rewrite_naturally"
  | "translate_naturally"
  | "translate_literally";

export type ApiFormat = "openai-compatible" | "anthropic" | "gemini";

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  baseUrl: string;
  /**
   * API key is NEVER persisted inside this object. It is stored separately by
   * KeyStorage and merged in only at request time inside the background worker.
   */
  apiKey?: string;
  model: string;
  apiFormat: ApiFormat;
}

export interface UserSettings {
  nativeLanguage: string;
  targetLanguage: string;
  defaultTone: Tone;
  defaultBehavior: DefaultBehavior;
  /** Currently selected provider id. */
  activeProviderId: string;
  /** Provider configs without the API key. */
  providers: ProviderConfig[];
  /**
   * When true (default) nothing is stored and no context beyond the selected
   * text is ever sent to the provider.
   */
  privacyMode: boolean;
  /** Only meaningful when privacyMode is false. */
  contextAwareMode: boolean;
  /** Only meaningful when privacyMode is false. */
  saveLocalHistory: boolean;
  /**
   * When true, the API key is only held in the in-memory session and never
   * written to chrome.storage.local.
   */
  sessionOnlyKey: boolean;
}

export interface PromptInput {
  selectedText: string;
  action: RewriteAction;
  nativeLanguage: string;
  targetLanguage: string;
  tone?: Tone;
  customInstruction?: string;
  strictMeaningPreservation: boolean;
  siteType?: SiteType;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

/** The minimal, privacy-safe payload the content script hands to the worker. */
export interface RewritePayload {
  selectedText: string;
  action: RewriteAction;
  customInstruction?: string;
  /** Detected from the active tab's hostname, used only for tone hints. */
  siteType?: SiteType;
}

export type RewriteState =
  | "idle"
  | "selection-captured"
  | "loading"
  | "preview"
  | "follow-up-loading"
  | "replaced"
  | "cancelled"
  | "error";

// ---- Messaging contracts -------------------------------------------------

export const MSG = {
  REWRITE_REQUEST: "REWRITE_REQUEST",
  CANCEL_REQUEST: "CANCEL_REQUEST",
  TEST_CONNECTION: "TEST_CONNECTION",
  CONTEXT_MENU_ACTION: "CONTEXT_MENU_ACTION",
  OPEN_OPTIONS: "OPEN_OPTIONS",
  PING_CONTENT: "PING_CONTENT",
  GET_LAST_INSTRUCTION: "GET_LAST_INSTRUCTION",
  SET_LAST_INSTRUCTION: "SET_LAST_INSTRUCTION",
} as const;

export interface RewriteRequestMessage {
  type: typeof MSG.REWRITE_REQUEST;
  requestId: string;
  payload: RewritePayload;
}

export interface CancelRequestMessage {
  type: typeof MSG.CANCEL_REQUEST;
  requestId: string;
}

export interface TestConnectionMessage {
  type: typeof MSG.TEST_CONNECTION;
  provider: ProviderConfig;
  /** Provided directly from the options page, never persisted unless saved. */
  apiKey: string;
}

export interface ContextMenuActionMessage {
  type: typeof MSG.CONTEXT_MENU_ACTION;
  action: RewriteAction;
  /** True when triggered by a keyboard shortcut (delivered to all frames). */
  viaShortcut?: boolean;
  /** Resolved from settings so the content script can title the modal. */
  targetLanguage?: string;
  nativeLanguage?: string;
}

export interface OpenOptionsMessage {
  type: typeof MSG.OPEN_OPTIONS;
}

export interface GetLastInstructionMessage {
  type: typeof MSG.GET_LAST_INSTRUCTION;
}

export interface SetLastInstructionMessage {
  type: typeof MSG.SET_LAST_INSTRUCTION;
  instruction: string;
}

export type RuntimeMessage =
  | RewriteRequestMessage
  | CancelRequestMessage
  | TestConnectionMessage
  | ContextMenuActionMessage
  | OpenOptionsMessage
  | GetLastInstructionMessage
  | SetLastInstructionMessage
  | { type: typeof MSG.PING_CONTENT };

export interface LastInstructionResponse {
  value: string;
}

export interface RewriteSuccess {
  ok: true;
  requestId: string;
  text: string;
}

export interface RewriteFailure {
  ok: false;
  requestId?: string;
  errorCode: string;
  message: string;
}

export type RewriteResponse = RewriteSuccess | RewriteFailure;

export interface TestConnectionResponse {
  ok: boolean;
  message: string;
}
