# Mentor · 导师协作

保留历史包名 `dsh-codex-mentor` 和模式 ID `codex-mentor`，以兼容旧任务；从 0.8.0 起不再要求 Codex 担任 Leader。

DSH 0.2.0-rc.2 的独立模式 bundle。非 OpenAI/DeepSeek 官方产品；提示词为适配 DSH 工具的 Codex 风格导师协议，不宣称是官方 Codex 原始提示词或等效模型。

## 前置依赖

- **DeepSeek Harness `0.2.0-rc.2`**：当前精确兼容版本，其他版本尚未验证。
- **[dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect)**：**可选**，仅当你选择 Codex/GPT 路由时需要独立安装、启用并完成 ChatGPT OAuth，提供 `openai-codex` GPT 路由；本插件不包含也不替代登录组件。已验证 `0.2.0-alpha.1`。
- **DeepSeek Flash 路由**：在 DSH 的 Models 设置中配置 DeepSeek 账户或官方 API，确认 `deepseek-flash` 可用。
- 开发测试需要 Node.js 22.23.2 或更新的兼容版本（原生 `registerHooks`）。

使用其他已配置模型作为 Leader 时只需本导师插件和 Flash 路由；Codex Connect 不是必需依赖，不再需要 `dsh-codex-mentor-live-fix` 或 `dsh-codex-mentor-mode-fix`。

## 使用

安装打包后的 tarball（`npm pack --ignore-scripts --json`），以安装器的 applied/restart-required 状态为准；需要时重启现有 DSH 服务。新建会话，模式选择 **Mentor · 导师协作**，保留当前会话模型担任 Leader，不自动切到 Codex。不改变 Standard 或全局默认模型；已有导师会话会补装 Host 工具，但其 preset 版本不被擅自替换，完整能力以新会话验收。刷新页面可重新获取模式列表。

Flash 默认自动选择已配置且目录中包含 `deepseek-flash`（显示名 DeepSeek-V41-Flash）的 `deepseek-account`，其次 `deepseek-official`。选择发生在派工前，实际路由写入子会话描述和任务记录；推理失败不会自动换成 GPT，也不会切换账户。其他 provider 可以通过 `codex-mentor-host` 配置显式指定。缺凭据时在 Settings → Models 配置；目录可用不是推理成功的证明。

## 0.8.0：当前模型 Leader，可选协作后端

- 在原来的会话模型选择器里选择或中途更换 Leader；新选择作用于后续模型请求，不改写已经进行中的生成。模型需支持当前工具调用；本插件不注册、不替换你的模型路由，也不改变其他模式或全局默认模型。
- 在插件的 `codex-mentor-host` 配置中选择 `workerBackend: auto | subagent | team`。`subagent` 使用可继续的 Flash 子代理，即使原生 Teams 插件已开启也可选择；`team` 使用原生成员/任务板，要求 Teams 已启用且模型选项接口可用；`auto` 保持兼容，开启原生 Teams 时用 team，否则用 subagent。
- 新一轮任务也可明确指定 `mentor_begin({mode:"collaborative",task:"…",backend:"subagent"})` 或 `backend:"team"`。后端一经记录不在同一轮暗迁移；要换后端先结束旧轮。换 Leader 无需取消任务，不改变 task/child/report ID、Flash 工作模型、写权限或独立验收状态。
- `requireGptMentor` 默认 `false`。只有你明确将其设为 `true`，才恢复旧版 Codex/GPT-only 限制。历史包名/模式 ID 与 Inspect Provider `CodexMentor` 保持不变；Codex Connect 成为可选依赖。
- 本轮 69/69 确定性测试通过：真实 SDK 循环中模拟 Leader 从 DeepSeek 切换到 Codex，保持同一轮/任务/子会话/报告/标准，执行者仍为原来的 Flash，独立检查及接受、JSONL 回放和冷恢复均保留。这是脚本适配器验证，不是外部 GPT/Flash 推理，也未自动恢复旧项目任务。

## 0.7.0：固定验收协议与有界概览

- `mentor_delegate` 可传 `criteria: [{id: "A", description: "…"}]`；省略时以 `AC1` 表示整体验收。派工后 ID 不可修改；新任务的 `report.criteria` 使用 `{id, status: "PASS"|"FAIL"|"UNVERIFIED", evidence, scope}`，字符串只兼容没有固定契约的旧任务。`PASS` 是 worker 自评，不是导师接受；`mentor_review.assessments[].criterion` 必须使用原分配 ID。
- 接受被拒时，父任务为 `acceptance_blocked`，最新报告仍保留为已提交；JSON 诊断含 `code`、`reason`、`required_action` 及适用的 `criterion_id`/`verification_id`。只补诊断指出的具体缺项，不猜测、不反复重读。没有具体诊断时至多一次明确纠正，之后停止并说明限制；`closed-unaccepted` 关闭已提交但未接受的工作，不等于取消或缺输出。
- `mentor_status` 即使传 `task_id` 也默认紧凑；显式 `detail: "assignment"|"report"|"evidence"|"history"|"full"` 按需取回详情，`check_id` 定位一条已保存证据。`mentor_verify` 原始结果只在执行时返回一次，完整证据持久保留，常规状态使用预览和引用；`running`/`succeeded`/`failed` 不等于 criterion 通过，不承诺自动收集后台作业。
- 概览验收对象是 **有来源、范围明确的概览**，不是引用历史结论的数学或测试正确性。通常一个 worker，导师做 2–4 次有目的的独立检查，覆盖当前版本、实际公开入口、一个当前阻塞及来源时效；一次检查可支持多个标准，额外检查需写 `incremental_reason` 说明新增信息。固定结构：**定位 / 范围 / 最重要阻塞 / 来源与未验证**。不因报告长而扩大审计或索引全部函数；只纠正具体 claim，不重写整份报告。
- 空 `write_scope` 明示 `file_read: allowed`、`file_write: denied`、`shell: denied`、`tests: denied`；没有只读 Shell、`wc` 或 Git 例外。行数用 `read` 的 `totalLines`，Git/版本由导师处理；未来只读 Shell 能力不代表当前已授权。仅减少插件自有冗余载荷，不删除运行时安全快照。

本轮未重跑外部 GPT/Flash 推理；确定性测试与真实外部推理分开报告。2026-10-04 本轮只读诊断已确认 live 原生 Teams 的 `modelOptionsSupported: true`，此前旧模块缓存问题已不再复现，无需为本次主插件升级再重启。其他运行环境仍以实际 `mentor_begin`/诊断结果为准，主插件升级本身不保证清除原生模块缓存。最终结果只报告一次，不在报告后重新接受旧的初始任务。

## 0.6：原生智能体团队

导师模式的原生 Teams 路径由当前会话模型担任唯一 Lead（0.8.0 前为 Codex/GPT），`mentor_delegate` 创建固定 Flash 成员、原生名单和关联任务；原生消息负责耐久投递，导师协议负责求助、指导和独立验收。用户启用 Codex Mentor、此前已请求并启用 Teams 集成、且 `mentor_begin` 确认 ready team backend，三者共同授权仅经 `mentor_delegate` 创建必要 Flash 成员，无需再次询问；其他模式/原始原生成员创建仍须用户明确请求 Teams。仅选模式或调用 begin 不证明授权或能力，unsafe/hidden 路由及缺接口仍受 guard 阻止，不静默 fallback。人数及每个成员的 `reasoning_effort` 按任务决定，不固定两人或三人；可选程度由 `mentor_status` 返回真实能力，也可明确选择 `default`。关闭 Teams 时保留 continuable Flash 子代理路径；不更改其他模式或全局模型。

**原生接口依赖：** 原版 DSH `0.2.0-rc.2` 的 Teams 接口不能指定成员模型，会继承 Lead。本仓库提供可选的[原生接口补丁说明](<runtime-patches/README.md>)，不是另一个修复插件。明确同意修改运行时时，在停止 DSH 后执行：

```bash
node scripts/patch-native-teams.mjs --runtime /absolute/path/to/@deepseek-ai/dsh
```

补丁逐文件核对原版/已修补版 SHA-256，版本或内容不符即在写入前拒绝；无安装脚本自动修改运行时。需要启动新 DSH 进程。导师只在原生 `supportsAgentOptions === true` 时创建团队，否则转能力诊断，绝不把继承 GPT 的队员称为 Flash，也不静默退回另一后端。DSH 升级可能覆盖此可选补丁。

原生任务 `completed` 表示 Flash 已提交工作，**不是**导师 `accepted`；正式 Evidence Gate 和独立检查仍必需。返工/报告纠正会重新打开原生任务。Teams 不套用子代理的三成员硬上限，仍受原生成员上限（默认每个 Team 生命周期最多 16 个永久名字）、写范围冲突检查和任务账本容量约束；两条路径的概览通常都只需一个 worker，不把容量当成扩编理由。成员活跃/空闲也不是验收状态。

## 0.5：减少流程摩擦

- 父 run 绑定会话和输入身份；同一用户输入的日志/队列重放不会重新 begin。新请求归档 `lastCompletedRun`，状态同时暴露 `activeRun`、`activeTasks`、`recentTaskSummaries` 和上一轮统计。
- 派工返回 `effectiveCapabilities`，可声明 `required_capabilities` 预先拒绝不可执行任务。`write_scope: []` 禁用所有 Shell，包括只读 Git、hash 和测试；能力只描述任务级工具策略，原生工具可用性与沙箱仍须核查。
- 正式报告和终态以正常空步骤暂停，不再制造原生 refusal；普通 closing 不会生成 ready-review。缺报告停止显示 `stopped`，只能补交或取消。正常完成的冗余通知不再触发模型回复，错误/取消/超限通知仍保留。
- `mentor_wait` 使用原生结束当前 turn 来让出执行，报告到达后继续；它不是 Agent Teams，也不是轮询或额外计时器。
- `mentor_verify` 区分 `executionSucceeded` 与尚未判定的 `criterionSatisfied`；`mentor_review accepted` 必须按固定分配 ID 为每个 criterion 记录 expected/observed/interpretation/scope 和检查 ID，并明确整份有界报告可靠。不支持模糊的“整体接受、附带错误不采用”；应纠正错误 claim，再提交修正报告。
- 可用 `input_paths` 对证据依赖文件在执行前后做 SHA-256；只读文件读取、实际读取目标包含在指纹集合中、执行目录和内容未变且导师确认 claim/依赖范围相符时可复用报告前的检查。Shell 测试、网络和搜索证据暂不跨报告自动复用：依赖范围无法安全推断。未声明文件、环境、网络状态及新 claim 不在指纹保证范围内。指纹仍通过原生 Shell 权限执行，不绕过沙箱。
- 子代理后端的 `task_kind: overview` 限为一个 worker；Teams 人数由导师决定，但概览同样通常只需一个 worker。按 0.7.0 的有界概览规则做关键 claim 抽样、版本及时效核查，不默认扩大成审计。工作流统计只在工具元数据中展示，不再修改 final 正文。

原生 DSH 当前没有禁用 settlement 唤醒的 API；插件只能减少冗余模型请求，不能取消所有原生空 turn/后台通知。M14 暂不增加目录工具，优先使用窄范围发现；复杂断言质量仍取决于导师判断。

## 0.6.1：原会话继续生成

导师可对 `stopped`、未在运行的 worker 调用：

```js
mentor_resume({ task_id: "原任务 ID" }) // 默认发送「继续生成」
```

可选 `message` 加一句恢复指示，无需重填四段指导。沿用原 child/task ID、Flash 路由、思考配置与工作约束；不另派 worker，不接管，不撤销验收/取消。恢复提示要求先核对检查点、现有改动及未结束作业，避免重复写入或启动重复检查。`mentor_status` 和无报告停止通知提供此入口。

- 返回 `requested`/`queued` 只代表恢复消息被接收或排队，任务处于 `resuming`，不是已有进展、修复成功或验收通过。
- `running`、正在恢复、已结案及同任务并发恢复会拒绝；原生投递失败返回有限错误代码，保留原状态，不创建替代 worker，不无限重试。
- 相同旧停止通知的日志重放不会再次把已请求恢复的任务变成 stopped；恢复后的新失败仍会停止任务。
- 停止原因不自动标为网络中断。真实 provider 错误详情、遗留进程和改动的自动汇总尚未实现；此版本增加的是受控续接，不是完整的 P0 失败诊断。
- 0.5 旧子代理任务按它自己的后端恢复，即使当前已开启 Teams；新 Teams 功能仍要求原生模型接口补丁在服务重启后实际加载。

## 单插件安装

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
- `mentor_status` 显示真实派工、指导用途、接受、返工、取消和已登记验收检查（按证据类型区分）；不代表所有导师操作数量。待办、shell 作业不算派工，统计不追加或替换 final。
- blocked/ready-review 的 worker 不会被自己的记账通知重新唤起工作；收到指导/返工决定才继续。接管需显式说明、取消 worker 并取得直接执行授权。

## 协作

- GPT 用 `mentor_delegate` 派工；每个任务有独立 id、写范围、不可变 criterion ID 和固定 Flash 路由，结构化契约/报告格式见 0.7.0。可附不变量、接口、失败测试、开放问题和相关数学模型，保留 worker 实现自主权。
- Flash 用 `mentor_report` 汇报；blocked 必须包含尝试、证据、具体问题，blocked 和 ready-review 会结束当前执行轮次。快速指导与本地报告提交、旧 turn 结束通知交错时，账本按报告 ID 保留新指导，不把旧通知冒充新任务停止。worker 判定当前阻塞前须查更新记录；历史 TODO 不自动成为当前阻塞，模块职责须对照真实公开入口/定义，无测量不宣称“最大/最慢/全部”。
- GPT 用 `mentor_guide` 给出诊断、下一步、验证标准、失败分支；投递给正在运行或可恢复的直接子会话。报告纠正只处理指出的 claim/字段，纠正历史放 deviations，不改 criterion ID。
- ready-review 的 Evidence Gate 包含改动、检查、按分配 ID 的标准结果、偏离、假设和风险；GPT 用 `mentor_verify` 实际运行独立检查，以返回的检查 ID 填入 `mentor_review.verification_ids` 和每条 assessment。`accepted`、`rework`、`cancelled` 或 `closed-unaccepted` 各自明确记账；接受拒绝及停止规则见 0.7.0。缺实际检查、失败检查、已变化旧证据、仍运行检查都不能接受；成功执行不等于 criterion 通过，检查覆盖与语义由导师判断。终态阻止继续执行；提交并非接受。
- `mentor_status` 默认紧凑，即使指定 `task_id`；用显式 `detail` 取所需部分，用 `check_id` 查一条保存证据，不为恢复任务而反复拉取完整历史。`mentor_memory` 保存检查点或带验证状态的会话笔记。
- 子代理路径默认最多 3 个未验收任务；原生 Teams 路径由导师决定人数，受原生成员上限约束。同一个会话最多 64 个任务、20 条笔记；默认不允许递归派工。

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

在源码目录运行 `node --test test/*.test.mjs`（tarball 不包含测试；使用已安装的 DSH runtime 依赖，可用 `DSH_RUNTIME_DIR` 指定安装目录）。除协议测试外，使用真实 Cordis、AgentLoop、ToolRuntime、spawn continuable worker、JSONL 持久化和 session query，覆盖旧会话补装、Host 卸载/重载、缺能力阻止执行、双 worker 审查、阻塞→指导、实际独立检查→逐 criterion 接受、日志重放及冷恢复，并断言正式报告/接受冷恢复没有 refusal、没有多余 worker 推理，最终回答只出现一次。补充输入重放、历史归档、缺报告、能力拒绝、概览预算、语义断言和证据指纹复用的回归。模型适配器是确定性脚本，不调用真实 GPT/Flash，不证明模型的复杂度分类或判断质量。

Host Inspect provider `CodexMentor.diagnostics` 是只读路由/模式及 liveSessions 工具就绪诊断，`state` 仅读取请求者自己的导师会话。安装和目录检查不等于真实模型推理或导师判断质量的验证。

DSH 已接入的子代理面板和工具卡用于查看会话与报告；本版本没有新建自定义看板。导师派工、主动求助、建议质量仍依赖模型行为，不承诺每次都能正确判断。
