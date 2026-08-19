/**
 * The `/codex` command definition: handler behavior for every subcommand,
 * with pi-ai mocked so the login path never touches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuthInteraction } from '@earendil-works/pi-ai'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { codexCommand } from '../src/command.js'
import { FileCredentialStore } from '../src/store.js'

const fakeLogin = vi.hoisted(() => vi.fn())
const fakeSetProvider = vi.hoisted(() => vi.fn())

vi.mock('@earendil-works/pi-ai', () => ({
  createModels: () => ({ setProvider: fakeSetProvider, login: fakeLogin }),
}))

vi.mock('@earendil-works/pi-ai/providers/openai-codex', () => ({
  openaiCodexProvider: () => ({ id: 'openai-codex' }),
}))

const oauthCredential = {
  type: 'oauth',
  access: 'a',
  refresh: 'r',
  expires: 1_800_000_000_000,
} as const

let root: string
let store: FileCredentialStore
let definition: CommandDefinition

function invoke(rawInput: string, signal?: AbortSignal): ReturnType<CommandDefinition['handler']> {
  return definition.handler({
    commandId: CommandId('command-1'),
    agent: {} as never,
    rawInput,
    signal: signal ?? new AbortController().signal,
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-codex-cmd-'))
  store = new FileCredentialStore(join(root, 'codex-oauth.json'))
  definition = codexCommand(store)
  vi.clearAllMocks()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('codex command', () => {
  it('reports the stored credential state for status', async () => {
    await expect(invoke('status')).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('No Codex credential stored'),
    })
    await store.modify('openai-codex', async () => oauthCredential)
    await expect(invoke('status')).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('Codex logged in'),
    })
  })

  it('clears the credential for logout', async () => {
    await store.modify('openai-codex', async () => oauthCredential)
    await expect(invoke('logout')).resolves.toEqual({ kind: 'success', text: 'Codex logged out.' })
    await expect(store.read('openai-codex')).resolves.toBeUndefined()
  })

  it('runs the browser login for bare login', async () => {
    fakeLogin.mockImplementation(async (_provider: string, _type: string, _interaction: AuthInteraction) => oauthCredential)
    await expect(invoke('login')).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('login complete'),
    })
  })

  it('runs the device login for login device', async () => {
    fakeLogin.mockImplementation(async (_provider: string, _type: string, _interaction: AuthInteraction) => oauthCredential)
    await expect(invoke('login device')).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('login complete'),
    })
  })

  it('reports an unknown subcommand as an error result', async () => {
    await expect(invoke('frobnicate')).resolves.toEqual({
      kind: 'error',
      text: expect.stringContaining('Unknown /codex subcommand "frobnicate"'),
    })
  })

  it('reports a failed login as an error result', async () => {
    fakeLogin.mockRejectedValue(new Error('authorization expired'))
    await expect(invoke('login')).resolves.toEqual({
      kind: 'error',
      text: expect.stringContaining('authorization expired'),
    })
  })

  it('passes the invocation signal into the login flow', async () => {
    const controller = new AbortController()
    fakeLogin.mockImplementation(async (_provider: string, _type: string, interaction: AuthInteraction) => {
      expect(interaction.signal).toBe(controller.signal)
      return oauthCredential
    })
    await expect(invoke('login', controller.signal)).resolves.toMatchObject({ kind: 'success' })
  })
})
