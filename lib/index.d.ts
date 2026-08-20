/**
 * dsh-codex-oauth: use your OpenAI Codex (ChatGPT Plus/Pro) subscription in
 * DeepSeek Harness through OAuth.
 *
 * The plugin registers one `LlmAdapter` for a `codex` provider route backed
 * by pi-ai's `openai-codex` provider, whose OAuth credential lives in a
 * `0600` JSON store under the Harness home. When the composition mounts the
 * commands service, it also registers the `/codex` human command; headless
 * users authenticate through the `dsh-codex-oauth` CLI bin instead.
 *
 * @module dsh-codex-oauth
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "dsh-codex-oauth";
/** The LLM seam is the one required service; the adapter works in every composition. */
export declare const inject: string[];
export interface Config {
    /** Provider route this adapter registers (the id models and sessions name). */
    provider: string;
    /** Credential store path; defaults to `$DSH_HOME/codex-oauth.json`. */
    storePath?: string;
    /**
     * Codex Responses transport. Defaults to `sse`: pi-ai's WebSocket session
     * reuse keeps a connection open after a one-shot headless turn and the
     * process never exits; opt into `websocket` (or `websocket-cached`) for
     * long-lived interactive sessions that benefit from connection reuse.
     */
    transport: 'sse' | 'websocket' | 'websocket-cached' | 'auto';
    /** Prompt-cache retention preference for session-cached Codex requests. */
    cacheRetention: 'none' | 'short' | 'long';
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
