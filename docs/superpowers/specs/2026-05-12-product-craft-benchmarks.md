# Mission Control Product Craft Benchmarks

日期：2026-05-12

## 1. 为什么需要标杆

Mission Control 不是只要“功能能跑”。

它处理的是高复杂度工程任务：mission、agent、trace、diff、validation、gate、handoff、rollback。如果产品审美和信息架构不够好，用户会很快被状态、日志和 agent 行为淹没。

因此，从第一版开始就需要参考行业里在软件工程、人机交互和可观测性上做得最好的产品。

## 2. 产品体验标杆

### Linear

借鉴：

- 极高的信息密度。
- 快速、克制、少打扰。
- issue / project / status 的层级清楚。
- 快捷键和命令菜单优雅。

对 Mission Control 的启发：

- mission list 不能像普通后台表格。
- status、owner、risk、validation、pending gate 要能一眼扫读。
- 操作要短路径，不要多层 modal。

### Raycast

借鉴：

- 命令优先。
- 搜索和动作融合。
- 快速反馈。
- 插件体验一致。

对 Mission Control 的启发：

- CLI/TUI/command palette 应是同一套 action model。
- `mission new/plan/approve/validate/handoff` 要像高质量命令系统，而不是散乱脚本。

### GitHub

借鉴：

- diff、review、checks、PR timeline。
- 工程协作的事实记录。
- status checks 和 review gates。

对 Mission Control 的启发：

- mission timeline 应像 PR timeline 一样可靠。
- validation evidence 应像 checks 一样清楚。
- review/gate 必须有上下文和理由。

### Lazygit / k9s

借鉴：

- 终端里高密度、可操作的工程状态。
- 快捷键驱动。
- 面板式信息组织。
- 对复杂系统的低延迟浏览。

对 Mission Control 的启发：

- TUI 应围绕 mission、trace、diff、validation、tool calls 分屏。
- 不要做“漂亮但低密度”的终端 UI。

### Datadog / Honeycomb / Sentry

借鉴：

- 可观测性、trace、event、error triage。
- 从异常到根因的路径。
- 指标、事件、日志之间可跳转。

对 Mission Control 的启发：

- agent observability 不是日志堆砌。
- 从 failed validation 到 tool call、context、diff、change proposal 应该能连续追踪。

### JetBrains / VS Code / Zed

借鉴：

- 开发者工具的长时间使用舒适度。
- 快捷操作、面板组织、问题列表。
- editor integration 的边界感。

对 Mission Control 的启发：

- IDE adapter 只做轻集成，不把 engine 绑死在 editor UI。
- 跳转 artifact、diff、validation、handoff 要快。

## 3. 工程品味标杆

### Kubernetes

借鉴：

- 声明式 spec。
- controller / reconciler 思维。
- status 与 desired state 分离。

对 Mission Control 的启发：

- mission.yaml 是 desired work。
- events / telemetry 是 observed work。
- supervisor-agent 类似 controller，不直接替代事实记录。

### Temporal

借鉴：

- durable execution。
- workflow history。
- retry / failure / replay。

对 Mission Control 的启发：

- 长任务必须可恢复。
- event history 必须足够支撑 resume 和 debug。

### OpenTelemetry

借鉴：

- trace、span、event、metrics 的通用模型。

对 Mission Control 的启发：

- telemetry schema 后续应考虑 OTEL 兼容。
- tool call 可以类比 span。
- mission 可以类比 trace。

## 4. Craft Review Gate

任何 CLI/TUI/Web/IDE 体验变更都要做 craft review。

检查项：

- 命令名称是否清楚。
- 输出是否可扫读。
- 错误信息是否能指导下一步。
- 信息密度是否适合高频工程使用。
- 是否避免“demo 感”和玩具感。
- 是否有空状态、错误态、长文本、超多任务场景。
- 是否参考了至少一个同类标杆。

## 5. Human-centered UX Principles

Mission Control 的 UX 必须替用户思考，而不是把系统复杂度原样暴露出来。

用户不是来欣赏 agent 架构的。用户真正需要的是：

- 我现在该不该信这个任务。
- 我下一步要做什么。
- 哪些地方需要我判断。
- 哪些地方系统已经验证过。
- 哪些地方有风险。
- 如果错了，我怎么回退。
- 隔天回来，我怎样快速恢复上下文。

因此所有 UX 都要遵守：

### 5.1 Make the next action obvious

每个界面和命令输出都应该清楚显示下一步。

坏体验：

```text
status: needs_decision
```

好体验：

```text
Status: needs_decision
Next: review change-003 and approve/reject/split it
```

### 5.2 Protect attention

不要把所有日志、事件、工具调用平铺给用户。

默认展示：

- 当前状态。
- blocking issue。
- 最近关键事件。
- validation 结论。
- pending gate。
- 推荐下一步。

详细日志通过 drill-down 查看。

### 5.3 Preserve trust

用户需要知道 agent 为什么可信。

每个完成态都应绑定：

- acceptance。
- validation evidence。
- diff。
- review note。
- handoff。
- rollback path。

没有证据，就不应该用完成感 UI。

### 5.4 Respect human rhythm

AI agent 可以高速运行，但人类需要节奏。

产品应该支持：

- pause。
- resume。
- handoff。
- summary。
- pending decision queue。
- quiet mode。
- important interruption only。

### 5.5 Reduce recovery cost

用户最痛苦的不是失败，而是不知道如何恢复。

失败态必须显示：

- 失败原因。
- 最近相关事件。
- 失败命令。
- 可能影响范围。
- 推荐下一步。
- 是否能 retry。
- 是否需要 change proposal。
- 是否有 rollback checkpoint。

### 5.6 Design for repeated professional use

Mission Control 是工程工具，不是一次性 demo。

界面应该：

- 安静。
- 快速。
- 信息密度高。
- 状态稳定。
- 支持键盘。
- 支持扫描。
- 减少装饰。
- 避免营销化文案。

## 6. TBD / Needs Review

- 是否建立 screenshot / terminal capture golden review。
- TUI 第一版使用 Ink、Blessed、React CLI 还是其它库。
- Web dashboard 是否采用 TanStack Router/Table、shadcn/ui、Radix、Tailwind。
- 是否建立设计 token 和 interaction guidelines。
