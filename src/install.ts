/**
 * One-command installer support.
 *
 * `dsh-codex-oauth install` removes the two friction points of the manual
 * flow: it writes the one-time `allowBuilds` approval for pi-ai's transitive
 * build scripts (both unused by the Codex route) into the profile's
 * `pnpm-workspace.yaml`, then shells out to `dsh plugin add` with the same
 * package spec.
 *
 * The YAML edit is strictly additive: it never rewrites the document, only
 * appends the two keys (or a new `allowBuilds:` block) when they are absent.
 *
 * @module dsh-codex-oauth/install
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** The one-time approvals pnpm 11.22+ demands for pi-ai's transitive deps. */
export const ALLOW_BUILDS: Readonly<Record<string, true>> = Object.freeze({
  '@google/genai': true,
  protobufjs: true,
})

/** The default target profile of the product CLI. */
export const DEFAULT_PROFILE = 'web'

/**
 * The package spec the installer hands to `dsh plugin add`.
 * Pinned to a commit so a later push cannot change what a user installs;
 * bump here when releasing.
 */
export const INSTALL_SPEC = 'github:birat-chapagain/dsh-codex-oauth'

/** One planned or performed installer action, for display and dry runs. */
export interface InstallStep {
  /** What this step does or did. */
  readonly text: string
  /** Whether the step modified anything. */
  readonly changed: boolean
}

/** Render one allowBuilds key, quoted only when YAML needs it. */
function keyLine(key: string, indent: string): string {
  const rendered = /[/@]/u.test(key) ? `'${key}'` : key
  return `${indent}${rendered}: true`
}

/**
 * Ensure the profile's `pnpm-workspace.yaml` carries every {@link ALLOW_BUILDS}
 * key, creating the file when missing. The edit is append-only; existing
 * content is never rewritten.
 * @param workspaceFile - absolute path to the profile's pnpm-workspace.yaml.
 * @returns the step describing what happened.
 */
export async function ensureAllowBuilds(workspaceFile: string): Promise<InstallStep> {
  let text = ''
  try {
    text = await readFile(workspaceFile, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  }
  const present = (key: string): boolean =>
    new RegExp(`^\\s*['"]?${key}['"]?\\s*:`, 'mu').test(text)
  const missing = Object.keys(ALLOW_BUILDS).filter(key => !present(key))
  if (missing.length === 0) {
    return { text: `build approvals already present in ${workspaceFile}`, changed: false }
  }
  let next = text
  if (/\ballowBuilds\s*:/u.test(next)) {
    next = next.replace(/(^|\n)(\s*)allowBuilds\s*:/u, (_match, lead: string, indent: string) => {
      const lines = missing.map(key => keyLine(key, `${indent}  `)).join('\n')
      return `${lead}${indent}allowBuilds:\n${lines}`
    })
  } else {
    const block = `allowBuilds:\n${missing.map(key => keyLine(key, '  ')).join('\n')}\n`
    next = text.length > 0 && !text.endsWith('\n') ? `${text}\n${block}` : `${text}${block}`
  }
  await mkdir(dirname(workspaceFile), { recursive: true })
  await writeFile(workspaceFile, next, 'utf8')
  return {
    text: `wrote build approvals for ${missing.join(', ')} to ${workspaceFile}`,
    changed: true,
  }
}

/**
 * The profile workspace file for one Harness home and profile name.
 * @param home - resolved Harness home directory.
 * @param profile - profile name.
 * @returns the pnpm-workspace.yaml path dsh manages for that profile.
 */
export function profileWorkspaceFile(home: string, profile: string): string {
  return join(home, 'profiles', profile, 'pnpm-workspace.yaml')
}

/**
 * Whether a Codex credential already exists for the target home, so the
 * installer can skip the login reminder.
 * @param home - resolved Harness home directory.
 * @returns true when `$home/codex-oauth.json` exists.
 */
export async function hasExistingLogin(home: string): Promise<boolean> {
  try {
    await readFile(join(home, 'codex-oauth.json'), 'utf8')
    return true
  } catch {
    return false
  }
}
