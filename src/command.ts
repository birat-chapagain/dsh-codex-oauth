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

import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import type { FileCredentialStore } from './store.js'
import { CODEX_PROVIDER_ID, login, logout, status } from './auth.js'

/**
 * Build the `/codex` command definition.
 * @param store - the credential store the command operates on.
 * @returns the command definition.
 */
export function codexCommand(store: FileCredentialStore): CommandDefinition {
  return {
    name: 'codex',
    description: 'Manage OpenAI Codex (ChatGPT Plus/Pro) OAuth login',
    input: { hint: 'login [device] | logout | status' },
    recordInput: false,
    handler: async ({ rawInput, signal }): Promise<CommandResult> => {
      const [verb, ...rest] = rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
      try {
        switch (verb) {
          case 'login':
          case undefined: {
            const device = rest.length > 0 && rest[0] === 'device'
            const lines: string[] = []
            await login({
              store,
              method: device ? 'device' : 'browser',
              openBrowser: !device,
              ...signal === undefined ? {} : { signal },
              reporter: { line: (text: string) => lines.push(text) },
            })
            return { kind: 'success', text: lines.join('\n') }
          }
          case 'logout': {
            await logout(store)
            return { kind: 'success', text: 'Codex logged out.' }
          }
          case 'status': {
            return { kind: 'success', text: (await status(store)).join('\n') }
          }
          default:
            return {
              kind: 'error',
              text: `Unknown /codex subcommand "${verb}"; use login [device], logout, or status.`,
            }
        }
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error)
        return { kind: 'error', text: `Codex ${verb ?? 'login'} failed: ${detail}` }
      }
    },
  }
}

export { CODEX_PROVIDER_ID }
