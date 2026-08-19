/**
 * Built-entry-path smoke for the CLI bin: runs `node lib/bin.js` as a child
 * process against a scratch store, proving the published artifact loads under
 * plain Node without a bundler or test hooks.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileCredentialStore } from '../src/store.js'

const exec = promisify(execFile)

let root: string | undefined
let storePath: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-codex-bin-'))
  storePath = join(root, 'codex-oauth.json')
})

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

function bin(args: readonly string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return exec(process.execPath, [join(process.cwd(), 'lib', 'bin.js'), ...args, '--store', storePath])
    .then(({ stdout, stderr }) => ({ stdout, stderr, code: 0 }))
    .catch((error: unknown) => {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        code: failure.code ?? 1,
      }
    })
}

describe('dsh-codex-oauth bin', () => {
  it('reports no credential before login', async () => {
    const { stdout, code } = await bin(['status'])
    expect(code).toBe(0)
    expect(stdout).toContain('No Codex credential stored')
  })

  it('reports the credential after it is stored', async () => {
    const store = new FileCredentialStore(storePath)
    await store.modify('openai-codex', async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1_800_000_000_000,
    }))
    const { stdout, code } = await bin(['status'])
    expect(code).toBe(0)
    expect(stdout).toContain('Codex logged in')
  })

  it('clears the credential on logout', async () => {
    const store = new FileCredentialStore(storePath)
    await store.modify('openai-codex', async () => ({
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: 1_800_000_000_000,
    }))
    const { stdout, code } = await bin(['logout'])
    expect(code).toBe(0)
    expect(stdout).toContain('Codex logged out')
    await expect(store.read('openai-codex')).resolves.toBeUndefined()
  })

  it('rejects unknown verbs with the usage exit code', async () => {
    const { code } = await bin(['frobnicate'])
    expect(code).toBe(2)
  })
})
