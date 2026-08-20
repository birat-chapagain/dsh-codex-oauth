# dsh-codex-oauth

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中使用你的 **OpenAI Codex 订阅**（ChatGPT Plus/Pro）——通过 OAuth 登录，与官方 Codex CLI 及其他 harness 的方式一致。

上游 harness 的多供应商适配器刻意不提供 `openai-codex`：Codex 走 ChatGPT OAuth 认证，而该适配器没有凭据存储、也没有登录流程（见其 README 的 Known Limitations）。本社区插件以可安装 bundle 的形式补上这两块：文件型 OAuth 凭据存储、`/codex login` 人类命令，以及注册在公开 LLM 缝上的 `codex` 供应商路由。

- 基于已发布的缝包（`@deepseek-ai/dsh-llm`、`@deepseek-ai/cordis`）构建——无 fork、无核心改动。
- Codex 的 OAuth 流程（浏览器登录 + 本地回调、无头设备的 device-code 登录、凭据锁下的自动刷新）全部由 pi-ai 的官方 provider 实现负责。
- 令牌保存在 `$DSH_HOME/codex-oauth.json`（`0600`、目录 `0700`），CLI 与 harness 插件读取同一份文件。

## 要求

- 一个 ChatGPT **Plus 或 Pro** 订阅。（OpenAI 平台 API key 不行——订阅额度绑定的是 ChatGPT 账号，不是 API key。）
- 已安装 DeepSeek Harness（`npx @deepseek-ai/dsh web` 或源码运行）。

## 安装

本包是一个 dsh **bundle**。安装进一个 profile：

```sh
dsh plugin --profile web add github:birat-chapagain/dsh-codex-oauth
```

仓库自带编译好的 `lib/`，安装时不执行任何构建脚本，因此不需要 `allowBuilds` 授权。想要可复现性可以锁 commit（`github:birat-chapagain/dsh-codex-oauth#<sha>`）。

也可以用发布包（同样无需构建授权）：

```sh
dsh plugin --profile web add https://github.com/birat-chapagain/dsh-codex-oauth/releases/latest/download/dsh-codex-oauth.tgz
```

如果 pnpm 11.22+ 因传递依赖的未批准构建脚本而报 `ERR_PNPM_IGNORED_BUILDS`（pi-ai 的依赖树里有 `@google/genai` 与 `protobufjs` 两个带构建脚本的包，Codex 路径并不会用到它们），把下面这段一次性写进 profile 的 `pnpm-workspace.yaml` 再重跑 `add`：

```yaml
allowBuilds:
  '@google/genai': true
  protobufjs: true
```

（若 pnpm 报错里打印的 key 与上面不同，以打印的为准。）

验证组合结果而不启动：

```sh
dsh --profile web --dump-config
```

## 登录

登录是**人类命令**，不是模型工具——不会进入 prompt。

### Web UI

在聊天输入框输入 `/codex login`。浏览器会打开 ChatGPT 授权页；完成后命令会报告令牌已保存。用 `/codex logout` 与 `/codex status` 管理。

### 无头 / CLI

bundle 同时提供一个在 harness 之外运行的 `dsh-codex-oauth` 命令（headless profile 没有命令面板）：

```sh
npx dsh-codex-oauth login                 # 浏览器流程（桌面）
npx dsh-codex-oauth login --method device # device-code 流程（无头）
npx dsh-codex-oauth status
npx dsh-codex-oauth logout
```

Device 流程会打印一次性验证码与验证网址；在任意设备上完成授权后，CLI 会把令牌写入 harness 读取的同一文件。

## 使用 Codex

插件注册的路由名为 **`codex`**，模型来自 pi-ai 安装的 Codex 目录（`gpt-5.x-codex` 系列）。在 Web 模型选择器里选 `codex` / Codex 模型即可；headless profile 则在 profile 的 `cordis.patch.yml` 里改默认模型：

```yaml
- id: agent-default-model
  config:
    provider: codex
    model: gpt-5.4
```

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | `codex` | 适配器注册的供应商路由 id。 |
| `storePath` | `$DSH_HOME/codex-oauth.json` | OAuth 凭据存储位置。 |
| `transport` | `sse` | Codex Responses 传输方式：`sse`、`websocket`、`websocket-cached` 或 `auto`。`sse` 在一次性 headless 运行后可正常退出；`websocket`/`websocket-cached` 适合长期交互会话的连接复用，但会让一次性进程保持存活。 |
| `cacheRetention` | `long` | pi-ai 提示缓存保留策略：`none`、`short`、`long`。 |

## 安全说明

- 存储文件以 `0600` 权限原子写入、目录 `0700`；POSIX 上拒绝读取组/他人可读的文件。它保存的是你的 ChatGPT OAuth 令牌，请像 API key 一样对待。
- harness 进程及其工具子进程以你的用户身份运行；与上游凭据文档一样，该文件对模型可驱动的工具并非隐藏。不要把模型的工作区指向你的 Harness home。
- 只有登录流程发出的 `https` 链接才会交给浏览器打开。
- 登录流程是 pi-ai 的官方实现（针对 `chatgpt.com` 的授权码 + device-code）；本插件只负责回答它的交互提示并保存结果。

## 已知限制

- **仅文本。** 图片输入会在任何供应商请求之前以 `UNSUPPORTED_CONTENT` 拒绝。
- **没有浏览器端 Models 页卡片。** 配置走 patch 层；登录用 CLI 或 `/codex` 命令。
- **无 provider 原生 replay 状态。** 历史 assistant 消息按 provider 中立内容重放（正确，但没有签名/缓存复用）。
- **浏览器登录假定有桌面浏览器。** 无浏览器的机器用 `--method device` 或 `/codex login device`。
- **同一时间只允许一次登录。** 回调服务器与存储锁会串行化并发登录。

## 开发

```sh
npm install
npm test        # 构建 lib/ 后运行 vitest（单元 + Loader 组合 + 已构建 bin 冒烟）
```

组合测试通过 Cordis Loader 启动真实的 `dsh-llm` 服务与本插件（仅 mock pi-ai SDK）；bin 测试在纯 Node 下验证已构建产物。

## License

MIT。`src/convert.ts` 的转换模块改编自 `@deepseek-ai/dsh-llm-pi-ai`（MIT，© DeepSeek AI）。
