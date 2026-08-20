/**
 * The one-command installer: strictly additive allowBuilds edits and the
 * dry-run path of the bin.
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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-codex-install-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

describe('ensureAllowBuilds', () => {
  it('creates the file with the allowBuilds block when absent', async () => {
    const file = profileWorkspaceFile(root, 'web')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('allowBuilds:\n  \'@google/genai\': true\n  protobufjs: true\n')
  })

  it('appends the block to existing unrelated content', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, 'packages: []\n', 'utf8')
    await ensureAllowBuilds(file)
    const text = await readFile(file, 'utf8')
    expect(text.startsWith('packages: []')).toBe(true)
    expect(text).toContain('allowBuilds:')
    expect(text).toContain("  '@google/genai': true")
  })

  it('extends an existing allowBuilds block without duplicating keys', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, "allowBuilds:\n  protobufjs: true\n", 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(true)
    const text = await readFile(file, 'utf8')
    expect(text).toContain("  '@google/genai': true")
    expect((text.match(/protobufjs/g) ?? []).length).toBe(1)
  })

  it('is a no-op when every key is already approved', async () => {
    const file = profileWorkspaceFile(root, 'web')
    await writeFixture(file, "allowBuilds:\n  '@google/genai': true\n  protobufjs: true\n", 'utf8')
    const step = await ensureAllowBuilds(file)
    expect(step.changed).toBe(false)
    expect(await readFile(file, 'utf8')).toBe("allowBuilds:\n  '@google/genai': true\n  protobufjs: true\n")
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
