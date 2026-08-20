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
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
/**
 * One persistent {@link CredentialStore}, backed by a JSON document at `path`.
 * `modify` is the only write path, as the pi-ai contract requires, and every
 * mutation runs under the file's cross-process writer lock.
 */
export declare class FileCredentialStore implements CredentialStore {
    readonly path: string;
    constructor(path: string);
    /** Ensure the parent directory exists with owner-only permissions. */
    private ensureDir;
    /** Read the whole document, refusing group/world-readable files on POSIX. */
    private readDocument;
    /** Persist one document atomically with owner-only permissions. */
    private writeDocument;
    read(providerId: string): Promise<Credential | undefined>;
    list(): Promise<readonly CredentialInfo[]>;
    modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
    delete(providerId: string): Promise<void>;
}
