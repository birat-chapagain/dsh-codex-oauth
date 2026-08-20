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

import { spawnSync } from 'node:child_process'
import { resolveDshHome, dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { login, logout, status } from './auth.js'
import type { LoginMethod } from './auth.js'
import { DEFAULT_PROFILE, INSTALL_SPEC, ensureAllowBuilds, hasExistingLogin, profileWorkspaceFile } from './install.js'
import { FileCredentialStore } from './store.js'

interface Options {
  verb: 'install' | 'login' | 'logout' | 'status' | undefined
  method: LoginMethod
  openBrowser: boolean
  storePath: string
  profile: string
  home: string
  dryRun: boolean
}

function usage(): never {
  console.error('usage: dsh-codex-oauth <install|login|logout|status> [--method browser|device] [--no-open] [--store PATH] [--profile NAME] [--home PATH] [--dry-run]')
  process.exit(2)
}

/** Parse the tiny CLI surface; the bin owns no other flags. */
function parse(argv: readonly string[]): Options {
  const options: Options = {
    verb: undefined,
    method: 'browser',
    openBrowser: true,
    storePath: dshHomePath('codex-oauth.json'),
    profile: DEFAULT_PROFILE,
    home: resolveDshHome(),
    dryRun: false,
  }
  const rest = [...argv]
  if (rest[0] !== undefined && !rest[0].startsWith('-')) {
    const verb = rest.shift()
    if (verb !== 'install' && verb !== 'login' && verb !== 'logout' && verb !== 'status') usage()
    options.verb = verb
  }
  while (rest.length > 0) {
    const flag = rest.shift()
    switch (flag) {
      case '--method': {
        const value = rest.shift()
        if (value !== 'browser' && value !== 'device') usage()
        options.method = value
        break
      }
      case '--no-open':
        options.openBrowser = false
        break
      case '--store': {
        const value = rest.shift()
        if (value === undefined || value.length === 0) usage()
        options.storePath = value
        break
      }
      case '--profile': {
        const value = rest.shift()
        if (value === undefined || value.length === 0) usage()
        options.profile = value
        break
      }
      case '--home': {
        const value = rest.shift()
        if (value === undefined || value.length === 0) usage()
        options.home = value
        break
      }
      case '--dry-run':
        options.dryRun = true
        break
      case '--help':
      case '-h':
        usage()
      default:
        usage()
    }
  }
  return options
}

/**
 * Run the profile install through the product CLI: the `dsh` binary when it
 * is on PATH, otherwise `npx @deepseek-ai/dsh`. stdio is inherited so pnpm's
 * interactive output reaches the user.
 * @returns the child exit code.
 */
function runPluginAdd(profile: string): number {
  const found = spawnSync('sh', ['-c', 'command -v dsh'], { stdio: 'ignore' })
  const args = found.status === 0
    ? ['dsh', 'plugin', '--profile', profile, 'add', INSTALL_SPEC]
    : ['npx', '--yes', '@deepseek-ai/dsh', 'plugin', '--profile', profile, 'add', INSTALL_SPEC]
  const [command, ...rest] = args
  const result = spawnSync(command!, rest, { stdio: 'inherit' })
  return result.status ?? 1
}

/** The `install` verb: approvals, then the real `dsh plugin add`. */
async function install(options: Options): Promise<void> {
  const workspaceFile = profileWorkspaceFile(options.home, options.profile)
  if (options.dryRun) {
    console.log(`dry run: would ensure build approvals in ${workspaceFile}`)
    console.log(`dry run: would run: dsh plugin --profile ${options.profile} add ${INSTALL_SPEC}`)
    return
  }
  const step = await ensureAllowBuilds(workspaceFile)
  console.log(`✔ ${step.text}`)
  const code = runPluginAdd(options.profile)
  if (code !== 0) {
    process.exit(code)
  }
  console.log(`installed ${INSTALL_SPEC} into profile "${options.profile}".`)
  if (await hasExistingLogin(options.home)) {
    console.log('A Codex login already exists for this Harness home — restart dsh and pick a codex model.')
  } else {
    console.log('Next: run `dsh-codex-oauth login` (or /codex login in the Web UI), then restart dsh and pick a codex model.')
  }
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2))
  const store = new FileCredentialStore(options.storePath)
  switch (options.verb) {
    case 'install':
      await install(options)
      break
    case 'login':
      await login({
        store,
        method: options.method,
        openBrowser: options.openBrowser,
        reporter: {
          line: (text: string) => console.log(text),
        },
      })
      break
    case 'logout':
      await logout(store)
      console.log('Codex logged out.')
      break
    case 'status':
      for (const line of await status(store)) console.log(line)
      break
    default:
      usage()
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`dsh-codex-oauth: ${detail}`)
    process.exit(1)
  },
)
