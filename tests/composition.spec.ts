/**
 * Real-composition test: the Cordis Loader boots a cordis.yml mounting the
 * real dsh-llm service beside this plugin (built lib/), with only the pi-ai
 * provider SDK mocked. Asserts the adapter registers its route, streams
 * through the seam, and unregisters on disposal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantMessageEvent, Model, Api, Context as PiContext, SimpleStreamOptions } from '@earendil-works/pi-ai'
import * as codexPlugin from '../lib/index.js'
import { FileCredentialStore } from '../src/store.js'
import { codexCommand } from '../src/command.js'

const hoisted = vi.hoisted(() => ({
  streamCalls: [] as Array<{ model: Model<Api>; context: PiContext; options: SimpleStreamOptions | undefined }>,
}))

vi.mock('@earendil-works/pi-ai', () => ({
  isContextOverflow: () => false,
  createModels: () => ({
    setProvider: vi.fn(),
    getModel: (_provider: string, model: string) => ({
      id: model,
      name: 'GPT-5.4 Codex',
      input: ['text'],
      contextWindow: 400_000,
      reasoning: false,
    }),
    getModels: (_provider: string) => [{
      id: 'gpt-5.4-codex',
      name: 'GPT-5.4 Codex',
      input: ['text'],
      contextWindow: 400_000,
      reasoning: false,
    }],
    streamSimple: (model: Model<Api>, context: PiContext, options?: SimpleStreamOptions): AsyncIterable<AssistantMessageEvent> => {
      hoisted.streamCalls.push({ model, context, options })
      return (async function* () {
        yield {
          type: 'done',
          reason: 'stop',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Loader composed' }],
            api: 'openai-codex-responses',
            provider: 'openai-codex',
            model: model.id,
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
      })()
    },
  }),
}))

vi.mock('@earendil-works/pi-ai/providers/openai-codex', () => ({
  openaiCodexProvider: () => ({ id: 'openai-codex' }),
}))

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  hoisted.streamCalls.length = 0
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-codex-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: 'dsh-codex-oauth'",
    '  config:',
    '    provider: codex',
    `    storePath: '${join(root, 'codex-oauth.json').replaceAll('\\', '/')}'`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['dsh-codex-oauth', codexPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('dsh-codex-oauth Loader composition', () => {
  it('registers the codex route and streams through the LLM seam', async () => {
    context = await loadComposition()
    expect(context.llm.listProviders()).toContainEqual({ id: 'codex', name: 'OpenAI Codex' })
    expect(await context.llm.listModels('codex')).toEqual([{
      provider: 'codex',
      id: 'gpt-5.4-codex',
      name: 'GPT-5.4 Codex',
      inputModalities: ['text'],
    }])

    const chunks: StreamChunk[] = []
    for await (const chunk of context.llm.stream({
      provider: 'codex',
      model: 'gpt-5.4-codex',
      system: 'compose',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })],
    })) chunks.push(chunk)

    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } })
    expect(hoisted.streamCalls).toHaveLength(1)
    expect(hoisted.streamCalls[0]!.context).toEqual({
      systemPrompt: 'compose',
      messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
    })
  })

  it('rejects a duplicate adapter for the owned route', async () => {
    context = await loadComposition()
    class Usurper extends LlmAdapter {
      async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        // never reached
      }
    }
    expect(() => context!.llm.registerAdapter(['codex'], new Usurper())).toThrow(/already registered/)
  })

  it('does not require the commands service', async () => {
    context = await loadComposition()
    expect(context.get('commands')).toBeUndefined()
    expect(context.llm.listProviders()).toContainEqual({ id: 'codex', name: 'OpenAI Codex' })
  })

  it('registers the /codex command when the commands service is mounted', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-codex-cmds-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: 'dsh-codex-oauth'",
      '  config:',
      '    provider: codex',
      `    storePath: '${join(root, 'codex-oauth.json').replaceAll('\\', '/')}'`,
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['dsh-codex-oauth', codexPlugin],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    // The plugin registered `codex`; a second registration of the same name
    // in the same scope must be rejected — proving the effect ran.
    expect(() => context!.commands.register(codexCommand(new FileCredentialStore(join(root!, 'other.json')))))
      .toThrow(/already registered/)
    expect(context!.llm.listProviders()).toContainEqual({ id: 'codex', name: 'OpenAI Codex' })
  })
})
