#!/usr/bin/env node
/**
 * dsh-codex-oauth CLI: install the bundle and authenticate to OpenAI Codex.
 *
 *   dsh-codex-oauth install [--profile web] [--home PATH] [--dry-run]
 *   dsh-codex-oauth login [--method browser|device] [--no-open] [--store PATH]
 *   dsh-codex-oauth logout [--store PATH]
 *   dsh-codex-oauth status  [--store PATH]
 *
 * `install` writes the one-time pnpm build approvals for the profile and
 * runs `dsh plugin add` with the same package spec, so the whole setup is
 * one command. The store defaults to `$DSH_HOME/codex-oauth.json`, the same
 * document the harness plugin reads.
 *
 * @module dsh-codex-oauth/bin
 */
export {};
