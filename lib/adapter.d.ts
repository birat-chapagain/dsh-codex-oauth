/**
 * The Codex provider adapter: a `LlmAdapter` over one pi-ai `Models`
 * collection holding the `openai-codex` provider. OAuth credentials never
 * reach this class — pi-ai resolves and refreshes them from the store the
 * collection was built with, under its credential-store lock.
 *
 * @module dsh-codex-oauth/adapter
 */
import type { Models } from '@earendil-works/pi-ai';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
/** Stream transport knobs shared by every model on the route. */
export interface CodexStreamOptions {
    transport: 'sse' | 'websocket' | 'websocket-cached' | 'auto';
    cacheRetention: 'none' | 'short' | 'long';
}
/**
 * One route of the Codex provider, serving the models pi-ai's Codex catalog
 * ships (the `gpt-5.x-codex` family).
 */
export declare class CodexAdapter extends LlmAdapter {
    private readonly models;
    private readonly provider;
    private readonly streamOptions;
    constructor(models: Models, provider: string, streamOptions: CodexStreamOptions);
    providerInfo(): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
