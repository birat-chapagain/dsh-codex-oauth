/**
 * Codex OAuth operations: login, status, and logout, driven through pi-ai's
 * provider-owned OAuth flows. The CLI bin and the `/codex` slash command both
 * call these; only the reporter differs.
 *
 * pi-ai owns the wire protocol (authorization-code flow with a local callback
 * server, device-code flow for headless machines, and refresh-token exchange).
 * This module owns the human interaction: selecting the login method and
 * rendering progress. Tokens land in the {@link FileCredentialStore} through
 * `Models.login`, and pi-ai refreshes them automatically on request paths.
 *
 * @module dsh-codex-oauth/auth
 */

import { spawn } from 'node:child_process'
import { createModels } from '@earendil-works/pi-ai'
import type { AuthInteraction, AuthPrompt, AuthEvent } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import type { FileCredentialStore } from './store.js'

/** pi-ai's provider id for OpenAI Codex (ChatGPT Plus/Pro). */
export const CODEX_PROVIDER_ID = 'openai-codex'

/** The two Codex login methods pi-ai's flow offers. */
export type LoginMethod = 'browser' | 'device'

/** Human-facing sink for login progress and results. */
export interface LoginReporter {
  /** Append one progress or result line. */
  line(text: string): void
  /** Open a URL in the desktop browser; only https URLs are ever offered. */
  openUrl?(url: string): void
}

/** Shared options for {@link login}. */
export interface LoginOptions {
  store: FileCredentialStore
  method: LoginMethod
  openBrowser: boolean
  signal?: AbortSignal
  reporter: LoginReporter
}

/** Open `url` in the desktop browser, detached from this process. */
export function openUrlInBrowser(url: string, reporter?: LoginReporter): void {
  // Only provider-issued https URLs are ever candidates; refuse anything else
  // rather than handing an untrusted string to the shell.
  if (!url.startsWith('https://')) {
    reporter?.line(`dsh-codex-oauth: refusing to open non-https URL`)
    return
  }
  // Embedders supply their own opener; standalone callers spawn the OS one.
  if (reporter?.openUrl !== undefined) {
    reporter.openUrl(url)
    return
  }
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { stdio: 'ignore', detached: true }).unref()
}

/**
 * Answer one login-method prompt from the configured method, tolerating
 * label renames in later pi-ai versions by matching text rather than ids.
 * @param prompt - the select prompt pi-ai issued.
 * @param method - the configured method.
 * @returns the matching option id, falling back to the first option.
 */
export function answerMethodPrompt(prompt: Extract<AuthPrompt, { type: 'select' }>, method: LoginMethod): string {
  const wanted = method === 'device' ? /device/i : /browser/i
  const option = prompt.options.find(entry => wanted.test(entry.label))
  return option?.id ?? prompt.options[0]?.id ?? ''
}

/** Translate pi-ai's notify events into human-facing lines. */
function notify(event: AuthEvent, reporter: LoginReporter, openBrowser: boolean): void {
  switch (event.type) {
    case 'info':
      reporter.line(event.message)
      for (const link of event.links ?? []) reporter.line(`${link.label ?? 'More information'}: ${link.url}`)
      break
    case 'auth_url':
      if (openBrowser) openUrlInBrowser(event.url, reporter)
      reporter.line(`Complete the login in your browser window.`)
      reporter.line(`If no window opened, open this URL yourself: ${event.url}`)
      break
    case 'device_code':
      reporter.line(`Open ${event.verificationUri} on any device and enter this code: ${event.userCode}`)
      reporter.line(`The code expires in ${event.expiresInSeconds} seconds.`)
      break
    case 'progress':
      reporter.line(event.message)
      break
  }
}

/**
 * Run the Codex OAuth login flow and persist the credential.
 *
 * The `manual_code` prompt is answered by waiting on its signal: the browser
 * flow races that prompt against pi-ai's local callback server, and nothing
 * in a single-shot command plane can collect a pasted code interactively. The
 * callback server wins when the user completes the browser login; a prompt
 * whose signal fires without a callback resolves empty and the flow fails
 * with its own error, which the caller reports.
 *
 * @param options - store, method, and reporter for this login.
 * @returns the credential, for the caller to summarize.
 */
export async function login(options: LoginOptions): Promise<void> {
  const { store, method, openBrowser, signal, reporter } = options
  const models = createModels({ credentials: store })
  models.setProvider(openaiCodexProvider())

  const interaction: AuthInteraction = {
    ...signal === undefined ? {} : { signal },
    notify: (event: AuthEvent) => notify(event, reporter, openBrowser),
    prompt: async (prompt: AuthPrompt): Promise<string> => {
      switch (prompt.type) {
        case 'select':
          return answerMethodPrompt(prompt, method)
        case 'manual_code':
          await new Promise<void>(resolve => {
            if (prompt.signal === undefined) return
            prompt.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          return ''
        default:
          throw new Error(`dsh-codex-oauth: Codex login issued an unsupported "${prompt.type}" prompt`)
      }
    },
  }

  const credential = await models.login(CODEX_PROVIDER_ID, 'oauth', interaction)
  if (credential.type !== 'oauth') {
    throw new Error(`dsh-codex-oauth: Codex login produced an unexpected ${credential.type} credential`)
  }
  reporter.line('Codex login complete; the token is stored and refreshes automatically.')
}

/**
 * Describe the current Codex credential without resolving it.
 * @param store - the credential store to inspect.
 * @returns human-facing status lines.
 */
export async function status(store: FileCredentialStore): Promise<string[]> {
  const credential = await store.read(CODEX_PROVIDER_ID)
  if (credential === undefined) {
    return ['No Codex credential stored. Run `dsh-codex-oauth login` (or `/codex login`) first.']
  }
  if (credential.type !== 'oauth') {
    return [`Stored Codex credential has unexpected type "${credential.type}"; log out and in again.`]
  }
  const expires = new Date(credential.expires).toISOString()
  const account = credential.accountId === undefined ? '' : ` (account ${String(credential.accountId)})`
  return [`Codex logged in${account}; access token expires ${expires}. pi-ai refreshes it automatically.`]
}

/**
 * Remove the stored Codex credential.
 * @param store - the credential store to clear.
 */
export async function logout(store: FileCredentialStore): Promise<void> {
  await store.delete(CODEX_PROVIDER_ID)
}
