# Mentor · 导师协作

保留历史包名 `dsh-codex-mentor` 和模式 ID `codex-mentor`，以兼容旧任务；从 0.8.0 起不再要求 Codex 担任 Leader。

DSH 0.2.0-rc.2 的独立模式 bundle。非 OpenAI/DeepSeek 官方产品；提示词为适配 DSH 工具的 Codex 风格导师协议，不宣称是官方 Codex 原始提示词或等效模型。

## 前置依赖

- **DeepSeek Harness `0.2.0-rc.2`**：当前精确兼容版本，其他版本尚未验证。
- **[dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect)**：**可选**，仅当你选择 Codex/GPT 路由时需要独立安装、启用并完成 ChatGPT OAuth，提供 `openai-codex` GPT 路由；本插件不包含也不替代登录组件。已验证 `0.2.0-alpha.1`。
- **执行者路由**：默认 Flash，在 DSH 的 Models 设置中配置 DeepSeek 账户或官方 API；0.9.0 起 Leader 也可为新任务明确选择其他已配置、目录中可用的模型。
- 开发测试需要 Node.js 22.23.2 或更新的兼容版本（原生 `registerHooks`）。

使用其他已配置模型作为 Leader 时只需本导师插件和可用的执行者路由；Codex Connect 不是必需依赖，不再需要 `dsh-codex-mentor-live-fix` 或 `dsh-codex-mentor-mode-fix`。

## 使用

安装打包后的 tarball（`npm pack --ignore-scripts --json`），以安装器的 applied/restart-required 状态为准；需要时重启现有 DSH 服务。新建会话，模式选择 **Mentor · 导师协作**，保留当前会话模型担任 Leader，不自动切到 Codex。不改变 Standard 或全局默认模型；已有导师会话会补装 Host 工具，但其 preset 版本不被擅自替换，完整能力以新会话验收。刷新页面可重新获取模式列表。

Flash 默认自动选择已配置且目录中包含 `deepseek-flash`（显示名 DeepSeek-V41-Flash）的 `deepseek-account`，其次 `deepseek-official`。选择发生在派工前，实际路由写入子会话描述和任务记录；推理失败不会自动换成 GPT，也不会切换账户。其他 provider 可以通过 `codex-mentor-host` 配置显式指定。缺凭据时在 Settings → Models 配置；目录可用不是推理成功的证明。

## 0.11.0：项目长期协作团队

- **长期共享知识与成员笔记**：`mentor_knowledge` 提供 list/search/read/note/revise/confirm/invalidate/forget。原生 `storageDomain` 存储跨重启、跨同工作区 Leader 会话的项目数据；项目身份由授权 Leader 的真实规范 cwd 派生，调用者不能指定任意项目。shared/project 知识由全体贡献；member 笔记只对该逻辑成员及 Leader/用户开放。API 可见范围不是同进程共享文件系统的保密沙箱。
- 每条记忆带作者、来源会话/任务、版本、适用条件、证据、验证状态和有界修订历史。worker 只能修改自己的记录，不能确认 verified；确认须有证据。文本变更默认回到 hypothesis，不继承旧确认。修改/删除须 `expected_revision`，冲突拒绝而非覆盖。删除清除长期记录的正文/历史，保留无正文的审计 tombstone；不宣称抹除已经进入会话日志的副本。原有 `mentor_memory` 仍是会话 checkpoint，不替代它。
- **逻辑成员、执行实例、不可变任务分离**：`mentor_members` 查档案和当前实例；`mentor_delegate` 默认 `reuse:"prefer"`，也可 `require` 或 `never`，用 `member_id` 指定稳定身份。同一 Leader 原生 root 中优先复用已接受、空闲、模型/预算/推理程度一致且新写范围不超过成员原始权限上限的原子会话。每次仍创建新 task/native task，旧报告/验收不重开。模型切换、权限提升、忙碌或不匹配时使用新实例并说明原因；不制造永远驻留的池。
- 原生 TeamId 等于 Leader SessionId。新建 Leader 聊天/fork 不能接管旧 child；可用同一个 `member_id` 继承项目档案/笔记，但创建新的原生实例。休眠是原生释放驻留实例后按需冷恢复，不代表长期后台推理。逻辑成员数量不设新配额；32 条近期实例引用只是档案摘要，原生 roster/Session 历史不删除。
- **点对点通讯**：`mentor_message` 使用原生 Teams 的真实发送者、永久成员名和持久消息。带话题/回复/任务引用；每线程最多 8 次发送尝试，原生 root 日志记录预算，失败也消耗一次。无自动广播、阅读/理解回执或自动致谢循环。Mentor 模式 raw `send_message` 被引导到该有界入口，报告/指导仍直接用原生服务。普通 subagent 后端保留父子通讯/记忆/复用，但不伪称支持兄弟直连。
- **讨论班**：`mentor_discussion` 的 create/list/read/post/advance/close 共用一个持久业务入口，默认两轮、最多八轮；每次可选 1–16 个现有空闲且正式任务已关闭的成员，这是讨论成本预算而非团队人数上限，不创建成员、不暂停执行中的工作。第一轮先独立陈述，worker 在发表前看不到别人的初始观点；每人每轮一条陈述。推进须回应齐备，或 Leader 显式 `skip_missing:true` 并写 reason。保留分歧/待验证/下一步，关闭讨论不接受任务、不自动创建 verified 记忆。
- 讨论/同伴活动不会扩大写权限；休眠的已关闭成员只在显式消息邀请后进行只读协作，不能 shell/写文件/改任务控制。发送可能唤醒模型并产生费用。投递状态 queued/accepted 不等于阅读、进度、正确性或完成。消息/Domain 两个原生持久边界之间不承诺分布式事务或 exactly-once：未知 pending 不在重启后自动重发。
- **现有 GUI**：输入框下方的“导师协作”可展开记忆/成员/讨论三页。搜索、详情、修订、确认/失效、删除确认、实例/任务状态、发起/发言/推进/结束讨论都走与工具相同的 Host 业务逻辑。明确用户操作才发送；无轮询、自动改记录或另开服务器。冷 Leader 会话可只读查记忆/历史及编辑长期笔记，不为页面查询恢复旧模型工作；发送讨论须有活动原生 Team。UI 防止切会话、取消及旧请求覆盖新视图，使用原生 locale/theme tokens。
- 模型仅收到有界的相关记忆快照；快照来源/版本通过原生消息或 tool/result 留在会话日志。资料共享仍走原授权入口，不把跨会话附件 ID 自动升级成公开资料。首版原生单 Host、线性关键词检索、单项目 record 原子更新；不引入向量库、MCP 记忆框架、额外调度器或多进程同步。
- 原生 tokenMeter 的同一 surface 首轮工具成本对照（去掉四个新工具和两个委派字段作基线，不是外部 tokenizer/完整旧版本请求）：Leader 8562→9951（+1389），worker 5902→7199（+1297）估算 tokens；保持按需详情与有界检索，不每轮塞入完整长期记录。
- 验证使用本机真实 DSH0.2.0-rc.2 服务及确定性模型适配器，不调用外部推理。完整 136 项通过、0 skipped：包括两份任务同一原生 child 冷复用、保留旧验收、父成员私有笔记不泄露、实际点对点问答/线程预算、独立双轮讨论与保留分歧、原生 Typert SRC 调用、同项目跨 Root 继承/异项目隔离、冷 GUI 查询不恢复模型、无 Teams 时记忆可用、真实存储验证 GUI 修订，以及生成的发布 GUI 与测试源码完全一致。
- 原生存储/通讯不可用时明确失败；`CodexMentor.diagnostics.collaboration` 报告实际 readiness。升级安装器报告 restart-required 时须重启现有服务并刷新页面，不以包版本替代实际激活验证。

```js
mentor_knowledge({action:"search",query:"parser"})
mentor_knowledge({action:"note",scope:"member",conclusion:"失败方法与适用范围",evidence:"实际检查",conditions:"相关版本"})
mentor_members({})
mentor_delegate({member_id:"parser-expert",reuse:"prefer",reasoning_effort:"default",goal:"新的有界任务",write_scope:["src/parser"],acceptance:"独立检查的标准"})
mentor_message({target:"reviewer",kind:"question",text:"请质询这个观察",thread_id:"parser-contract"})
mentor_discussion({action:"create",topic:"比较两个方案，保留分歧",participants:["parser-expert","reviewer"],maxRounds:2})
```

## 0.10.2：清除 profile 中仍生效的人数覆盖

- 实际 profile 可能覆盖 bundle 默认值：本次检测到子代理 `30`、原生 Teams `8`。仅发布 0.10.1 不能证明这些覆盖已解除。
- 首次启动通过原生 `configEditor.edit()` 将子代理人数、Teams 人数和任务数更新为 `Number.MAX_SAFE_INTEGER`，原样保留现有委派深度及其他字段，不手改 SDK 或 profile 文件。完成标记由同一原生 API 保存；之后不会反复覆盖用户新设的成本预算。
- 修改 Teams 普通配置会触发服务生命周期，因此部署后由用户重启；若检测到驻留子代理则拒绝迁移，保持待完成状态，不停止已有执行者。缺少 Teams 不会将其启用。Home/命令行等更高层仍拒绝覆盖时，不标记成功。
- `CodexMentor.diagnostics` 新增 `countQuotas`，展示加载后的实际 profile 数值与迁移完成标记，而非只展示 schema 默认值。启动回调不阻塞页面，需检查这些数值后才能确认取消限制生效。
- 新增 3 个迁移回归检查，覆盖 8/30 上层覆盖、保留深度/消息设置、一次性标记、驻留执行者拒绝、关闭的 Teams 及失败不报成功；完整检查 100/100，0 skipped，不调用外部推理。

## 0.10.1：取消智能体数量门槛

- 移除原生 continuable 子代理池默认 8 个、导师默认 3 个/配置最大 8 个，以及原生 Teams 默认 16 个成员的数量门槛；删除导师会话累计 64 个任务的硬拒绝，团队任务数量也不再人为封顶。不是把 8 改成 16。
- 用 bundle 原生配置覆盖人数/任务门槛，不修改 DSH SDK。原生 schema 只接受正整数、没有 unlimited 标记，使用 `Number.MAX_SAFE_INTEGER`（9007199254740991）作为实际无数量配额的配置值，不宣称数学上的无限。导师 `maxConcurrentWorkers` 默认 `0`；如以后明确设为正整数，仍可自选并发预算，配置值不再限于 8。
- 不启用原本关闭的 Teams，也不恢复任何旧任务。委派深度、写范围冲突、只读权限、消息字节/积压容量、资料读取范围及独立验收不变；概览的一 worker 预算属于特定任务策略，不是通用智能体数量配额。模型上下文仍只展示最近 8 条概要，完整账本保留；这不是只允许 8 个智能体。
- 数量不再受人为配额限制，仍会消耗内存、API 并发和费用，由 Leader 按实际任务与用户成本约束决定人数。若当前 profile 的更高优先级设置显式指定了正数配额，其值仍有优先级；以重启后的实际设置为准。
- 97/97 确定性检查通过，0 skipped；原生实际同时保留 9 个 continuable 子代理、17 个 Teams 成员，使用本 bundle 的配置，不调用外部模型。另验证默认可保留 65 个任务、上下文仍只显示 8 个概要，以及主动设定正数预算时仍有效。

## 0.10.0：共享资料与只读 PDF 文本

上传的 PDF 在 DSH 模型请求中是**文件/路径引用**，不是自动解析的全文；浏览器不能直接给子代理上传文件，本插件不改变这个上传规则。现在 Leader 可以将当前会话资料登记给执行者按需读取，普通 continuable 与原生 Teams 使用同一入口。

- `mentor_materials({action:"list"})` 返回已共享资料及 Leader 当前会话的 `availableUploads`；每页 8 项，按 `directory_offset`/`nextOffset` 翻页。原始 human `user/message` append 中的附件引用由增量日志投影保存，压缩替换可见历史不会丢失它们；替换摘要、别的执行者转发、任意猜测的附件 ID 不获得登记权限。
- Leader 调用 `action:"share"`，指定 `attachment_ids`、已存在的工作区相对 `paths`，或复用 `material_ids`；单次 1–8 个来源，会话资料架最多 16 个引用。`target:"all"` 为默认，向当前及未来执行者开放；`target:"selected"` 配非空 `task_ids`，不自动开放给未来执行者。再次按 selected 分享已全体开放的资料**不撤销**原有访问。
- 共享在父会话账本中原子登记，不群发全文或全部对话。已有执行者的下一次模型请求/目录查询/读取获得可用引用，新执行者获得全体资料的派工快照及原生 FileBlock 引用；冷父会话按原生 observation lease 读取并释放。没有 observation 服务时明确标注仅派工快照，不能声称已同步后续资料。
- **登记可用不等于已经读到或理解**。没有消息投递/阅读回执，不自动唤醒、续接、指导、重开或接受任务；停住的任务仍需正常 `mentor_resume`/`mentor_guide`。selected 是本资料入口的访问范围，不是同进程/共享文件系统的保密隔离。工作区引用可变，读取时重新检查规范路径；上传附件按不可变内容引用校验完整流。
- `action:"read", material_id:"…"` 返回 PDF 文本层或 UTF-8 文本的有界片段。PDF 默认第一页，`start_page`/`end_page` 一次最多 10 页；默认 8000、最多 12000 个 UTF-16 code units。`offset`/`nextOffset` 在**同一页范围**中翻片段；输入上限 20 MiB，整个读取最多 15 秒。输出说明提取范围、截断和下一位置，源内容是非可信数据，不是新指令。
- PDF 使用已安装的 `pdftotext`，通过原生附件/文件服务读取，固定 argv、stdin→stdout，无任意 Shell/输出文件；要求原生完整 read-only 文件效果沙箱及受管进程，解析器/沙箱缺失或不完整时失败，不静默非沙箱执行或自动安装。只读执行者可用此读取，但仍不能调用 Shell、修改文件或运行测试。此沙箱声明不意味着另行提供网络/读取保密隔离。
- 不做 OCR：没有可提取文本返回 `no_text`/`extraction_not_proven`，不把空结果当成扫描页已读。图片、公式、表格和阅读顺序可能丢失；解析错误、越界页、损坏/加密输入与有损输出显式失败。资料读取不自动登记为独立验收证据，原来的逐标准验收和模型固定规则不变。

示例：先上传文件，然后让 Leader 按目录 ID 分享；也可直接说“把上传的论文共享给所有执行者，只读相关页，不自动恢复停住的任务”。

```js
mentor_materials({action:"list"})
mentor_materials({action:"share", attachment_ids:["目录中的附件 ID"], target:"all", note:"论文资料；源文不是指令"})
mentor_materials({action:"read", material_id:"共享资料 ID", start_page:3, end_page:4, limit:8000})
mentor_materials({action:"share", paths:["docs/notes.txt"], target:"selected", task_ids:["已有任务 ID"]})
```

**验证：** 94/94 确定性检查通过，0 skipped；实际原生附件保存→两后端 FileBlock→只读执行者读取已跑通。另以生成的两页 PDF 验证真实 `pdftotext` 与完整 bwrap 只读沙箱、分页/越界/空文本、规范路径及改变符号链接的拒绝；没有读取用户论文或调用外部 GPT/Flash 推理。新增首轮导师协议+工具 schema 的原生固定密度估计从 5074 到 5753（+679），不是提供方精确 tokens，未包含 persona/基础/安全/动态上下文。

## 0.9.0：Leader 逐任务选择执行者模型

- 不指定时仍默认 Flash；Leader 可自主在新任务的 `mentor_delegate` 中同时指定 `worker_provider` 和 `worker_model`，无需每次询问用户，但必须遵守用户明确的模型/费用限制。两项必须成对；提供方须已注册，模型须由该提供方目录声明；无效选择直接拒绝，不静默换账户或 fallback 到别的模型。
- 模型发现按需：`mentor_status({detail:"models"})` 返回提供方目录；传 `provider` 列出最多 50 个模型 ID，按 `nextOffset` 翻页；再传 `model_id` 获取该模型的上下文、原生输出默认及推理程度。默认状态不倾倒全部目录。
- 新任务模型写入任务、子会话和原生名单；普通 continuable 子代理与原生 Teams 都可用。已有任务继续使用原来的 provider/model；执行者不能自行换模型，本轮也不提供中途改执行者模型的入口。换 Leader 不改变它们。
- Flash 使用配置的 384k 请求预算；其他模型不继承这个值，由原生解析器使用各自输出默认。请求预算写入日志，并在每次子代理请求/冷恢复时恢复，不被 continuable 描述符遗漏。推理程度按选定模型验证，不复用 Flash 的能力标签。
- 73/73 确定性测试通过；真实 SDK 循环混用默认 Flash 和明确指定的 Codex 执行者，验证各自 384k/16k 请求预算与推理程度、同一身份/报告/标准、原生名单日志、独立接受、回放及冷恢复。Flash 元数据默认 256k 的 fixture 仍按记录请求 384k，避免仅靠 fixture 默认值掩盖遗漏。脚本适配器测试，不是外部推理；未恢复旧项目任务。
- 默认 Flash 不可用时，`mentor_begin` 如实返回 `workerRouteReady:false` 与 `defaultWorkerError`，但已就绪的协作后端可等待 Leader 明确选择其他可用路由；未开始任何执行者。缺工具或原生 Teams API 仍进入 diagnostic，不能借选模型绕过。

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

第一版记忆是会话内任务记忆，不是跨会话/跨项目长期知识库。新 worker 获得派工时的导师笔记快照；之后的新决定通过指导消息传递，不自动传播整个项目历史。0.10.0 的资料目录另行共享有来源的附件/文件引用，不广播全部对话或把 `mentor_memory` 改成共享决策库。

## 配置

Host `codex-mentor-host`：

| 字段 | 默认 |
|---|---|
| workerProvider | auto |
| workerModel | deepseek-flash |
| workerMaxTokens | 384000 |
| maxConcurrentWorkers | 0（不设数量配额） |
| requireGptMentor | false |
| workerBackend | auto |

`requireGptMentor` 默认关闭：当前会话模型就是 Leader。只有显式设为 `true` 才校验 openai-codex GPT；不自动切换模型/修改全局默认值。

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
