# Supermission 快速上手

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/hongbinzuo/supermission/main/scripts/install.sh | bash
```

或通过 npm 全局安装：

```bash
npm install -g @hongbinzuo/supermission
supermission --help
```

## 首次设置（每个项目一次）

```bash
cd your-project
supermission init              # 自动检测已安装的 Agent CLI（codex、claude、kiro、kimi 等）
supermission pipeline init     # 创建流水线模板
```

## 日常使用

### 一键执行（最简单）

```bash
supermission quick "修复登录验证 Bug"
supermission quick "给认证模块加单元测试" --backend codex
supermission quick "重构支付服务" --backend claude
```

### 多 Agent 流水线

```bash
# 标准功能开发：规划 → 编码 → 测试 → 评审
supermission pipeline run feature "添加 OAuth2 支持"

# 快速修复：复现 → 修复 → 验证
supermission pipeline run bugfix "修复支付模块空指针"

# 完整交付：规划 → 编码 → 测试 → 评审 → 部署
supermission pipeline run deploy "给 API 添加限流"

# 批量执行多个功能
supermission pipeline batch feature "添加登录" "添加注册" "添加密码重置"
```

### 分步执行（完全控制）

```bash
supermission new "添加用户验证" --validation "bun run test"
supermission plan work-001
supermission approve work-001
supermission run work-001 --backend claude
supermission validate work-001
supermission handoff work-001
```

## 查看状态

```bash
supermission board             # 看板视图
supermission list              # 活跃任务记录
supermission status work-001   # 单个任务状态
supermission summary work-001  # 详细摘要
supermission cost work-001     # Token 用量和成本估算
supermission trace work-001    # 事件时间线
supermission serve             # Web 仪表盘 localhost:4000
```

## 团队协作

```bash
# 初始化团队（一次）
supermission team init
supermission team add --name "Alice" --role lead
supermission team add --name "Bob" --role developer
supermission team add --name "Claude Worker" --kind agent --role agent --backend claude

# 分配任务
supermission new "修复登录 Bug" --assign bob
supermission assign work-001 --to alice
supermission board --mine              # 只看我的任务

# 释放分配
supermission release work-001
```

## Runner 配置

```yaml
# .supermission/runners.yaml（由 init 自动生成）
default_backend: auto
fallback_order: [codex, claude, kiro, kimi, gemini]
routing:
  planner-agent: gemini # 便宜，擅长规划
  worker-agent: claude # 编码最强
  tester-agent: codex # 擅长生成测试
  reviewer-agent: gemini # 便宜，擅长评审
```

## 自定义流水线

创建 `.supermission/pipelines/my-pipeline.yaml`：

```yaml
name: my-pipeline
description: 我的自定义流程
stages:
  - id: research
    role: planner-agent
    prompt: "调研这个任务的最佳实现方案"
  - id: implement
    role: worker-agent
    prompt: "按照最佳实践实现"
  - id: test
    role: tester-agent
    validation: "npm test"
    prompt: "编写并运行测试"
  - id: security
    role: reviewer-agent
    prompt: "检查安全问题"
    gate: approve_security
```

然后运行：`supermission pipeline run my-pipeline "你的目标"`

## 命令速查

| 命令                                      | 用途                   |
| ----------------------------------------- | ---------------------- |
| `supermission init`                       | 初始化项目，检测 Agent |
| `supermission quick "目标"`               | 一键端到端执行         |
| `supermission pipeline run <名称> "目标"` | 多 Agent 流水线        |
| `supermission board`                      | 看板视图               |
| `supermission list`                       | 列出活跃任务           |
| `supermission cost <id>`                  | Token/成本报告         |
| `supermission serve`                      | Web 仪表盘             |
| `supermission team init`                  | 初始化团队协作         |
| `supermission runner list`                | 显示可用 Agent         |

## 文件结构

```
your-project/
└── .supermission/
    ├── runners.yaml           # Agent 配置
    ├── pipelines/             # 流水线模板
    │   ├── feature.yaml
    │   ├── bugfix.yaml
    │   └── deploy.yaml
    ├── team.yaml              # 团队成员（可选）
    ├── policy.yaml            # 安全策略（可选）
    └── <work-id>/             # 每个任务的完整记录
        ├── work.yaml          # 状态、目标、负责人
        ├── events.jsonl       # 事件时间线
        ├── run.log            # Agent 执行日志
        ├── validation.log     # 测试结果
        ├── plan.md            # 计划产物
        ├── review.md          # 评审产物
        └── handoff.md         # 交接产物
```
