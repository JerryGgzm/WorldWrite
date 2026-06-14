import { SITE_PROMPT_HINTS, TONES } from "@/shared/constants";
import type { BuiltPrompt, PromptInput, RewriteAction, Tone } from "@/shared/types";

const COMMON_CONSTRAINTS = [
  "Preserve the user's original meaning.",
  "Do not add new facts.",
  "Do not remove important details.",
  "Do not invent context.",
  "Return only the rewritten text.",
  "Do not include explanations unless explicitly requested.",
  "Do not wrap the output in quotes or markdown code fences.",
];

function toneLabel(tone: Tone | undefined): string {
  if (!tone) return "Natural";
  const found = TONES.find((t) => t.value === tone);
  return found ? found.label : "Natural";
}

/** Guards against ever emitting `undefined`/`null` in the prompt text. */
function safe(value: string | undefined | null, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function siteHint(input: PromptInput): string {
  if (!input.siteType) return "";
  const hint = SITE_PROMPT_HINTS[input.siteType];
  return hint ? hint : "";
}

function strictLine(input: PromptInput): string {
  return input.strictMeaningPreservation
    ? "You must not change the meaning under any circumstances."
    : "";
}

function joinLines(lines: (string | undefined | null)[]): string {
  return lines
    .map((l) => (l ?? "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

function buildPolish(input: PromptInput): string {
  const target = safe(input.targetLanguage, "the target language");
  return joinLines([
    "You are an inline writing assistant for non-native speakers.",
    "",
    "Task:",
    `Rewrite the selected text to sound natural, fluent, and context-appropriate in ${target}.`,
    "",
    "Rules:",
    "- Preserve the user's original meaning.",
    "- Do not add new facts.",
    "- Do not remove important details.",
    "- Do not make the tone overly formal unless requested.",
    "- Keep the user's intent.",
    "- Return only the rewritten text.",
    strictLine(input),
    siteHint(input) && `- Context: ${siteHint(input)}`,
    "",
    "Tone:",
    toneLabel(input.tone),
  ]);
}

function buildTranslate(input: PromptInput): string {
  const native = safe(input.nativeLanguage, "the source language");
  const target = safe(input.targetLanguage, "the target language");
  return joinLines([
    "You are a precise translation assistant.",
    "",
    "Task:",
    `Translate the selected text from ${native} to ${target}.`,
    "",
    "Rules:",
    "- Preserve the meaning, intent, and level of formality.",
    "- Make the translation sound natural to a native speaker.",
    "- Do not add new facts.",
    "- Do not remove important details.",
    "- Return only the translated text.",
    strictLine(input),
    siteHint(input) && `- Context: ${siteHint(input)}`,
  ]);
}

function buildTranslateToNative(input: PromptInput): string {
  const native = safe(input.nativeLanguage, "the user's native language");
  const extra = (input.customInstruction ?? "").trim();
  return joinLines([
    "You are a precise translation assistant.",
    "",
    "Task:",
    `Detect the language of the selected text and translate it into ${native}.`,
    "",
    "Rules:",
    "- Preserve the meaning, intent, and level of formality.",
    `- Make the translation sound natural to a native ${native} speaker.`,
    `- If the text is already in ${native}, return it unchanged.`,
    "- Do not add new facts.",
    "- Do not remove important details.",
    "- Do not add explanations or transliterations.",
    "- Return only the translated text.",
    extra && `- Additional instruction from the reader: ${extra}`,
    strictLine(input),
  ]);
}

function buildExplain(input: PromptInput): string {
  const native = safe(input.nativeLanguage, "the user's native language");
  const extra = (input.customInstruction ?? "").trim();
  return joinLines([
    "You are a helpful communication assistant.",
    "",
    "Task:",
    `Explain, in ${native}, what the selected message means.`,
    "Clarify the intent, tone, and any nuance or implied meaning so the reader fully understands it.",
    "",
    "Rules:",
    "- Be concise and clear.",
    `- Write the explanation in ${native}.`,
    "- Explain the meaning rather than translating word-for-word.",
    "- Do not add new facts or claims that are not supported by the message.",
    extra && `- Additional instruction from the reader: ${extra}`,
  ]);
}

function buildFixGrammar(input: PromptInput): string {
  return joinLines([
    "You are a grammar correction assistant.",
    "",
    "Task:",
    "Fix only grammar, spelling, and punctuation issues in the selected text.",
    "",
    "Rules:",
    "- Do not rewrite the style.",
    "- Do not change the meaning.",
    "- Do not add or remove information.",
    "- Preserve the user's wording as much as possible.",
    "- Return only the corrected text.",
    strictLine(input),
  ]);
}

function buildProfessional(input: PromptInput): string {
  const target = safe(input.targetLanguage, "the target language");
  return joinLines([
    "You are an inline writing assistant for non-native speakers.",
    "",
    "Task:",
    `Rewrite the selected text to sound more professional and polished in ${target}.`,
    "",
    "Rules:",
    ...COMMON_CONSTRAINTS.map((c) => `- ${c}`),
    "- Keep it professional but not stiff or robotic.",
    strictLine(input),
    siteHint(input) && `- Context: ${siteHint(input)}`,
  ]);
}

function buildConcise(input: PromptInput): string {
  const target = safe(input.targetLanguage, "the target language");
  return joinLines([
    "You are an inline writing assistant for non-native speakers.",
    "",
    "Task:",
    `Rewrite the selected text to be more concise and clear in ${target}.`,
    "",
    "Rules:",
    ...COMMON_CONSTRAINTS.map((c) => `- ${c}`),
    "- Remove redundancy without dropping important details.",
    strictLine(input),
    siteHint(input) && `- Context: ${siteHint(input)}`,
  ]);
}

function buildCustom(input: PromptInput): string {
  const instruction = safe(
    input.customInstruction,
    "Improve the selected text while keeping its meaning.",
  );
  return joinLines([
    "You are an inline writing assistant.",
    "",
    "User instruction:",
    instruction,
    "",
    "Rules:",
    "- Follow the user's instruction.",
    "- Preserve the original meaning unless the user explicitly asks to change it.",
    "- Do not add unsupported facts.",
    "- Do not invent context.",
    "- Return only the revised text.",
    "- Do not wrap the output in quotes or markdown code fences.",
    siteHint(input) && `- Context: ${siteHint(input)}`,
  ]);
}

const BUILDERS: Record<RewriteAction, (i: PromptInput) => string> = {
  translate: buildTranslate,
  translate_to_native: buildTranslateToNative,
  explain: buildExplain,
  polish: buildPolish,
  fix_grammar: buildFixGrammar,
  make_professional: buildProfessional,
  make_concise: buildConcise,
  custom: buildCustom,
};

/**
 * Builds a stable system/user prompt pair for the given action. The system
 * prompt carries the task and constraints; the user prompt carries only the
 * selected text. Output is guaranteed to never contain `undefined`/`null`.
 */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const builder = BUILDERS[input.action] ?? buildPolish;
  const system = builder(input);
  const selected = safe(input.selectedText, "");
  const user = `Selected text:\n${selected}`;
  return { system, user };
}
