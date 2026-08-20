#!/usr/bin/env node
/**
 * dsh-codex-oauth CLI: authenticate to OpenAI Codex outside the harness.
 *
 *   dsh-codex-oauth login [--method browser|device] [--no-open] [--store PATH]
 *   dsh-codex-oauth logout [--store PATH]
 *   dsh-codex-oauth status  [--store PATH]
 *
 * The store defaults to `$DSH_HOME/codex-oauth.json`, the same document the
 * harness plugin reads, so logging in here makes the `codex` provider route
 * work in the harness immediately.
 *
 * @module dsh-codex-oauth/bin
 */
export {};
