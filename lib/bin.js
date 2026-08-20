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
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { login, logout, status } from './auth.js';
import { FileCredentialStore } from './store.js';
function usage() {
    console.error('usage: dsh-codex-oauth <login|logout|status> [--method browser|device] [--no-open] [--store PATH]');
    process.exit(2);
}
/** Parse the tiny CLI surface; the bin owns no other flags. */
function parse(argv) {
    const options = {
        verb: undefined,
        method: 'browser',
        openBrowser: true,
        storePath: dshHomePath('codex-oauth.json'),
    };
    const rest = [...argv];
    if (rest[0] !== undefined && !rest[0].startsWith('-')) {
        const verb = rest.shift();
        if (verb !== 'login' && verb !== 'logout' && verb !== 'status')
            usage();
        options.verb = verb;
    }
    while (rest.length > 0) {
        const flag = rest.shift();
        switch (flag) {
            case '--method': {
                const value = rest.shift();
                if (value !== 'browser' && value !== 'device')
                    usage();
                options.method = value;
                break;
            }
            case '--no-open':
                options.openBrowser = false;
                break;
            case '--store': {
                const value = rest.shift();
                if (value === undefined || value.length === 0)
                    usage();
                options.storePath = value;
                break;
            }
            case '--help':
            case '-h':
                usage();
            default:
                usage();
        }
    }
    return options;
}
async function main() {
    const options = parse(process.argv.slice(2));
    const store = new FileCredentialStore(options.storePath);
    switch (options.verb) {
        case 'login':
            await login({
                store,
                method: options.method,
                openBrowser: options.openBrowser,
                reporter: {
                    line: (text) => console.log(text),
                },
            });
            break;
        case 'logout':
            await logout(store);
            console.log('Codex logged out.');
            break;
        case 'status':
            for (const line of await status(store))
                console.log(line);
            break;
        default:
            usage();
    }
}
main().then(() => process.exit(0), (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`dsh-codex-oauth: ${detail}`);
    process.exit(1);
});
//# sourceMappingURL=bin.js.map