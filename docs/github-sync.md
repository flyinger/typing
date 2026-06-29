# GitHub 训练记录同步评估

TypingLab 的训练事实流是 append-only 数据：每台设备有稳定 `deviceId`，每次训练有 `sessionId`，每条事件有 `eventId`。这套模型天然适合 GitHub 这类“先拉取、追加文件、提交、推送”的同步方式，但训练记录里可能包含个人输入原文、错词、项目术语、设备名和周复盘，所以不能把“公开代码仓”和“个人训练数据仓”混为一谈。

## 结论

推荐顺序：

1. 私有数据仓保存完整训练记录。
2. 公开代码仓保存应用代码、内置材料和文档。
3. 公开仓只保存脱敏指标快照，不保存 raw sessions、raw events、材料原文和周复盘。

如果你坚持把记录放进公开仓，必须先把数据降级为公开安全格式：只保留日期、模式、速度、准确率、退格率、设备匿名标签、会话数量和事实流摘要；移除 `inputText`、`targetText`、事件 payload、材料内容、导入词库和周复盘正文。

当前最务实的落地方式是：`flyinger/typing` 做公开代码仓；另建一个 private 的 `typing-data` 仓保存 `TypingLab/` 同步目录。这样 Ubuntu 可以直接 pull 代码，训练记录也能通过 GitHub 合并，但不会把 raw 输入日志公开。

## 三种方案

| 方案 | 仓库可见性 | 保存内容 | 优点 | 风险 |
| --- | --- | --- | --- | --- |
| A. 私有数据仓 | private | `TypingLab/sessions/*.jsonl`、`materials/*.json`、`snapshots/*.json`、`exports/*.csv` | 完整可合并，可从事件重算 | 需要 GitHub 登录和拉取/推送习惯 |
| B. 公开代码仓 + 私有数据仓 | code public, data private | 代码公开，训练记录私有 | 最稳妥，Ubuntu 可直接 clone 代码，记录另行同步 | 多一个仓库 |
| C. 公开指标仓 | public | 脱敏周报、趋势 CSV、摘要 JSON | 可公开展示进步 | 不能还原原始训练事实流 |

不推荐：在公开 `flyinger/typing` 中提交完整 `TypingLab/` 原始同步目录。原因是事件日志会记录输入值、提示、粘贴、长停顿位置和材料内容，公开后很难彻底撤回。

## GitHub 仓库结构

私有数据仓建议：

```text
typing-data/
  TypingLab/
    sessions/
      macbook-2026-06.jsonl
      ubuntu-work-2026-06.jsonl
    materials/
      material-*.json
    snapshots/
      snapshot-*.json
    exports/
      typinglab-sessions-*.csv
    manifest.json
  README.md
```

私有数据仓建议额外放一个 `.gitignore`：

```gitignore
.DS_Store
*.tmp
*.part
*.swp
node_modules/
dist/
```

注意：私有数据仓不要忽略 `TypingLab/`，否则训练记录不会被 Git 跟踪。公开代码仓必须继续忽略 `TypingLab/`。

公开指标仓建议：

```text
typing-public-metrics/
  metrics/
    weekly-2026-W27.json
    trend-2026-06.csv
  README.md
```

## 跨设备流程

使用 GitHub 保存完整记录时，每台设备的动作应固定：

1. 打开 TypingLab 前，在私有数据仓执行 `git pull --ff-only`。
2. 在 TypingLab 的 Settings 里 `读取同步目录`，导入刚拉下来的 `TypingLab/`。
3. 训练结束后，在 Settings 里 `写入同步目录`。
4. 回到私有数据仓，检查变更只包含 `TypingLab/` 下的新事实流、材料、snapshot 或 exports。
5. 执行测试性检查：读取 TypingLab 健康面板摘要，确认没有材料引用错误或半同步提示。
6. 提交并推送私有数据仓。
7. 另一台设备重复 1-6。两边最终 fingerprint 应一致。

推荐提交信息：

```bash
git commit -m "sync: add typing records 2026-06-29 macbook"
git commit -m "sync: merge ubuntu typing records 2026-06-29"
```

不要把训练记录提交混在应用代码提交里。代码仓提交说明产品变化；数据仓提交说明哪台设备、哪天、做了训练记录同步。

关键规则：

- `sessions/*.jsonl` 只追加，不手工改历史行。
- `snapshots/*.json` 是缓存，冲突时可以删除后由应用重算。
- `manifest.json` 可能冲突，优先以最新完整目录重新写入生成。
- 同名材料不同内容保留两个版本，不覆盖。
- 重复导入按 `eventId` 和 `sessionId` 去重。

## Git 冲突处理

Git 同步 raw 记录时，冲突主要来自三个地方：

1. `TypingLab/manifest.json`：两台设备都写入后最容易冲突。处理方式是先保留两边完整的 `sessions/` 和 `materials/` 文件，拉取后在任一设备重新 `读取同步目录 -> 确认合并 -> 写入同步目录`，让应用重新生成 manifest。
2. `TypingLab/snapshots/*.json`：这是统计缓存，不是权威事实。冲突时可以删除冲突 snapshot，再由应用重算并重新写入。
3. `TypingLab/exports/*.csv`：这是导出视图，不是权威事实。冲突时以最近一次完整重算导出为准。

不要手工编辑 `sessions/*.jsonl` 里的行。JSONL 是权威事实流，手工编辑容易破坏 `eventId`、序列和摘要一致性。

## Git 同步前置检查

每次提交私有数据仓前至少检查：

```bash
git status --short
git diff --stat
git diff -- TypingLab/manifest.json
```

预期结果：

- 新增或修改集中在 `TypingLab/sessions/`、`TypingLab/materials/`、`TypingLab/snapshots/`、`TypingLab/exports/` 和 `TypingLab/manifest.json`。
- 没有 `typinglab-sync-*.json`、浏览器下载目录、临时文件、编辑器 swap 文件。
- manifest 的 counts 和 Settings 健康面板的摘要一致。

若要公开仓提交代码，先运行：

```bash
npm run doctor
```

`doctor` 会拒绝公开代码仓里出现 `TypingLab/` 或同步导出文件。这个保护不应用于私有数据仓。

## 评估指标

每次 Mac/Ubuntu 同步验收看这些指标：

- Settings 本机摘要：两台设备的 `sessions/events/materials` fingerprint 是否一致。
- 新增/跳过预览：重复导入时新增应为 0，跳过数量应等于已存在事实。
- 设备分布：Mac 和 Ubuntu 的训练会话都能在健康面板看到。
- 趋势重算：Analytics 的 7/30 日趋势在两台设备一致。
- 周复盘：同一周的训练天数、分钟数、平均速度、弱项和下周计划一致。
- 隐私扫描：公开仓不能出现 `TypingLab/`、`typinglab-sync-*.json`、`typinglab-events-*.jsonl`、`typinglab-sessions-*.csv` 或周复盘 Markdown。

## 公开安全导出计划

如果后续要做公开指标同步，应新增一个单独导出：

```json
{
  "schemaVersion": 1,
  "period": "2026-W27",
  "summary": {
    "sessions": 42,
    "minutes": 126,
    "averageCpm": 82.4,
    "averageAccuracy": 96.8,
    "backspacePer100Chars": 8.7
  },
  "modes": [
    { "mode": "english", "sessions": 16, "averageCpm": 88.1 },
    { "mode": "code", "sessions": 14, "averageCpm": 79.2 }
  ],
  "fingerprintShort": "abc123def456"
}
```

不包含：

- 原始输入文本
- 目标文本
- 错字、错词、弱词原文
- 事件 payload
- 设备真实名称
- 导入材料内容

## 产品需要补充的能力

要把 GitHub 同步做成产品级，需要补这些能力：

1. 数据仓模式开关：Settings 里明确选择 `文件同步`、`私有 Git 数据仓` 或 `公开脱敏指标`，不同模式显示不同风险提示。
2. 公开安全导出：新增 `导出脱敏指标`，只导出聚合指标和 fingerprint，不导出 raw 文本、材料和事件 payload。
3. Git 同步健康检查：显示上次读取目录、上次写入目录、当前 fingerprint、待提交文件数、manifest 是否可解析、是否存在冲突标记。
4. 数据仓预检脚本：为私有数据仓提供 `typinglab-data-doctor`，检查 manifest、JSONL、材料文件、摘要和冲突标记。
5. 桌面版 Git 助手：Tauri 版可以可选调用本机 Git，做 `pull --ff-only`、写入同步目录、预检、commit。push 仍建议显式确认。
6. 冲突恢复按钮：当 manifest 冲突或 snapshot 冲突时，提供“从事实流重建 manifest/snapshot”的产品入口。
7. 设备匿名化：公开指标导出里用匿名设备标签，不暴露真实 `deviceName`。
8. 周报分层：私有周报保留弱项原文；公开周报只保留模式级趋势、速度、准确率和达标状态。
9. 训练记录归档：按月归档旧 JSONL，减少数据仓 diff 噪声，同时保持可重算。
10. 发布前二次确认：如果目标仓是 public，任何包含 raw sessions/events/materials 的导出都应二次确认并默认阻止。

优先级：

- P0：私有数据仓 runbook、公开仓隐私保护、手动 pull/write/commit 流程。
- P1：公开安全指标导出、数据仓 doctor、manifest 重建。
- P2：Tauri Git 助手、自动提交模板、月度归档。

## 推荐执行方案

现在就能执行的方案：

1. `flyinger/typing` 作为公开代码仓，只提交代码、内置材料、文档和启动脚本。
2. 新建 private `flyinger/typing-data`，把 `TypingLab/` 放进去。
3. Mac 和 Ubuntu 都 clone 两个仓：代码仓用于运行应用，数据仓作为 Settings 的同步目录。
4. 每次训练：先 pull 数据仓，再读取同步目录；训练后写入同步目录，再 commit/push 数据仓。
5. 每周：导出一次脱敏周指标到公开仓或 README；raw 周复盘只留私有数据仓或本地笔记。

不建议现在做的方案：

- 把完整 `TypingLab/` 加入公开 `flyinger/typing`。
- 在同一次 commit 中混合应用代码和个人训练记录。
- 用 Git merge 手工解决 JSONL 行冲突。
- 让 Web MVP 自动 push GitHub。浏览器环境不适合直接持有 Git 凭据，应该等 Tauri 或外部脚本。

## 当前项目默认策略

当前 `.gitignore` 会忽略 `TypingLab/` 和所有同步导出文件。这个默认值适合公开代码仓。如果你确认要用 GitHub 保存完整训练记录，需要单独决定：

- 是在当前仓打开 `TypingLab/` 跟踪，还是另建私有数据仓。
- 是否允许提交材料原文和周复盘。
- 是否需要新增公开安全导出格式。
- 是否需要脚本把写入同步目录、隐私扫描、提交和推送串起来。

任何 `git add`、`commit`、`push` 或修改忽略规则来跟踪个人记录，都应单独确认后再做。
