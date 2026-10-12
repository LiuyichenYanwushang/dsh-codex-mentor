# v0.11.3 — 通讯文本放宽至32k

- 点对点消息、父子报告（summary/evidence/attempts/question）、导师指导（diagnosis/next_steps/validation/fallback）、继续生成附言和审查意见支持单字段32,000字符，按现有 JavaScript string length 计算，不是 token 或字节。
- 同步发送端、接收端与回放解码；结构化 JSON 协议总限额24,000→256,000字符，为多个32k字段和转义留空间，仍拒绝超限包而非丢弃或截断。
- 原生 Team 还有64 KiB字节边界；通过已提供的 agent-team.maxMessageBytes 配置提高 profile 单包上限至1 MiB，支持中文 UTF-8 与多字段包装，不修改 SDK。
- 恢复的安全提醒放在 diagnosis，nextSteps 保留附言原文，32k容量不被固定指令挤占。任务/model/权限/独立验收不变，8次话题预算不变，超长点对点消息在投递和预算变更前拒绝。讨论班、记忆与任务契约的独立上限不顺带修改。
- projection stateVersion 10 使升级后按原生日志重新计算；保留旧记录和已有验收，不迁移/删除数据，不恢复后台旧任务或重新打开手动界面。

验证：140/140 回归通过、0 skipped、无外部推理。已验证32k中文在真实普通 subagent 与原生 Team 的报告/指导/点对点/冷恢复，32001拒绝与历史回放。首轮工具描述同面原生启发式增量 Leader +27、worker +12 tokens，不是完整旧版本或外部计费。

生效以插件管理器 application 为准；若 restart-required，需安全结束现有工作后重启原 DSH。本次代码按用户要求直接推送 main 与版本标签。
