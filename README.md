# Codex Mentor · 导师模式

DSH 0.2.0-rc.2 的独立模式 bundle。非 OpenAI/DeepSeek 官方产品；提示词为适配 DSH 工具的 Codex 风格导师协议，不宣称是官方 Codex 原始提示词或等效模型。

## 前置依赖

- **DeepSeek Harness `0.2.0-rc.2`**：当前精确兼容版本，其他版本尚未验证。
- **[dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect)**：需要独立安装、启用并完成 ChatGPT OAuth，提供 `openai-codex` GPT 路由；本插件不包含也不替代登录组件。已验证 `0.2.0-alpha.1`。
- **DeepSeek Flash 路由**：在 DSH 的 Models 设置中配置 DeepSeek 账户或官方 API，确认 `deepseek-flash` 可用。
- 开发测试需要 Node.js 22.23.2 或更新的兼容版本（原生 `registerHooks`）。

只需安装 **Codex Connect + Codex Mentor** 两个独立插件，不再需要 `dsh-codex-mentor-live-fix` 或 `dsh-codex-mentor-mode-fix`。

## 使用

安装打包后的 tarball（`npm pack --ignore-scripts --json`），以安装器的 applied/restart-required 状态为准；需要时重启现有 DSH 服务。新建会话，模式选择 **Codex Mentor · 导师模式**，主模型选择你已授权的 `openai-codex` GPT。不改变 Standard 或全局默认模型；已有导师会话会补装 Host 工具，但其 preset 版本不被擅自替换，完整能力以新会话验收。刷新页面可重新获取模式列表。

Flash 默认自动选择已配置且目录中包含 `deepseek-flash`（显示名 DeepSeek-V41-Flash）的 `deepseek-account`，其次 `deepseek-official`。选择发生在派工前，实际路由写入子会话描述和任务记录；推理失败不会自动换成 GPT，也不会切换账户。其他 provider 可以通过 `codex-mentor-host` 配置显式指定。缺凭据时在 Settings → Models 配置；目录可用不是推理成功的证明。

## 0.4：单插件安装

原来的模式修复和 Host 热加载激活合并到主 bundle。Host 使用相对、带版本的入口文件（内部载入带版本的模块 URL），不包含本机路径；升级不再需要另装 live-fix。安装器若报告 restart-required，仍应以其状态和 `CodexMentor.diagnostics` 的实际版本为准，不能仅凭包版本判断已生效。已有会话保留其 preset revision，不承诺所有模块都在不重启时更新。

从旧版本迁移：安装本版本后，移除旧的 live-fix 和 mode-fix，再检查诊断的 version、liveSessions.toolsReady 和 worker.route。

## 注册恢复与 Flash 能力

修复把 Agent 自身注册的桥接工具误当成可过滤继承工具、导致 `restrict()` 抛错并回滚全部导师工具的问题。只过滤 inherited scope；Agent 自身的竞争工具可能仍出现在工具表中，但调用被 guard 拒绝。诊断保留具体初始化错误，不再只显示“缺工具”。

Flash 上下文能力为 1,000,000 token，输出能力按用户指定的 384k 记为 384,000 token；此模式默认请求预算提升到 384,000，可针对任务调低，不要求填满。现有适配器已核实 1,000,000 上下文；其 `defaultMaxTokens: 256000` 是适配器默认值，不是此模式的请求预算，也不是已验证的输出硬上限。没有为了验收而烧满 384k 输出。

## 能力与实际执行一致

- Host 启用/重载时会补装已有导师会话的工具；在真实 Agent scope 中注册，卸载、切换和部分失败都会清理，不靠重新选择已开始的会话。
- `mentor_begin` 区分 collaborative、simple、direct、diagnostic。模式已选、工具就绪、路由已配置、实际启动 worker 是四个独立状态；诊断不冒充推理成功。
- 缺能力时仅允许诊断/询问。独立的 preset guard 在 Host 不可用时仍禁止执行原任务，不能静默变成普通单代理或 Agent Teams。
- 协作模式派工前允许最多三次初步调查；之后必须真实派工，或经用户明确选择直接执行。直接执行授权来自原生 `ask_user_question` 的实际单选回答，不接受模型口头声称用户同意、跳过或未答。
- `mentor_status` 和自动附加到最终文本的模式执行摘要显示真实派工、指导、接受、返工、取消和检查数量；待验收和仍运行的 worker 会明确标记。待办清单、shell 作业不算派工。
- blocked/ready-review 的 worker 不会被自己的记账通知重新唤起工作；收到指导/返工决定才继续。接管需显式说明、取消 worker 并取得直接执行授权。

## 协作

- GPT 用 `mentor_delegate` 派工；每个任务有独立 id、写范围、验收标准和固定 Flash 路由。可附不变量、接口、失败测试、开放问题和数学模型，保留 worker 的实现自主权。
- Flash 用 `mentor_report` 汇报；blocked 必须包含尝试、证据、具体问题，blocked 和 ready-review 会结束当前执行轮次。
- GPT 用 `mentor_guide` 给出诊断、下一步、验证标准、失败分支；投递给正在运行或可恢复的直接子会话。
- ready-review 必须通过 Evidence Gate：改动、检查、每个验收标准结果、偏离、假设和风险；GPT 用 `mentor_verify` 实际运行独立检查，并把返回的 `verification_ids` 交给 `mentor_review` 接受、要求返工或取消。缺少实际检查、失败检查、旧版本检查、仍在后台运行的检查都不能接受；检查覆盖是否充分仍由导师判断。所有终态同步给 worker 并阻止其继续执行；ready-review 不等于 accepted。
- `mentor_status` 默认返回紧凑目录，传 `task_id` 获取完整任务证据；`mentor_memory` 保存任务检查点或带验证状态的会话笔记。
- 默认最多 3 个未验收任务，同一个会话最多 64 个任务、20 条笔记；默认不允许递归派工。

空写范围任务采用只读工具白名单，禁止文件修改、Shell 和其他未列明工具，恢复后仍生效。非空写范围是派工协议和冲突检查，不是额外的 OS 文件沙箱；它会拒绝明显重叠的未结束任务，但不能识别符号链接别名，Shell 也未被限制到这些路径。真正的文件权限仍由 DSH 沙箱控制。父子共享工作目录，导师仍须审查 diff。取消请求不是停止完成；仍运行的子任务继续占用派工/写范围预算。

## 记忆和压缩

任务/指导/验收/检查点从 DSH 原生 tool/result 元数据、有来源归属的相邻 Agent 消息及注入的插件记账通知增量构建 Session projection，无自定义不可重放日志事件、外部数据库或后台轮询。派工先记录稳定 task/child ID，再创建子会话；派工或指导被接受后立即记账，不依赖最终工具结果是否被取消。压缩替换模型可见历史，不删除日志事实；恢复可以重建账本。导师事实与子代理假设分开，只有导师能记录 verified 笔记，且必须给出证据。

模式使用隔离的原生 compaction 子类，只添加导师续接摘要指令，保留 DSH 的压缩、取消与持久化逻辑。默认使用当前会话模型总结（GPT 主会话、Flash 子会话）；要统一摘要模型，可在 preset 的 `mentor-compaction.config` 中设置 `summarizationProvider` 和 `summarizationModel`。不是更改其他模式的压缩模型。

第一版记忆是会话内任务记忆，不是跨会话/跨项目长期知识库。新 worker 获得派工时的导师笔记快照；之后的新决定通过指导消息传递，不自动传播整个项目历史。

## 配置

Host `codex-mentor-host`：

| 字段 | 默认 |
|---|---|
| workerProvider | auto |
| workerModel | deepseek-flash |
| workerMaxTokens | 384000 |
| maxConcurrentWorkers | 3 |
| requireGptMentor | true |

`requireGptMentor` 默认校验主模型为 openai-codex GPT；没有偷偷切换模型/修改默认值。若接入其他 GPT provider，可关闭校验并在模型选择器中选该路由。

## 开发与安装

```bash
npm test
npm pack --ignore-scripts
```

测试依赖已安装的 DSH runtime；自动从 Node 安装目录定位，或指定 `DSH_RUNTIME_DIR`。在 DSH 插件管理器中安装生成的 tarball（或使用 `plugin_manager install_bundle`），不是在 DSH profile 目录手工运行包管理器。安装 GitHub 源码也应先检查 DSH peer 兼容性；本仓库没有安装脚本。

## 验证

在源码目录运行 `node --test test/*.test.mjs`（tarball 不包含测试；使用已安装的 DSH runtime 依赖，可用 `DSH_RUNTIME_DIR` 指定安装目录）。除协议测试外，使用真实 Cordis、AgentLoop、ToolRuntime、spawn continuable worker、JSONL 持久化和 session query，覆盖旧会话补装、Host 卸载/重载、缺能力阻止执行、双 worker 审查、阻塞→指导、实际独立检查→接受、日志重放及冷恢复。模型适配器是确定性脚本，不调用真实 GPT/Flash，不证明模型的复杂度分类或判断质量。

Host Inspect provider `CodexMentor.diagnostics` 是只读路由/模式及 liveSessions 工具就绪诊断，`state` 仅读取请求者自己的导师会话。安装和目录检查不等于真实模型推理或导师判断质量的验证。

DSH 已接入的子代理面板和工具卡用于查看会话与报告；本版本没有新建自定义看板。导师派工、主动求助、建议质量仍依赖模型行为，不承诺每次都能正确判断。
