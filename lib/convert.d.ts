/**
 * Harness request/stream vocabulary conversion for the Codex adapter.
 *
 * The request half projects `GenerateOptions` history into pi-ai's `Context`
 * (text-only: image blocks are refused before conversion), treating every
 * historical assistant message as provider-neutral content. The stream half
 * translates pi-ai assistant events into harness `StreamChunk`s.
 *
 * Both halves are adapted from `@deepseek-ai/dsh-llm-pi-ai` (MIT, © DeepSeek
 * AI) — `context.ts` and `stream.ts` — with image attachment support and
 * provider-native replay state omitted.
 *
 * @module dsh-codex-oauth/convert
 */
import type { FinishReason, GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { AssistantMessage, AssistantMessageEvent, Context as PiContext, Usage as PiUsage } from '@earendil-works/pi-ai';
/**
 * Convert text-only harness history into a synchronous pi-ai `Context`.
 * Tool-result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @returns the pi-ai context.
 */
export declare function toCodexContext(options: GenerateOptions): PiContext;
/**
 * Map pi-ai usage to harness counts (pi-ai folds reasoning into output).
 * @param usage - cumulative usage from the terminal pi-ai event.
 * @returns harness counts; cache fields appear only when non-zero.
 */
export declare function mapUsage(usage: PiUsage): TokenUsage;
/**
 * Map a terminal pi-ai message to the harness finish reason.
 * @param message - the assistant message carried by the `done` or `error` event.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @returns the mapped harness reason.
 */
export declare function mapStopReason(message: AssistantMessage, contextWindow?: number): FinishReason;
/**
 * Translate the pi-ai event stream into harness `StreamChunk`s. pi-ai never
 * throws mid-stream — failures arrive as `error` events, which become
 * error/aborted `finish` chunks.
 * @param events - one assistant turn's pi-ai event stream.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @returns the harness chunks, ending with `usage` then `finish`; throws
 *   `LlmError` (`STREAM_CLOSED`) if the source ends without a terminal event.
 */
export declare function toStreamChunks(events: AsyncIterable<AssistantMessageEvent>, contextWindow?: number): AsyncGenerator<StreamChunk>;
