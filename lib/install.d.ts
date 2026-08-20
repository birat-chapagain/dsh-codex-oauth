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
/** The one-time approvals pnpm 11.22+ demands for pi-ai's transitive deps. */
export declare const ALLOW_BUILDS: Readonly<Record<string, true>>;
/** The default target profile of the product CLI. */
export declare const DEFAULT_PROFILE = "web";
/**
 * The package spec the installer hands to `dsh plugin add`.
 * Pinned to a commit so a later push cannot change what a user installs;
 * bump here when releasing.
 */
export declare const INSTALL_SPEC = "github:birat-chapagain/dsh-codex-oauth";
/** One planned or performed installer action, for display and dry runs. */
export interface InstallStep {
    /** What this step does or did. */
    readonly text: string;
    /** Whether the step modified anything. */
    readonly changed: boolean;
}
/**
 * Ensure the profile's `pnpm-workspace.yaml` carries every {@link ALLOW_BUILDS}
 * key, creating the file when missing. The edit is append-only; existing
 * content is never rewritten.
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
