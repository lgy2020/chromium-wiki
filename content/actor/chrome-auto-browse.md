# Chrome Auto Browse 技术架构深度分析

> 基于 Chromium 源码的 GLIC + Actor 框架解析

---

## 概览

Chrome 的 Auto Browse（自动浏览）功能在 Chromium 源码中的内部代号是 **GLIC**（Gemini in Chrome）+ **Actor** 框架。这不是一个简单的扩展，而是**深度集成到浏览器内核的 AI Agent 系统**。

**核心代码路径：**

| 路径 | 说明 |
|------|------|
| `chrome/browser/glic/` | GLIC UI 层（WebUI、侧边栏、策略管理） |
| `chrome/browser/actor/` | Actor 执行引擎（工具系统、任务管理） |
| `chrome/common/actor.mojom` | Actor IPC 接口定义 |
| `chrome/browser/glic/host/glic.mojom` | GLIC 完整 IPC 接口（2000+ 行） |

**Feature Flag：** `GlicActor`、`GlicActorUi`

---

## 整体架构

```
┌─────────────────────────────────────┐
│   Gemini Web Client (前端 WebUI)    │  ← 云端 Gemini 模型决策
│   chrome://glic                     │
└──────────────┬──────────────────────┘
               │ Mojo IPC
┌──────────────▼──────────────────────┐
│   GlicKeyedService (浏览器进程)      │  ← 服务入口，管理生命周期
│   ├── GlicActorTaskManager          │  ← 任务调度器
│   ├── GlicActorPolicyChecker        │  ← 权限/策略检查
│   └── GlicInstanceImpl              │  ← 会话实例管理
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   ActorKeyedService                 │  ← Actor 系统核心服务
│   └── ActorTask                     │  ← 单个任务实例
│       ├── ExecutionEngine           │  ← 执行引擎（状态机）
│       ├── ToolController            │  ← 工具控制器
│       └── UiEventDispatcher         │  ← UI 事件分发
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Tool（具体操作工具）               │  ← 实际操作浏览器
│   ClickTool / TypeTool / ScrollTool │
│   NavigateTool / SelectTool         │
│   DragAndReleaseTool / MouseMoveTool│
│   ScriptTool / MediaControlTool     │
│   AttemptLoginTool / FormFillingTool│
│   WaitTool / HistoryTool            │
│   LoadAndExtractContentTool         │
└─────────────────────────────────────┘
```

---

## GLIC 服务层

GLIC 是 Chrome 侧边栏中的 Gemini 聊天界面，通过 `chrome://glic` WebUI 承载。

**关键设计：**

- **Profile 级单例**：每个 Chrome Profile 只有一个 GlicKeyedService
- **Side Panel 集成**：通过 `GlicSidePanelCoordinator` 管理侧边栏展示
- **Cookie 同步**：`GlicCookieSynchronizer` 确保 WebUI 中的 Gemini 能访问用户的 Google 登录状态
- **Profile Manager**：`GlicProfileManager` 管理多 Profile 场景下的 GLIC 实例

---

## Actor 任务系统

### 任务状态机（ActorTask）

任务有明确的生命周期状态：

- **kCreated**：任务刚创建
- **kActing**：Actor 正在执行操作（用户无法操作受控 Tab）
- **kReflecting**：执行完一个动作后等待观察结果
- **kPausedByActor**：Actor 暂停（如等待页面加载）
- **kPausedByUser**：用户暂停（用户可以操作受控 Tab）
- **kWaitingOnUser**：等待用户输入/确认
- **kFinished / kCancelled / kFailed**：终态

**状态流转：**

```
kCreated → kActing → kReflecting → kActing → ... → kFinished
                ↓                      ↑
          kPausedByActor ─────────────┘
                ↓
          kPausedByUser → kCancelled
                ↓
          kWaitingOnUser → kActing → ...
```

**关键特性：**

- **Tab 控制权管理**：任务通过 `ActorControlledTabState` 管理受控 Tab，Actor 控制时用户无法交互
- **崩溃恢复**：`attempted_reload_after_crash_` 限制每个任务只尝试一次崩溃 Tab 重载
- **Journal 系统**：所有操作记录到 `AggregatedJournal`，用于调试和审计

### 执行引擎（ExecutionEngine）

执行引擎是 Actor 系统的核心调度器，管理单个动作的完整生命周期：

**状态流转：**

```
Init → StartAction → ToolCreateAndVerify → UiPreInvoke → ToolInvoke → UiPostInvoke → Complete
  ↑                                           |              |              |
  └───────────────────────────────────────────┴──────────────┴──────────────┘
```

**安全机制：**

- **Origin Gating**：每次导航都检查目标 URL 是否安全
  - 同源导航：直接放行
  - 静态白名单/黑名单：按规则匹配
  - 未知 Origin：异步检查 + 可能需要用户确认
- **Affiliation Check**：通过 `affiliated_origin_map_` 检查关联域名（如 google.com → youtube.com）
- **Server Confirmation**：对于敏感导航，可能需要服务端确认

---

## Tool 系统

每个 Tool 都继承自 `Tool` 基类，实现标准接口：

- `Validate()` — 前置验证
- `Invoke()` — 执行操作
- `Cancel()` — 取消执行
- `TimeOfUseValidation()` — TOCTOU 检查

**完整工具清单（18 种）：**

| 工具 | 功能 |
|------|------|
| ClickTool | 点击页面元素 |
| TypeTool | 在输入框中键入文字 |
| ScrollTool | 滚动页面 |
| ScrollToTool | 滚动到指定内容并高亮 |
| NavigateTool | 导航到 URL |
| SelectTool | 选择元素/文本 |
| DragAndReleaseTool | 拖拽操作 |
| MouseMoveTool | 移动鼠标 |
| ScriptTool | 注入并执行脚本 |
| MediaControlTool | 控制媒体播放 |
| WindowManagementTool | 管理窗口 |
| TabManagementTool | 管理标签页 |
| AttemptLoginTool | 自动登录（密码/联合登录） |
| AttemptFormFillingTool | 表单自动填充 |
| AttemptOtpFillingTool | OTP 验证码填充 |
| WaitTool | 等待条件满足 |
| HistoryTool | 操作浏览器历史 |
| LoadAndExtractContentTool | 加载页面并提取内容 |

---

## IPC 接口（Mojo）

GLIC 的 Mojo 接口定义在 `glic.mojom` 中（2000+ 行）。

### WebClientHandler（浏览器 → Gemini）

- `GetContextFromFocusedTab()` — 获取当前 Tab 的上下文（文本、截图、PDF、注释内容）
- `CreateTask()` — 创建 Actor 任务
- `PerformActions()` — 执行动作序列（序列化的 protobuf）
- `StopActorTask()` — 停止任务
- `PauseActorTask()` / `ResumeActorTask()` — 暂停/恢复
- `CaptureScreenshot()` — 截图

### WebClient（Gemini → 浏览器）

- `NotifyActorTaskStateChanged()` — 通知任务状态变化
- `NotifyFocusedTabChanged()` — 通知焦点 Tab 变化
- `RequestToShowCredentialSelectionDialog()` — 请求显示凭据选择对话框
- `RequestToShowUserConfirmationDialog()` — 请求用户确认（敏感操作）
- `RequestToConfirmNavigation()` — 请求确认导航到新 Origin

---

## 安全与权限体系

### 多层权限检查

**第一层：Profile Enablement**
- feature_disabled / primary_account_not_capable / primary_account_not_fully_signed_in
- disallowed_by_chrome_policy / disallowed_by_remote_admin
- actuation_not_consented（需要单独同意 Actuation）

**第二层：Actuation Eligibility**
- kEligible / kMissingAccountCapability / kMissingChromeBenefits
- kDisabledByPolicy / kEnterpriseWithoutManagement / kPlatformUnsupported

**第三层：Site Policy**
- 同源放行 / 静态白名单/黑名单 / 企业策略白名单/黑名单 / 服务端敏感站点确认

### Actor 控制模式

当 Actor 控制 Tab 时：
- 用户无法与受控 Tab 交互（通过 `actuation_runner` 实现）
- Tab 保持可见（防止被丢弃）
- 外部弹窗被禁用（macOS 平台）
- 导航被拦截（通过 `ActorNavigationThrottle`）

### 凭据安全

自动登录功能有独立的安全层：
- `ActorLoginService` 管理登录凭据
- 用户必须通过 `SelectCredentialDialog` 明确授权
- 支持 `UserGrantedPermissionDuration`（一次性/永久允许）
- 联合登录（Sign in with Google）有专门的 `AttemptLoginTool`

---

## Android 端实现

Android 版本的 Actor 通过 JNI 桥接：

- `glic_keyed_service_android.cc` — Android 版 GlicKeyedService
- `co_browse_views_bridge.cc` — CoBrowse 视图桥接（用于在 Tab 底部面板中展示 Actor 操作）
- `glic_actor_login_bridge.cc` — Actor 登录桥接
- `glic_enabling_android.cc` — Android 特有的启用逻辑

---

## 数据流：完整操作流程

以"帮我在某网站订会议室"为例：

**步骤 1**：用户在 GLIC 侧边栏输入："帮我在 xxx.com 订一个明天下午 3 点的会议室"

**步骤 2**：Gemini Web Client 收到用户输入，开始推理

**步骤 3**：调用 `CreateTask()` 创建 ActorTask（设置 title、duration）

**步骤 4**：调用 `GetContextFromFocusedTab()` 获取当前页面上下文
- innerText：页面文本内容
- viewport_screenshot：当前视口截图
- annotated_page_content：结构化页面内容（protobuf）

**步骤 5**：Gemini 分析上下文，生成 Action 序列（protobuf）
- Action 1: NavigateTool → 导航到 xxx.com
- Action 2: ClickTool → 点击"预约"按钮
- Action 3: TypeTool → 输入时间
- Action 4: ClickTool → 点击确认

**步骤 6**：调用 `PerformActions(actions_proto)`，ExecutionEngine 逐个执行
- StartAction → SafetyChecksForNextAction（检查 Origin）
- ToolCreateAndVerify → 验证目标元素存在
- UiPreInvoke → UI 反馈（进度条等）
- ToolInvoke → 实际执行
- UiPostInvoke → 更新 UI
- Complete → 进入 Reflecting 状态，观察页面变化

**步骤 7**：执行完毕，返回 ActionsResult 给 Gemini

**步骤 8**：Gemini 生成回复："已经帮你预约了明天下午 3 点的会议室"

---

## 关键技术总结

1. **不是扩展，是内核功能**：Actor 框架直接集成在浏览器进程中，通过 Mojo IPC 与 Gemini WebUI 通信，拥有完整的浏览器控制能力

2. **状态机驱动**：每个任务都是一个严格的状态机，支持暂停/恢复/中断/取消，确保操作可控

3. **多层安全防护**：从账号权限、站点策略、Origin 检查到用户确认对话框，层层防护

4. **工具化设计**：所有操作都是独立的 Tool，易于扩展新能力

5. **观察-行动循环**：每个动作执行后都会观察页面变化（Reflecting 状态），基于观察结果决定下一步

6. **崩溃恢复**：Tab 崩溃时自动重载（每个任务最多一次），保证鲁棒性

7. **跨平台**：Desktop（Windows/Mac/Linux）+ Android，通过 CoBrowse 桥接在移动端实现

8. **企业级控制**：支持 Chrome Policy、远程管理、企业白名单/黑名单

---

*基于 Chromium trunk 源码分析 · 2026-05-13*
