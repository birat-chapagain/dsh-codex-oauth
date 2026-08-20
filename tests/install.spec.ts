/**
 * The one-command installer: normalize the two pnpm build-approval keys in
 * the profile's pnpm-workspace.yaml, and the dry-run path of the bin.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureAllowBuilds, profileWorkspaceFile } from '../src/install.js'

const exec = promisify(execFile)

let root: string

/** Write one fixture file, creating its parent directories first. */
async function writeFixture(file: string, content: string, _encoding?: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/** The exact normalized approval block the installer writes. */
const APPROVALS = 'allowBuilds:\n  "@google/genai": true\n  protobufjs: true\nonlyBuiltDependencies:\n  - "@google/genai"\n  - protobufjs\n'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-codex-install-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

describe('ensureAllowBuilds', () => {
  it('creates a fresh workspace file with the profile template and approvals', async () => {
    const file = profileWorkspaceFile(root, 'web')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(
      `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n${APPROVALS}`,
    )
  })

  it('preserves existing keys and comments while adding the approvals', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, '# keep me\npackages:\n  - .\nfoo: bar\n', 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    const text = await readFile(file, 'utf8')
    expect(text).toContain('# keep me')
    expect(text).toContain('packages:\n  - .')
    expect(text).toContain('foo: bar')
    expect(text).toContain(APPROVALS.trim())
  })

  it('corrects placeholder values pasted verbatim from a pnpm template', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file,
      "allowBuilds:\n  '@google/genai': set this to true or false\n  protobufjs: set this to true or false\n", 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    expect(step.text).toContain('corrected')
    const text = await readFile(file, 'utf8')
    expect(text).toContain('  "@google/genai": true')
    expect(text).toContain('  protobufjs: true')
    expect(text).not.toContain('set this to true or false')
  })

  it('converts a list-form allowBuilds into the map pnpm 11 expects', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, 'allowBuilds:\n  - protobufjs\n', 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    const text = await readFile(file, 'utf8')
    expect(text).toContain('allowBuilds:\n  "@google/genai": true\n  protobufjs: true')
  })

  it('migrates a pnpm 10 onlyBuiltDependencies list into the allowBuilds map', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, 'onlyBuiltDependencies:\n  - protobufjs\n', 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    const text = await readFile(file, 'utf8')
    expect(text).toContain('  "@google/genai": true')
    expect(text).toContain('onlyBuiltDependencies:')
    expect(text).toContain('  - protobufjs')
  })

  it('preserves extra allowBuilds entries the user approved', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, 'allowBuilds:\n  eslint: true\n  \'@google/genai\': true\n', 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    const text = await readFile(file, 'utf8')
    expect(text).toContain('  eslint: true')
    expect(text).toContain('  protobufjs: true')
  })

  it('is a no-op when the approvals are already correct', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, APPROVALS, 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(APPROVALS)
  })

  it('rejects an unparseable workspace file with a clear error', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, 'allowBuilds: [broken\n', 'utf8')
    await expect(ensureAllowBuilds(file)).rejects.toThrow(/cannot parse/)
  })
})

describe('install --dry-run bin', () => {
  it('prints the planned steps without spawning dsh or writing files', async () => {
    const home = join(root, 'home')
    const { stdout, stderr } = await exec(process.execPath, [
      join(process.cwd(), 'lib', 'bin.js'),
      'install', '--dry-run', '--home', home, '--profile', 'web',
    ])
    expect(stderr).toBe('')
    expect(stdout).toContain('dry run: would ensure build approvals')
    expect(stdout).toContain('dry run: would run: dsh plugin --profile web add')
    await expect(readFile(profileWorkspaceFile(home, 'web'), 'utf8')).rejects.toThrow()
  })
})
