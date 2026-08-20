/**
 * The `/codex` human command: `login` (browser flow), `login device`
 * (headless flow), `logout`, and `status`. Registered only when the
 * composition mounts the commands service (the shipped base bundle does).
 *
 * The command plane renders one result per command, so the login runs to
 * completion and returns its full transcript; the `auth_url` device-code
 * flows render their instructions through pi-ai's notify events. Users on
 * machines without a browser prefer the `dsh-codex-oauth` CLI bin, which
 * prints progress as it happens.
 *
 * @module dsh-codex-oauth/command
 */
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { FileCredentialStore } from './store.js';
import { CODEX_PROVIDER_ID } from './auth.js';
/**
 * Build the `/codex` command definition.
 * @param store - the credential store the command operates on.
 * @returns the command definition.
 */
export declare function codexCommand(store: FileCredentialStore): CommandDefinition;
export { CODEX_PROVIDER_ID };
