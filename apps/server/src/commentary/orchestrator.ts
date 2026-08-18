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
import type { SessionContextSnapshot } from "../session-context.js";
import { applySpeechContract } from "./speech-policy.js";

export const COMMENT_TIMEOUT_MS = parseInt(process.env.COMMENT_TIMEOUT_MS ?? "3000", 10);
const adapterCache = new Map<ProviderName, LLMAdapter | null>();

// --- Logging ---
type CommentLogMeta = {
  provider: string;
  style: string;
  eventType: string;
};

export type CommentMeasurement = {
  result: "comment_ok" | "comment_timeout" | "comment_aborted" | "comment_llm_error";
  durationMs: number;
  provider: string;
  model: string;
  style: string;
  eventType: string;
  inputTokens: number;
  outputTokens: number;
};

export type CommentMeasurementObserver = (measurement: CommentMeasurement) => void;

function logComment(
  result: "ok" | "timeout" | "aborted" | "llm_error",
  durationMs: number,
  meta: CommentLogMeta,
  model: string,
  usage: { inputTokens?: number; outputTokens?: number } = {},
  observe?: CommentMeasurementObserver
): void {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const resultName = `comment_${result}` as CommentMeasurement["result"];
  const msg = `${resultName} duration_ms=${durationMs} provider=${meta.provider} model=${model} style=${meta.style} event=${meta.eventType} input_tokens=${inputTokens} output_tokens=${outputTokens}`;
  if (result === "ok") {
    if (process.env.DEBUG) console.log(msg);
  } else {
    console.warn(msg);
  }
  observe?.({
    result: resultName,
    durationMs,
    provider: meta.provider,
    model,
    style: meta.style,
    eventType: meta.eventType,
    inputTokens,
    outputTokens,
  });
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
): Promise<{ text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const res = await adapter.generateText({
    messages: [{ role: "user", content: prompt }],
    signal,
  });

  const text = res.text?.trim();
  if (!text) {
    throw new CommentError("comment_llm_error", "Empty LLM response");
  }

  return { text, model: res.model, usage: res.usage };
}

function providerLabel(narrationProvider?: ProviderName, explanationProvider?: ProviderName): string {
  return `${narrationProvider ?? "disabled"}/${explanationProvider ?? "disabled"}`;
}

function modelLabel(narrationModel?: string, explanationModel?: string): string {
  if (narrationModel && narrationModel === explanationModel) return narrationModel;
  if (narrationModel && explanationModel) return `${narrationModel}/${explanationModel}`;
  return narrationModel ?? explanationModel ?? "unknown";
}

async function commentInternal(
  ev: Event,
  style: Style,
  providers: ProfileLLMProviders = {},
  signal?: AbortSignal,
  context?: SessionContextSnapshot
): Promise<{
  payload: CommentaryPayload;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  if (isSuppressedCommentaryEvent(ev)) {
    return {
      payload: commentByRules(ev, style, context),
      model: "rules",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const rules = commentByRules(ev, style, context);
  const resolvedProviders = resolveCommentaryProviders(providers);
  const narrationAdapter = getAdapter(resolvedProviders.narrationProvider);
  const explanationAdapter = getAdapter(resolvedProviders.explanationProvider);

  if (!narrationAdapter && !explanationAdapter) {
    return {
      payload: rules,
      model: "rules",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const [narration, explanation] = await Promise.all([
    narrationAdapter
      ? generateLLMText(narrationAdapter, buildNarrationPrompt(ev, style, context), signal)
          .then((response) => ({
            text: normalizeGeneratedCommentaryText(response.text, "narration"),
            provider: narrationAdapter.name,
            model: response.model,
            usage: response.usage,
          }))
          .catch(() => null)
      : Promise.resolve(null),
    explanationAdapter
      ? generateLLMText(explanationAdapter, buildExplanationPrompt(ev, style, context), signal)
          .then((response) => ({
            text: normalizeGeneratedCommentaryText(response.text, "explanation"),
            provider: explanationAdapter.name,
            model: response.model,
            usage: response.usage,
          }))
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  if ((!narrationAdapter || !narration) && (!explanationAdapter || !explanation)) {
    throw new CommentError("comment_llm_error", "All configured commentary providers failed");
  }

  return {
    payload: withCommentaryMode({
      narration: narration?.text ?? rules.narration,
      explanation: explanation?.text ?? rules.explanation,
      glossaryNotes: rules.glossaryNotes,
      meta: {
        narrationProvider: narration?.provider ?? rules.meta?.narrationProvider ?? "rules",
        explanationProvider: explanation?.provider ?? rules.meta?.explanationProvider ?? "rules",
      },
    }),
    model: modelLabel(narration?.model, explanation?.model),
    usage: {
      inputTokens:
        (narration?.usage?.inputTokens ?? 0) + (explanation?.usage?.inputTokens ?? 0),
      outputTokens:
        (narration?.usage?.outputTokens ?? 0) + (explanation?.usage?.outputTokens ?? 0),
    },
  };
}

/**
 * comment() with timeout protection and logging.
 * If LLM call takes longer than COMMENT_TIMEOUT_MS, abort and fallback to rules.
 */
export async function comment(
  ev: Event,
  style: Style,
  providers: ProfileLLMProviders = {},
  context?: SessionContextSnapshot,
  observe?: CommentMeasurementObserver
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
    return applySpeechContract(commentByRules(ev, style, context), ev, context);
  }

  const controller = new AbortController();
  const start = Date.now();

  try {
    const result = await withTimeout(
      commentInternal(ev, style, providers, controller.signal, context),
      {
        ms: COMMENT_TIMEOUT_MS,
        timeoutError: () => new CommentError("comment_timeout"),
        onTimeout: () => controller.abort(),
      }
    );
    logComment("ok", Date.now() - start, meta, result.model, result.usage, observe);
    return applySpeechContract(result.payload, ev, context);
  } catch (err) {
    const duration = Date.now() - start;
    if (err instanceof CommentError) {
      const resultType = err.code.replace("comment_", "") as "timeout" | "aborted" | "llm_error";
      logComment(resultType, duration, meta, "unknown", {}, observe);
    } else {
      logComment("llm_error", duration, meta, "unknown", {}, observe);
    }
    return applySpeechContract(commentByRules(ev, style, context), ev, context);
  }
}
