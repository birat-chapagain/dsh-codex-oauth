# Contributing

Small repo, few rules.

## Build and test

```sh
npm install
npm run typecheck
npm test          # builds lib/ first, then runs vitest
```

`lib/` is committed (that is what makes installs build-free), so any change to `src/` must be followed by `npm run build` and committed together with the source. `npm run prepack` rebuilds automatically before packing.

## Release checklist

1. Bump `version` in `package.json`, and pin `INSTALL_SPEC` in `src/install.ts` plus the install commands in both READMEs to the new `releases/download/v<version>/dsh-codex-oauth.tgz` URL (version-pinned URLs guarantee a fresh artifact; `latest/download` can serve a stale cached copy).
2. `npm test` (builds `lib/`, runs all suites).
3. Commit source + rebuilt `lib/` together, push to `main`.
4. `npm pack`, then attach the tarball to the GitHub release as the asset `dsh-codex-oauth.tgz`.

## Tests

- `tests/store.spec.ts` — credential-store file format, permissions, and lock behavior.
- `tests/convert.spec.ts` — request/stream vocabulary conversion.
- `tests/auth.spec.ts` — login flow interaction (pi-ai mocked).
- `tests/command.spec.ts` — the `/codex` command handler.
- `tests/adapter.spec.ts` — adapter behavior over a mocked stream (real catalog).
- `tests/composition.spec.ts` — a real Cordis Loader composition with `dsh-llm` + the plugin.
- `tests/bin.spec.ts` — the built CLI under plain Node.

Real end-to-end login requires a ChatGPT Plus/Pro account: `npm run build && node lib/bin.js login --method device` against a scratch `$DSH_HOME`.
