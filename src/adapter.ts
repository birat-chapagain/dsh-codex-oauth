/**
 * The Codex provider adapter: a `LlmAdapter` over one pi-ai `Models`
 * collection holding the `openai-codex` provider. OAuth credentials never
 * reach this class — pi-ai resolves and refreshes them from the store the
 * collection was built with, under its credential-store lock.
 *
 * @module dsh-codex-oauth/adapter
 */

import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type { Api, Model, Models, ThinkingLevel } from '@earendil-works/pi-ai'
import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ReasoningEffortId as ReasoningEffortIdType,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { CODEX_PROVIDER_ID } from './auth.js'
import { toCodexContext, toStreamChunks } from './convert.js'

/** Stream transport knobs shared by every model on the route. */
export interface CodexStreamOptions {
  transport: 'sse' | 'websocket' | 'websocket-cached' | 'auto'
  cacheRetention: 'none' | 'short' | 'long'
}

/**
 * Validate an explicit reasoning effort against the exact model, mirroring
 * the harness rule: unsupported levels reject before provider I/O; `off`
 * means "send nothing", which pi-ai expresses by omitting the option.
 * @param model - the resolved model.
 * @param effort - the requested level, or undefined for the provider default.
 * @returns the pi-ai thinking level, or undefined when none goes on the wire.
 */
function resolveReasoningLevel(model: Model<Api>, effort: ReasoningEffortIdType | undefined): ThinkingLevel | undefined {
  if (effort === undefined) return undefined
  const supported = model.reasoning ? getSupportedThinkingLevels(model) : []
  if (!supported.some(level => level === effort)) {
    throw new LlmError(
      `OpenAI Codex model "${model.id}" does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  return effort === 'off' ? undefined : effort as ThinkingLevel
}

/**
 * One route of the Codex provider, serving the models pi-ai's Codex catalog
 * ships (the `gpt-5.x-codex` family).
 */
export class CodexAdapter extends LlmAdapter {
  constructor(
    private readonly models: Models,
    private readonly provider: string,
    private readonly streamOptions: CodexStreamOptions,
  ) {
    super()
  }

  override providerInfo(): LlmProviderInfo {
    return { id: this.provider, name: 'OpenAI Codex' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models.getModels(CODEX_PROVIDER_ID).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: [...model.input],
    })))
  }

  override resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const resolved = this.models.getModel(CODEX_PROVIDER_ID, model)
      if (resolved === undefined) {
        throw new LlmError(`OpenAI Codex has no configured model "${model}"`, 'UNKNOWN_MODEL')
      }
      const levels = resolved.reasoning ? getSupportedThinkingLevels(resolved) : []
      return {
        provider,
        id: model,
        name: resolved.name,
        inputModalities: [...resolved.input],
        context: { contextWindow: resolved.contextWindow },
        ...levels.length === 0 ? {} : {
          reasoning: {
            efforts: levels.map(level => ({
              id: ReasoningEffortId(level),
              name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
            })),
          },
        },
      }
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('dsh-codex-oauth does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    options.signal?.throwIfAborted()
    const model = this.models.getModel(CODEX_PROVIDER_ID, options.model)
    if (model === undefined) {
      throw new LlmError(`OpenAI Codex has no configured model "${options.model}"`, 'UNKNOWN_MODEL')
    }
    if (options.messages.some(message => contentHasImage(message.content))) {
      throw new LlmError('dsh-codex-oauth does not support image input', 'UNSUPPORTED_CONTENT')
    }
    const reasoning = resolveReasoningLevel(model, options.reasoningEffort)
    const context = toCodexContext(options)
    const events = this.models.streamSimple(model, context, {
      ...this.streamOptions,
      // One adapter call is one SDK attempt; the agent recovery layer owns retries.
      maxRetries: 0,
      ...reasoning === undefined ? {} : { reasoning },
      ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
      signal: options.signal,
      headers: attributionHeaders(),
    })
    yield * toStreamChunks(events, model.contextWindow)
  }
}
