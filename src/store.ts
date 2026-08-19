/**
 * File-backed pi-ai {@link CredentialStore} for Codex OAuth tokens.
 *
 * One JSON document under the Harness home holds one type-tagged credential
 * per pi-ai provider id (`openai-codex` today). Writes are atomic and
 * serialized through the cross-process writer lock of `dsh-atomic-write`, so
 * pi-ai's refresh-inside-`modify` contract cannot double-refresh a rotated
 * token across processes. The document is `0600` under a `0700` directory;
 * a POSIX document carrying group or other permission bits is refused before
 * its contents are read.
 *
 * @module dsh-codex-oauth/store
 */

import { readFile, stat, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** The on-disk document shape: provider id to its stored credential. */
type StoreDocument = Record<string, Credential>

/** Secure default permissions for the document and its directory. */
const FILE_MODE = 0o600
const DIR_MODE = 0o700

/**
 * One persistent {@link CredentialStore}, backed by a JSON document at `path`.
 * `modify` is the only write path, as the pi-ai contract requires, and every
 * mutation runs under the file's cross-process writer lock.
 */
export class FileCredentialStore implements CredentialStore {
  constructor(readonly path: string) {}

  /** Ensure the parent directory exists with owner-only permissions. */
  private async ensureDir(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE })
  }

  /** Read the whole document, refusing group/world-readable files on POSIX. */
  private async readDocument(): Promise<StoreDocument> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return {}
      throw error
    }
    if (process.platform !== 'win32') {
      const mode = (await stat(this.path)).mode
      if ((mode & 0o077) !== 0) {
        throw new Error(
          `dsh-codex-oauth: credential store ${this.path} is readable by other users;`
          + ' run `chmod 600` on it (it holds your Codex OAuth tokens)',
        )
      }
    }
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`dsh-codex-oauth: credential store at ${this.path} is not a JSON object`)
    }
    return parsed as StoreDocument
  }

  /** Persist one document atomically with owner-only permissions. */
  private async writeDocument(document: StoreDocument): Promise<void> {
    await writeFileAtomic(this.path, `${JSON.stringify(document, null, 2)}\n`, {
      mode: FILE_MODE,
      dirMode: DIR_MODE,
    })
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.readDocument())[providerId]
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(await this.readDocument()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    await this.ensureDir()
    return withFileLock(this.path, async () => {
      const document = await this.readDocument()
      const next = await fn(document[providerId])
      if (next === undefined) return document[providerId]
      document[providerId] = next
      await this.writeDocument(document)
      return next
    })
  }

  async delete(providerId: string): Promise<void> {
    await this.ensureDir()
    return withFileLock(this.path, async () => {
      const document = await this.readDocument()
      if (!(providerId in document)) return
      delete document[providerId]
      await this.writeDocument(document)
    })
  }
}
