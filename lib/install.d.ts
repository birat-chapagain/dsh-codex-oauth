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
/** The one-time approvals pnpm 11.22+ demands for pi-ai's transitive deps. */
export declare const ALLOW_BUILDS: Readonly<Record<string, true>>;
/** The default target profile of the product CLI. */
export declare const DEFAULT_PROFILE = "web";
/**
 * The package spec the installer hands to `dsh plugin add`. Pinned per
 * release instead of `latest/download` so a previously fetched URL can never
 * serve a stale CDN copy of the installer itself.
 */
export declare const INSTALL_SPEC = "https://github.com/birat-chapagain/dsh-codex-oauth/releases/download/v0.1.5/dsh-codex-oauth.tgz";
/** One planned or performed installer action, for display and dry runs. */
export interface InstallStep {
    /** What this step does or did. */
    readonly text: string;
    /** Whether the step modified anything. */
    readonly changed: boolean;
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
export declare function ensureAllowBuilds(workspaceFile: string): Promise<InstallStep>;
/**
 * The profile workspace file for one Harness home and profile name.
 * @param home - resolved Harness home directory.
 * @param profile - profile name.
 * @returns the pnpm-workspace.yaml path dsh manages for that profile.
 */
export declare function profileWorkspaceFile(home: string, profile: string): string;
/**
 * Whether a Codex credential already exists for the target home, so the
 * installer can skip the login reminder.
 * @param home - resolved Harness home directory.
 * @returns true when `$home/codex-oauth.json` exists.
 */
export declare function hasExistingLogin(home: string): Promise<boolean>;
