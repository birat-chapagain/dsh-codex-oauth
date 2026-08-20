/**
 * One-command installer support.
 *
 * `dsh-codex-oauth install` removes the two friction points of the manual
 * flow: it writes the one-time pnpm build approvals for pi-ai's transitive
 * build scripts (both unused by the Codex route) into the profile's
 * `pnpm-workspace.yaml`, then shells out to `dsh plugin add` with the same
 * package spec.
 *
 * pnpm 11 reads these approvals from an `allowBuilds` map; pnpm 10 read the
 * equivalent `onlyBuiltDependencies` list, so the installer writes both and
 * keeps them in sync. The edit is a normalization, not a blind append: it
 * also repairs the common failure where pnpm's suggested snippet was pasted
 * verbatim with its `set this to true or false` placeholders, which pnpm
 * treats as a denial.
 *
 * @module dsh-codex-oauth/install
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
/** The one-time approvals pnpm 11.22+ demands for pi-ai's transitive deps. */
export const ALLOW_BUILDS = Object.freeze({
    '@google/genai': true,
    protobufjs: true,
});
/** The default target profile of the product CLI. */
export const DEFAULT_PROFILE = 'web';
/**
 * The package spec the installer hands to `dsh plugin add`. Pinned per
 * release instead of `latest/download` so a previously fetched URL can never
 * serve a stale CDN copy of the installer itself.
 */
export const INSTALL_SPEC = 'https://github.com/birat-chapagain/dsh-codex-oauth/releases/download/v0.1.5/dsh-codex-oauth.tgz';
/**
 * What dsh's own `initProfile` writes for a fresh profile; reproduced here
 * because `dsh plugin add` skips its template once the file exists.
 */
const PROFILE_WORKSPACE_TEMPLATE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;
/** Scalar string items of a YAML sequence node. */
function stringItems(node) {
    if (!isSeq(node))
        return [];
    const items = [];
    for (const item of node.items) {
        if (isScalar(item) && typeof item.value === 'string')
            items.push(item.value);
    }
    return items;
}
/**
 * The package names an `allowBuilds` node approves, whatever its form: a map
 * contributes its keys (values are rewritten to `true` below), a list its
 * items, and a missing node none. Returns undefined when the node is present
 * but neither a map nor a list, so the caller can fail loud instead of
 * silently discarding an unusable setting.
 * @param allow - the `allowBuilds` node, or undefined when absent.
 * @returns the approved names, or undefined for an unusable node.
 */
function approvedNames(allow) {
    if (allow === null || allow === undefined)
        return [];
    if (isSeq(allow))
        return stringItems(allow);
    if (!isMap(allow))
        return undefined;
    const names = [];
    for (const pair of allow.items) {
        if (isScalar(pair.key) && typeof pair.key.value === 'string')
            names.push(pair.key.value);
    }
    return names;
}
/** One trailing newline, whatever the source had. */
function normalized(text) {
    return text.replace(/\n*$/u, '\n');
}
/**
 * Ensure the profile's `pnpm-workspace.yaml` approves every
 * {@link ALLOW_BUILDS} package. Creates the file with dsh's profile template
 * when missing, otherwise preserves every unrelated key and comment while
 * normalizing the two approval keys: `allowBuilds` becomes a sorted map with
 * `true` values (list form, placeholder text, and explicit `false` values
 * are repaired), and `onlyBuiltDependencies` becomes the matching sorted list.
 * @param workspaceFile - absolute path to the profile's pnpm-workspace.yaml.
 * @returns the step describing what happened.
 */
export async function ensureAllowBuilds(workspaceFile) {
    let text;
    try {
        text = await readFile(workspaceFile, 'utf8');
    }
    catch (error) {
        if (error?.code !== 'ENOENT')
            throw error;
        text = PROFILE_WORKSPACE_TEMPLATE;
    }
    if (text.trim() === '')
        text = PROFILE_WORKSPACE_TEMPLATE;
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
        throw new Error(`cannot parse ${workspaceFile}: ${doc.errors[0].message} — fix or remove the file, then re-run`);
    }
    if (!isMap(doc.contents)) {
        throw new Error(`${workspaceFile} is not a YAML mapping — remove it so the installer can write a fresh one`);
    }
    const wanted = Object.keys(ALLOW_BUILDS);
    const allow = doc.get('allowBuilds', true);
    const names = approvedNames(allow);
    if (names === undefined) {
        throw new Error(`allowBuilds in ${workspaceFile} is not a map or list of package names — remove it and re-run`);
    }
    const approved = new Set(wanted);
    for (const name of names)
        approved.add(name);
    for (const name of stringItems(doc.get('onlyBuiltDependencies', true)))
        approved.add(name);
    const placeholder = isMap(allow) && wanted.some((name) => {
        const entry = allow.get(name, true);
        return entry !== undefined && !(isScalar(entry) && entry.value === true);
    });
    const before = normalized(String(doc));
    const sorted = [...approved].sort();
    doc.set('allowBuilds', doc.createNode(Object.fromEntries(sorted.map(name => [name, true]))));
    doc.set('onlyBuiltDependencies', doc.createNode(sorted));
    const after = normalized(String(doc));
    if (after === before) {
        return { text: `build approvals already present in ${workspaceFile}`, changed: false };
    }
    await mkdir(dirname(workspaceFile), { recursive: true });
    await writeFileAtomic(workspaceFile, after, { mode: 0o644 });
    return {
        text: placeholder
            ? `corrected build approval values in ${workspaceFile}`
            : `wrote build approvals (${wanted.join(', ')}) to ${workspaceFile}`,
        changed: true,
    };
}
/**
 * The profile workspace file for one Harness home and profile name.
 * @param home - resolved Harness home directory.
 * @param profile - profile name.
 * @returns the pnpm-workspace.yaml path dsh manages for that profile.
 */
export function profileWorkspaceFile(home, profile) {
    return join(home, 'profiles', profile, 'pnpm-workspace.yaml');
}
/**
 * Whether a Codex credential already exists for the target home, so the
 * installer can skip the login reminder.
 * @param home - resolved Harness home directory.
 * @returns true when `$home/codex-oauth.json` exists.
 */
export async function hasExistingLogin(home) {
    try {
        await readFile(join(home, 'codex-oauth.json'), 'utf8');
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=install.js.map