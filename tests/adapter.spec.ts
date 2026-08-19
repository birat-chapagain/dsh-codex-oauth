import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type { AssistantMessageEvent, SimpleStreamOptions, Context as PiContext, Api, Model } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { CodexAdapter } from '../src/adapter.js'
import { CODEX_PROVIDER_ID } from '../src/auth.js'

interface CapturedStream {
  model: Model<Api>
  context: PiContext
  options: SimpleStreamOptions | undefined
}

let models: ReturnType<typeof createModels>
let captured: CapturedStream[]
let adapter: CodexAdapter

const STREAM_OPTIONS = { transport: 'auto' as const, cacheRetention: 'long' as const }

function firstModelId(): string {
  const [model] = models.getModels(CODEX_PROVIDER_ID)
  if (model === undefined) throw new Error('no codex models in catalog')
  return model.id
}

async function * terminalEventStream(): AsyncIterable<AssistantMessageEvent> {
  const [model] = models.getModels(CODEX_PROVIDER_ID)
  yield {
    type: 'done',
    reason: 'stop',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'streamed' }],
      api: 'openai-codex-responses',
      provider: CODEX_PROVIDER_ID,
      model: model!.id,
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 0,
    },
  } satisfies AssistantMessageEvent
}

function installStreamMock(): void {
  captured = []
  ;(models as unknown as {
    streamSimple: (model: Model<Api>, context: PiContext, options?: SimpleStreamOptions) => AsyncIterable<AssistantMessageEvent>
  }).streamSimple = (model, context, options) => {
    captured.push({ model, context, options })
    return terminalEventStream()
  }
}

beforeEach(() => {
  models = createModels()
  models.setProvider(openaiCodexProvider())
  installStreamMock()
  adapter = new CodexAdapter(models, 'codex', STREAM_OPTIONS)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'codex',
    model: firstModelId(),
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
    ...overrides,
  }
}

describe('CodexAdapter provider surface', () => {
  it('describes the provider route', () => {
    expect(adapter.providerInfo()).toEqual({ id: 'codex', name: 'OpenAI Codex' })
  })

  it('lists the pi-ai Codex catalog models', async () => {
    const listed = await adapter.listModels('codex')
    expect(listed.length).toBeGreaterThan(0)
    expect(listed[0]!.provider).toBe('codex')
    expect(listed.every(model => model.id.length > 0 && model.name.length > 0)).toBe(true)
  })

  it('resolves one model with context and reasoning metadata', async () => {
    const resolved = await adapter.resolveModel('codex', firstModelId())
    expect(resolved.provider).toBe('codex')
    expect(resolved.id).toBe(firstModelId())
    expect(resolved.context?.contextWindow).toBeGreaterThan(0)
    const [model] = models.getModels(CODEX_PROVIDER_ID)
    const expectedLevels = getSupportedThinkingLevels(model!)
    if (expectedLevels.length > 0) {
      expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(expectedLevels)
    }
  })

  it('refuses an unknown model with UNKNOWN_MODEL', async () => {
    await expect(adapter.resolveModel('codex', 'no-such-model')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
  })
})

describe('CodexAdapter.stream', () => {
  it('streams a text response as harness chunks', async () => {
    const chunks = []
    for await (const chunk of adapter.stream(request())) chunks.push(chunk)
    expect(chunks.find(chunk => chunk.type === 'text-delta')).toBeUndefined()
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(captured[0]!.context.systemPrompt).toBeUndefined()
    expect(captured[0]!.context.messages).toEqual([{ role: 'user', content: 'hi', timestamp: 0 }])
    expect(captured[0]!.options).toMatchObject({ maxRetries: 0, transport: 'auto', cacheRetention: 'long' })
  })

  it('passes the system prompt, session id, and max tokens through', async () => {
    const signal = new AbortController().signal
    const chunks = []
    for await (const chunk of adapter.stream(request({
      system: 'be terse',
      maxTokens: 512,
      sessionId: 'session-1' as never,
      signal,
    }))) chunks.push(chunk)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(captured[0]!.context.systemPrompt).toBe('be terse')
    expect(captured[0]!.options).toMatchObject({ maxTokens: 512, sessionId: 'session-1', signal })
  })

  it('refuses GenerateOptions.stop before provider I/O', async () => {
    const iterator = adapter.stream(request({ stop: ['never'] }))
    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    expect(captured).toHaveLength(0)
  })

  it('refuses image content before provider I/O', async () => {
    const options = request({
      messages: [{
        role: 'user',
        content: [{ type: 'image', attachment: 'att-1' }],
        source: { kind: 'user' },
      }] as never,
    })
    const iterator = adapter.stream(options)
    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(captured).toHaveLength(0)
  })

  it('refuses an unsupported reasoning effort before provider I/O', async () => {
    const iterator = adapter.stream(request({ reasoningEffort: 'xhigh' as never }))
    // xhigh is only offered when the catalog model supports it; assert either
    // acceptance or a typed refusal, never a silent provider call.
    const next = await iterator[Symbol.asyncIterator]().next().catch((error: unknown) => ({ error }))
    if ('error' in next) {
      expect(next.error).toBeInstanceOf(LlmError)
      expect((next.error as LlmError).code).toBe('UNSUPPORTED_REASONING_EFFORT')
      expect(captured).toHaveLength(0)
    } else {
      expect(captured).toHaveLength(1)
      expect(captured[0]!.options?.reasoning).toBe('xhigh')
    }
  })

  it('sends no reasoning option for the off level', async () => {
    const [model] = models.getModels(CODEX_PROVIDER_ID)
    if (!getSupportedThinkingLevels(model!).includes('off')) return
    const chunks = []
    for await (const chunk of adapter.stream(request({ reasoningEffort: 'off' as never }))) chunks.push(chunk)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(captured[0]!.options?.reasoning).toBeUndefined()
  })

  it('rejects an unknown model before provider I/O', async () => {
    const iterator = adapter.stream(request({ model: 'no-such-model' }))
    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    expect(captured).toHaveLength(0)
  })
})
