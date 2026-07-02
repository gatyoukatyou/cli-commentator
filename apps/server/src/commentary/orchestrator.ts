import type { CommentaryPayload, Event, Style } from "../types.js";
import type { ProviderName } from "../llm/types.js";
import { normalizeProviderName } from "../shared/validation.js";
import { createLLMAdapter } from "../llm/factory.js";
import type { LLMAdapter } from "../llm/adapter.js";
import { CommentError } from "../errors.js";
import { withTimeout } from "../utils/timeout.js";
import type { ProfileLLMProviders } from "../profile/types.js";
import { buildExplanationPrompt, buildNarrationPrompt, normalizeGeneratedCommentaryText } from "../styles/prompt.js";
import { commentByRules, isSuppressedCommentaryEvent, withCommentaryMode } from "./rule-based.js";

const COMMENT_TIMEOUT_MS = parseInt(process.env.COMMENT_TIMEOUT_MS ?? "3000", 10);
const adapterCache = new Map<ProviderName, LLMAdapter | null>();

// --- Logging ---
type CommentLogMeta = {
  provider: string;
  style: string;
  eventType: string;
};

function logComment(
  result: "ok" | "timeout" | "aborted" | "llm_error",
  durationMs: number,
  meta: CommentLogMeta
): void {
  const msg = `comment_${result} duration_ms=${durationMs} provider=${meta.provider} style=${meta.style} event=${meta.eventType}`;
  if (result === "ok") {
    if (process.env.DEBUG) console.log(msg);
  } else {
    console.warn(msg);
  }

}

function resolveCommentaryProviders(providers: ProfileLLMProviders = {}): {
  narrationProvider?: ProviderName;
  explanationProvider?: ProviderName;
} {
  const legacyProvider =
    normalizeProviderName(providers.llmProvider) ??
    normalizeProviderName(process.env.LLM_PROVIDER);

  return {
    narrationProvider: normalizeProviderName(providers.narrationProvider) ?? legacyProvider,
    explanationProvider: normalizeProviderName(providers.explanationProvider) ?? legacyProvider,
  };
}

function getAdapter(provider?: ProviderName): LLMAdapter | null {
  if (!provider || provider === "disabled") {
    return null;
  }

  const cached = adapterCache.get(provider);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const adapter = createLLMAdapter({
      ...process.env,
      LLM_PROVIDER: provider,
    });
    adapterCache.set(provider, adapter);
    return adapter;
  } catch {
    adapterCache.set(provider, null);
    return null;
  }
}

async function generateLLMText(
  adapter: LLMAdapter,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await adapter.generateText({
    messages: [{ role: "user", content: prompt }],
    signal,
  });

  const text = res.text?.trim();
  if (!text) {
    throw new CommentError("comment_llm_error", "Empty LLM response");
  }

  return text;
}

function providerLabel(narrationProvider?: ProviderName, explanationProvider?: ProviderName): string {
  return `${narrationProvider ?? "disabled"}/${explanationProvider ?? "disabled"}`;
}

async function commentInternal(
  ev: Event,
  style: Style,
  providers: ProfileLLMProviders = {},
  signal?: AbortSignal
): Promise<CommentaryPayload> {
  if (isSuppressedCommentaryEvent(ev)) {
    return commentByRules(ev, style);
  }

  const rules = commentByRules(ev, style);
  const resolvedProviders = resolveCommentaryProviders(providers);
  const narrationAdapter = getAdapter(resolvedProviders.narrationProvider);
  const explanationAdapter = getAdapter(resolvedProviders.explanationProvider);

  if (!narrationAdapter && !explanationAdapter) {
    return rules;
  }

  const [narration, explanation] = await Promise.all([
    narrationAdapter
      ? generateLLMText(narrationAdapter, buildNarrationPrompt(ev, style), signal)
          .then((text) => ({
            text: normalizeGeneratedCommentaryText(text, "narration"),
            provider: narrationAdapter.name,
          }))
          .catch(() => null)
      : Promise.resolve(null),
    explanationAdapter
      ? generateLLMText(explanationAdapter, buildExplanationPrompt(ev, style), signal)
          .then((text) => ({
            text: normalizeGeneratedCommentaryText(text, "explanation"),
            provider: explanationAdapter.name,
          }))
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  if ((!narrationAdapter || !narration) && (!explanationAdapter || !explanation)) {
    throw new CommentError("comment_llm_error", "All configured commentary providers failed");
  }

  return withCommentaryMode({
    narration: narration?.text ?? rules.narration,
    explanation: explanation?.text ?? rules.explanation,
    glossaryNotes: rules.glossaryNotes,
    meta: {
      narrationProvider: narration?.provider ?? rules.meta?.narrationProvider ?? "rules",
      explanationProvider: explanation?.provider ?? rules.meta?.explanationProvider ?? "rules",
    },
  });
}

/**
 * comment() with timeout protection and logging.
 * If LLM call takes longer than COMMENT_TIMEOUT_MS, abort and fallback to rules.
 */
export async function comment(
  ev: Event,
  style: Style,
  providers: ProfileLLMProviders = {}
): Promise<CommentaryPayload> {
  const resolvedProviders = resolveCommentaryProviders(providers);
  const narrationAdapter = getAdapter(resolvedProviders.narrationProvider);
  const explanationAdapter = getAdapter(resolvedProviders.explanationProvider);
  const meta: CommentLogMeta = {
    provider: providerLabel(
      resolvedProviders.narrationProvider,
      resolvedProviders.explanationProvider
    ),
    style,
    eventType: ev.type,
  };

  // ルールベースのみの場合はタイムアウト不要
  if (!narrationAdapter && !explanationAdapter) {
    return commentByRules(ev, style);
  }

  const controller = new AbortController();
  const start = Date.now();

  try {
    const result = await withTimeout(
      commentInternal(ev, style, providers, controller.signal),
      {
        ms: COMMENT_TIMEOUT_MS,
        timeoutError: () => new CommentError("comment_timeout"),
        onTimeout: () => controller.abort(),
      }
    );
    logComment("ok", Date.now() - start, meta);
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    if (err instanceof CommentError) {
      const resultType = err.code.replace("comment_", "") as "timeout" | "aborted" | "llm_error";
      logComment(resultType, duration, meta);
    } else {
      logComment("llm_error", duration, meta);
    }
    return commentByRules(ev, style);
  }
}
