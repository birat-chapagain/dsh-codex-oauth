import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'
import { mapStopReason, mapUsage, toCodexContext, toStreamChunks } from '../src/convert.js'

function usage(overrides: Partial<AssistantMessage['usage']> = {}): AssistantMessage['usage'] {
  return {
    input: 10,
    output: 20,
    cacheRead: 3,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  }
}

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'hello' }],
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    model: 'gpt-5.4-codex',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
    ...overrides,
  }
}

describe('toCodexContext', () => {
  const tools = [{
    name: 'bash',
    description: 'run a command',
    parameters: { type: 'object', properties: {} },
  }]

  it('maps the system prompt and a plain user message', () => {
    const options = {
      provider: 'codex',
      model: 'gpt-5.4-codex',
      system: 'be terse',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
    } as GenerateOptions
    const context = toCodexContext(options)
    expect(context.systemPrompt).toBe('be terse')
    expect(context.messages).toEqual([{ role: 'user', content: 'hi', timestamp: 0 }])
    expect(context.tools).toBeUndefined()
  })

  it('maps assistant tool calls and recovers tool-result names', () => {
    const options = {
      provider: 'codex',
      model: 'gpt-5.4-codex',
      messages: [
        {
          role: 'assistant' as const,
          content: [{ type: 'tool-call' as const, id: 'call-1', name: 'bash', arguments: '{"command":"echo"}' }],
          source: { kind: 'model' as const, provider: 'codex', model: 'gpt-5.4-codex' },
        },
        {
          role: 'user' as const,
          content: [{ type: 'tool-result' as const, toolCallId: 'call-1', content: [{ type: 'text' as const, text: 'out' }] }],
          source: { kind: 'tool' as const },
        },
      ],
    } as unknown as GenerateOptions
    const context = toCodexContext(options)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'echo' } }],
    })
    expect(context.messages[1]).toEqual({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'bash',
      content: [{ type: 'text', text: 'out' }],
      isError: false,
      timestamp: 0,
    })
  })

  it('maps tool schemas and flattens multi-block text', () => {
    const options = {
      provider: 'codex',
      model: 'gpt-5.4-codex',
      tools,
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
        source: { kind: 'user' },
      })],
    } as GenerateOptions
    const context = toCodexContext(options)
    expect(context.messages).toEqual([{ role: 'user', content: 'ab', timestamp: 0 }])
    expect(context.tools).toEqual([{ name: 'bash', description: 'run a command', parameters: tools[0]!.parameters }])
  })

  it('rejects image content before conversion', () => {
    const options = {
      provider: 'codex',
      model: 'gpt-5.4-codex',
      messages: [{
        role: 'user' as const,
        content: [{ type: 'image' as const, attachment: 'att-1' }],
        source: { kind: 'user' as const },
      }],
    } as unknown as GenerateOptions
    expect(() => toCodexContext(options)).toThrow(/image input/)
  })
})

describe('mapUsage', () => {
  it('omits zero cache fields', () => {
    expect(mapUsage(usage())).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 })
  })
})

describe('mapStopReason', () => {
  it('maps a normal stop', () => {
    expect(mapStopReason(message())).toEqual({ kind: 'stop' })
  })

  it('maps an empty stop to EMPTY_RESPONSE', () => {
    expect(mapStopReason(message({ content: [] }))).toMatchObject({ kind: 'error', failure: { code: 'EMPTY_RESPONSE' } })
  })

  it('maps length to max-tokens', () => {
    expect(mapStopReason(message({ stopReason: 'length' }))).toEqual({ kind: 'max-tokens' })
  })

  it('maps toolUse to tool-calls', () => {
    expect(mapStopReason(message({ stopReason: 'toolUse' }))).toEqual({ kind: 'tool-calls' })
  })

  it('classifies rate-limit errors', () => {
    const reason = mapStopReason(message({ stopReason: 'error', errorMessage: '429 rate limit exceeded' }))
    expect(reason).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
  })

  it('maps a missing login to AUTH with recovery guidance', () => {
    const reason = mapStopReason(message({ stopReason: 'error', errorMessage: 'Provider is not configured: openai-codex' }))
    expect(reason).toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
    if (reason.kind === 'error') {
      expect(reason.failure.message).toContain('dsh-codex-oauth login')
    }
  })

  it('maps aborted', () => {
    const reason = mapStopReason(message({ stopReason: 'aborted', errorMessage: 'stopped' }))
    expect(reason).toMatchObject({ kind: 'aborted' })
  })

  it('maps a deferred terminal to an unexpected-end error', () => {
    const reason = mapStopReason(message({ stopReason: 'deferred' }))
    expect(reason).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR' } })
  })
})

/** Wrap a fixed event list as the async iterable `toStreamChunks` consumes. */
async function * streamOf(events: readonly AssistantMessageEvent[]): AsyncIterable<AssistantMessageEvent> {
  for (const event of events) yield event
}

describe('toStreamChunks', () => {
  it('translates text events into harness chunks ending in usage and finish', async () => {
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial: message() },
      { type: 'text_start', contentIndex: 0, partial: message() },
      { type: 'text_delta', contentIndex: 0, delta: 'he', partial: message() },
      { type: 'text_end', contentIndex: 0, content: 'he', partial: message() },
      { type: 'done', reason: 'stop', message: message({ content: [{ type: 'text', text: 'he' }] }) },
    ]
    const chunks = []
    for await (const chunk of toStreamChunks(streamOf(events))) chunks.push(chunk)
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'he' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'he' } },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('translates tool-call events with raw JSON arguments', async () => {
    const toolCall = {
      type: 'toolCall' as const,
      id: 'call-9',
      name: 'bash',
      arguments: { command: 'ls' },
    }
    const partial = message({ content: [toolCall] })
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial },
      { type: 'toolcall_start', contentIndex: 0, partial },
      { type: 'toolcall_delta', contentIndex: 0, delta: '', partial },
      { type: 'toolcall_end', contentIndex: 0, toolCall, partial },
      {
        type: 'done',
        reason: 'toolUse',
        message: message({ stopReason: 'toolUse', content: [toolCall] }),
      },
    ]
    const chunks = []
    for await (const chunk of toStreamChunks(streamOf(events))) chunks.push(chunk)
    const blockEnd = chunks.find(chunk => chunk.type === 'block-end')
    expect(blockEnd).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call-9', name: 'bash', arguments: '{"command":"ls"}' },
    })
    const finish = chunks.find(chunk => chunk.type === 'finish')
    expect(finish).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('translates in-stream errors into an error finish chunk', async () => {
    const events: AssistantMessageEvent[] = [
      {
        type: 'error',
        reason: 'error',
        error: message({ stopReason: 'error', errorMessage: '401 unauthorized' }),
      },
    ]
    const chunks = []
    for await (const chunk of toStreamChunks(streamOf(events))) chunks.push(chunk)
    const finish = chunks.find(chunk => chunk.type === 'finish')
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } })
  })

  it('throws STREAM_CLOSED when the source ends without a terminal event', async () => {
    const events: AssistantMessageEvent[] = [
      { type: 'start', partial: message() },
    ]
    const iterator = toStreamChunks(streamOf(events))
    await expect(async () => {
      for await (const _chunk of iterator) { /* drain */ }
    }).rejects.toMatchObject({ code: 'STREAM_CLOSED' })
  })
})
