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
import type { AuthPrompt } from '@earendil-works/pi-ai';
import type { FileCredentialStore } from './store.js';
/** pi-ai's provider id for OpenAI Codex (ChatGPT Plus/Pro). */
export declare const CODEX_PROVIDER_ID = "openai-codex";
/** The two Codex login methods pi-ai's flow offers. */
export type LoginMethod = 'browser' | 'device';
/** Human-facing sink for login progress and results. */
export interface LoginReporter {
    /** Append one progress or result line. */
    line(text: string): void;
    /** Open a URL in the desktop browser; only https URLs are ever offered. */
    openUrl?(url: string): void;
}
/** Shared options for {@link login}. */
export interface LoginOptions {
    store: FileCredentialStore;
    method: LoginMethod;
    openBrowser: boolean;
    signal?: AbortSignal;
    reporter: LoginReporter;
}
/** Open `url` in the desktop browser, detached from this process. */
export declare function openUrlInBrowser(url: string, reporter?: LoginReporter): void;
/**
 * Answer one login-method prompt from the configured method, tolerating
 * label renames in later pi-ai versions by matching text rather than ids.
 * @param prompt - the select prompt pi-ai issued.
 * @param method - the configured method.
 * @returns the matching option id, falling back to the first option.
 */
export declare function answerMethodPrompt(prompt: Extract<AuthPrompt, {
    type: 'select';
}>, method: LoginMethod): string;
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
export declare function login(options: LoginOptions): Promise<void>;
/**
 * Describe the current Codex credential without resolving it.
 * @param store - the credential store to inspect.
 * @returns human-facing status lines.
 */
export declare function status(store: FileCredentialStore): Promise<string[]>;
/**
 * Remove the stored Codex credential.
 * @param store - the credential store to clear.
 */
export declare function logout(store: FileCredentialStore): Promise<void>;
