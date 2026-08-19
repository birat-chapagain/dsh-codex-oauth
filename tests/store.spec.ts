import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileCredentialStore } from '../src/store.js'

let root: string | undefined
let path: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-codex-store-'))
  path = join(root, 'nested', 'codex-oauth.json')
})

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

const oauthCredential = {
  type: 'oauth',
  access: 'access-token',
  refresh: 'refresh-token',
  expires: 1_800_000_000_000,
} as const

describe('FileCredentialStore', () => {
  it('returns undefined for a missing store and a missing credential', async () => {
    const store = new FileCredentialStore(path)
    await expect(store.read('openai-codex')).resolves.toBeUndefined()
    await expect(store.list()).resolves.toEqual([])
  })

  it('persists a modified credential under 0600 in a 0700 directory', async () => {
    const store = new FileCredentialStore(path)
    await expect(store.modify('openai-codex', async () => oauthCredential)).resolves.toEqual(oauthCredential)
    await expect(store.read('openai-codex')).resolves.toEqual(oauthCredential)
    await expect(store.list()).resolves.toEqual([{ providerId: 'openai-codex', type: 'oauth' }])
    const fileMode = (await stat(path)).mode & 0o777
    expect(fileMode).toBe(0o600)
    const dirMode = (await stat(join(root!, 'nested'))).mode & 0o777
    expect(dirMode).toBe(0o700)
  })

  it('serializes concurrent modify calls without losing writes', async () => {
    const store = new FileCredentialStore(path)
    await Promise.all(Array.from({ length: 10 }, () => store.modify('counter', async (current) => {
      const count = current === undefined || typeof current !== 'object'
        ? 0
        : (current as { count?: number }).count ?? 0
      return { type: 'api_key', key: `k${count + 1}`, count: count + 1 }
    })))
    const credential = await store.read('counter')
    expect((credential as unknown as { count: number }).count).toBe(10)
  })

  it('deletes a credential and treats a repeat delete as a no-op', async () => {
    const store = new FileCredentialStore(path)
    await store.modify('openai-codex', async () => oauthCredential)
    await store.delete('openai-codex')
    await expect(store.read('openai-codex')).resolves.toBeUndefined()
    await expect(store.delete('openai-codex')).resolves.toBeUndefined()
  })

  it('keeps an unchanged credential when modify resolves undefined', async () => {
    const store = new FileCredentialStore(path)
    await store.modify('openai-codex', async () => oauthCredential)
    await store.modify('openai-codex', async () => undefined)
    await expect(store.read('openai-codex')).resolves.toEqual(oauthCredential)
  })

  it('refuses a document readable by other users on POSIX', async () => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{}', { mode: 0o644 })
    if (process.platform === 'win32') return
    const store = new FileCredentialStore(path)
    await expect(store.read('openai-codex')).rejects.toThrow(/chmod 600/)
  })

  it('refuses a document that is not a JSON object', async () => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '[1,2]', { mode: 0o600 })
    const store = new FileCredentialStore(path)
    await expect(store.read('openai-codex')).rejects.toThrow(/not a JSON object/)
  })

  it('round-trips the document verbatim through JSON', async () => {
    const store = new FileCredentialStore(path)
    await store.modify('openai-codex', async () => oauthCredential)
    const text = await readFile(path, 'utf8')
    expect(JSON.parse(text)).toEqual({ 'openai-codex': oauthCredential })
  })
})
