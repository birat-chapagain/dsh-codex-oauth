# dsh-codex-oauth

Use your **OpenAI Codex subscription** (ChatGPT Plus/Pro) inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — via OAuth, the same way the official Codex CLI and other harnesses do.

The upstream harness's multi-provider adapter deliberately withholds `openai-codex` because Codex authenticates through ChatGPT OAuth, and that adapter holds no credential store and runs no login flow. This community plugin supplies both pieces as an installable bundle: a file-backed OAuth credential store, a `/codex login` human command, and a `codex` provider route registered on the public LLM seam.

- Built on the published seam packages (`@deepseek-ai/dsh-llm`, `@deepseek-ai/cordis`) — no fork, no core change.
- pi-ai's provider-owned Codex OAuth flows handle the wire protocol: browser login with a local callback server, headless device-code login, and automatic refresh under a cross-process credential-store lock.
- Tokens live in `$DSH_HOME/codex-oauth.json` (`0600`, owner-only directory), the same place the CLI bin and the harness plugin both read.

## Requirements

- A ChatGPT **Plus or Pro** subscription. (A plain OpenAI platform API key does not work — subscription access is bound to your ChatGPT account, not an API key.)
- DeepSeek Harness installed (`npx @deepseek-ai/dsh web` or a source checkout).

## Install

The package is a dsh **bundle**. Install it into a profile:

```sh
dsh plugin --profile web add github:birat-chapagain/dsh-codex-oauth
```

pnpm ≥10 refuses to run a git dependency's `prepare` build script until you allow it once. The first `add` prints the exact key; copy it into the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-codex-oauth: true
```

then re-run the `add`. This permission runs this package's build at install time — pin a commit if you prefer (`github:birat-chapagain/dsh-codex-oauth#<sha>`). Installing from npm or a packed tarball needs no such allowance.

The profile manifest ends up listing the bundle after `@deepseek-ai/dsh-base`; verify the composed tree without booting:

```sh
dsh --profile web --dump-config
```

## Log in

Logging in is a **human command**, not a model tool — it never enters a prompt.

### Web UI

Type `/codex login` in the chat input. A browser window opens on the ChatGPT authorization page; complete it, and the command reports when the token is stored. Use `/codex logout` and `/codex status` to manage it.

### Headless / CLI

The bundle also ships a `dsh-codex-oauth` bin that runs outside the harness (the headless profile has no command plane):

```sh
npx dsh-codex-oauth login                 # browser flow (desktop)
npx dsh-codex-oauth login --method device # device-code flow (headless)
npx dsh-codex-oauth status
npx dsh-codex-oauth logout
```

Device flow prints a one-time code plus the OpenAI device-verification URL; enter the code on any device, and the CLI waits until you authorize and stores the token in the same file the harness reads.

## Use Codex

The plugin registers provider route **`codex`** with the Codex catalog models (`gpt-5.x-codex` and friends, from the installed pi-ai catalog). Select `codex` / a Codex model in the Web model picker, or set the default for a headless profile in the profile's `cordis.patch.yml`:

```yaml
- id: agent-default-model
  config:
    provider: codex
    model: gpt-5.4
```

Per-session selection in the Web UI needs no patch. Provider, model, and capabilities resolve through the same LLM seam as shipped providers; prompts, tools, persistence, and history replay behave identically.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `provider` | `codex` | Provider route id the adapter registers. |
| `storePath` | `$DSH_HOME/codex-oauth.json` | OAuth credential store location. |
| `transport` | `sse` | Codex Responses transport: `sse`, `websocket`, `websocket-cached`, or `auto`. `sse` exits cleanly after one-shot headless turns; `websocket`/`websocket-cached` reuse the connection for long interactive sessions but keep one-shot processes alive. |
| `cacheRetention` | `long` | pi-ai prompt-cache retention: `none`, `short`, `long`. |

Override in a later patch layer (profile `cordis.patch.yml` replaces this row's whole `config`):

```yaml
- id: codex-oauth
  config:
    provider: codex
    transport: sse
```

## Security notes

- The store document is written atomically with `0600` permissions under a `0700` directory, and a group/world-readable document is refused on POSIX. It holds your ChatGPT OAuth tokens — treat it like an API key.
- The harness process and its tool subprocesses run as your user; like the upstream credentials document, this file is not hidden from tools the model can drive. Do not point the model's workspace at your Harness home.
- Only `https` URLs issued by the login flow are ever handed to the browser opener.
- The login flow is pi-ai's provider-owned implementation (authorization-code + device-code against `chatgpt.com`); this plugin answers its interaction prompts and stores the result.

## How it works

- `src/store.ts` — `FileCredentialStore`, a persistent pi-ai `CredentialStore` with serialized read-modify-write (`dsh-atomic-write`).
- `src/auth.ts` — login/status/logout over pi-ai's `openai-codex` OAuth provider.
- `src/adapter.ts` — `CodexAdapter extends LlmAdapter` (from `@deepseek-ai/dsh-llm`), registered with `ctx.llm.registerAdapter(['codex'], …)`; `stream()` resolves/refreshes auth via pi-ai automatically.
- `src/convert.ts` — request/stream vocabulary conversion, adapted from `@deepseek-ai/dsh-llm-pi-ai` (MIT, © DeepSeek AI) with image attachment support and provider-native replay state omitted.
- `src/index.ts` — the Cordis function plugin (`name`/`inject`/`Config`/`apply`); registers the adapter and, when the composition mounts `ctx.commands`, the `/codex` command.

## Limitations

- **Text only.** Image content is refused with `UNSUPPORTED_CONTENT` before any provider request.
- **No browser Models-page card.** Configuration happens through the patch layer and the picker lists the route through the adapter registry; login is the bin or `/codex` command, not the credentials page.
- **No provider-native replay state.** Historical assistant messages replay as provider-neutral content (correct, but without signature/cache reuse).
- **Browser login assumes a desktop browser.** Machines without one use `--method device` or `/codex login device`.
- **One login at a time.** The callback server and store lock serialize concurrent logins; wait for one to finish.

## Development

```sh
npm install
npm test        # builds lib/ then runs vitest (unit + Loader composition + built-bin smokes)
```

The composition test boots the real `dsh-llm` service and this plugin through the Cordis Loader with only the pi-ai SDK mocked, and the bin tests exercise the built artifact under plain Node.

## License

MIT. The conversion modules in `src/convert.ts` are adapted from `@deepseek-ai/dsh-llm-pi-ai` (MIT, © DeepSeek AI).
