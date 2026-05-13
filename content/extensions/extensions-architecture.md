# Chrome Extensions 扩展系统架构

> 基于 Chromium 源码的扩展系统深度解析

---

## 概览

Chrome 扩展系统是 Chromium 中最庞大的子系统之一。源码位于 `extensions/` 目录，包含 **3000+ 文件**，涵盖从浏览器 API 绑定到内容脚本注入的完整生命周期。

**核心代码路径：**

| 路径 | 说明 |
|------|------|
| `extensions/browser/` | 浏览器进程中的扩展基础设施 |
| `extensions/browser/api/` | 所有 Chrome API 的实现（50+ 个 API） |
| `extensions/renderer/` | 渲染进程中的扩展运行时 |
| `extensions/common/` | 跨进程共享的常量、类型、Mojo 接口 |
| `extensions/shell/` | 扩展系统 Shell（独立运行扩展的最小环境） |

---

## 多进程架构

Chrome 扩展系统采用多进程架构，扩展代码运行在不同的进程中：

```
┌─────────────────────────────────────────────┐
│              Browser Process                 │
│  ┌─────────────────────────────────────────┐│
│  │  ExtensionService                       ││
│  │  ├── ExtensionRegistry                  ││
│  │  ├── ExtensionHost (background page)    ││
│  │  ├── ProcessManager                     ││
│  │  └── ExtensionPrefs                     ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │  API Layer                              ││
│  │  ├── ExtensionFunctionDispatcher        ││
│  │  ├── ExtensionFunction (per API call)   ││
│  │  └── EventRouter                        ││
│  └─────────────────────────────────────────┘│
└────────────────────┬────────────────────────┘
                     │ Mojo IPC
┌────────────────────▼────────────────────────┐
│           Renderer Process                   │
│  ┌─────────────────────────────────────────┐│
│  │  ModuleSystem (require/exports)         ││
│  │  ├── NativeExtensionBindingsSystem      ││
│  │  ├── SafeBuiltins                       ││
│  │  └── FeatureCache                       ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │  Content Script                         ││
│  │  ├── ScriptContext                      ││
│  │  ├── WorldEnum (MAIN/ISOLATED)          ││
│  │  └── ContextType detection              ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

---

## Service Worker 生命周期

Manifest V3 用 Service Worker 替代了 Background Page，这是扩展系统最大的架构变化。

### 三信号就绪判定

Service Worker 的激活需要三个信号同时就绪：

1. **BrowserState::kActive** — 浏览器进程确认 SW 注册成功
2. **RendererState::kActive** — 渲染进程确认 SW 脚本执行完成
3. **Worker ID** — 确认 SW 版本标识

### 指数退避机制

SW 崩溃时的重试策略：
- 第 1 次：250ms 后重试
- 第 2 次：500ms 后重试
- 第 3 次：1000ms 后重试
- 最多重试 3 次

### SequencedContextId

每次激活新 SW 时生成唯一的 `SequencedContextId`，用于防止旧回调泄漏到新的 SW 实例。

---

## 消息系统

扩展系统支持双格式消息传递：

- **JSON 格式**：简单的键值对消息
- **blink::CloneableMessage**：支持复杂类型（ArrayBuffer、Blob 等）

消息路由通过 `MessageService` 管理，支持：
- 扩展内部通信（runtime.sendMessage）
- Content Script ↔ Background 通信
- 跨扩展通信（需要权限）

---

## 权限系统

扩展权限采用三层存储模型：

```
┌──────────────────────┐
│  Granted Permissions │  ← 用户明确授予的权限
├──────────────────────┤
│  Active Permissions  │  ← 当前生效的权限（Granted + API 默认）
├──────────────────────┤
│  Runtime Granted     │  ← 运行时动态授予的权限
└──────────────────────┘
```

### 权限检查流程

1. API 调用到达 `ExtensionFunctionDispatcher`
2. 检查 `manifest.json` 中声明的权限
3. 检查 `ActivePermissions` 是否包含所需权限
4. 如果是敏感操作，弹出权限请求对话框
5. 权限通过后执行 API 实现

---

## 事件系统（EventRouter）

事件路由是扩展系统的核心基础设施：

- **AssociatedReceiverSet**：管理 Mojo 事件接收器
- **Lazy Events**：延迟注册事件监听器，减少资源消耗
- **Filter Events**：支持 URL、tabId 等过滤条件
- **SW 事件**：Service Worker 事件需要特殊处理（SW 可能未激活）

---

## 声明式网络请求（DNR）

DNR 是 MV3 中替代 `webRequest` API 的新机制，采用三层架构：

```
┌──────────────────────┐
│    RulesetManager    │  ← 管理所有规则集
├──────────────────────┤
│   CompositeMatcher   │  ← 组合多个匹配器
├──────────────────────┤
│   RulesetMatcher     │  ← 单个规则集的匹配逻辑
└──────────────────────┘
```

---

## 内容脚本注入

Content Script 运行在网页的隔离世界中：

- **WorldEnum::kMain**：主世界（与网页共享 JS 环境）
- **WorldEnum::kIsolated**：隔离世界（默认，独立的 JS 环境）

注入流程：
1. `UserScriptScheduler` 调度注入时机
2. `ScriptInjector` 准备注入上下文
3. 通过 Mojo 在渲染进程中执行注入
4. `ScriptContext` 管理注入后的上下文生命周期

---

## Native Bindings 系统

`NativeExtensionBindingsSystem` 是连接 JS API 调用和 C++ 实现的桥梁：

- **懒加载**：API 绑定在首次访问时才创建
- **FeatureCache**：缓存 API 特性检查结果，避免重复计算
- **SafeBuiltins**：保护内置函数不被扩展覆盖

---

## 关键设计模式

1. **PassKey 模式**：限制类的构造函数只能由特定工厂方法调用
2. **WeakPtr 防泄漏**：大量使用 `base::WeakPtr` 防止悬空指针
3. **Mojo 接口隔离**：跨进程通信全部通过 Mojo 接口
4. **BrowserContext 关联**：所有服务通过 `BrowserContext` 关联到特定 Profile

---

## 与 Actor 框架的对比

| 维度 | Extensions | Actor (GLIC) |
|------|-----------|-------------|
| 运行环境 | 渲染进程（沙盒） | 浏览器进程（完全权限） |
| API 能力 | 受限的 Chrome API | 完整的浏览器 API + DevTools |
| 安全模型 | 权限声明 + 运行时检查 | 多层权限 + Origin Gating |
| 生命周期 | SW 唤醒/休眠 | 任务状态机 |
| 跨进程通信 | Mojo IPC | Mojo IPC |

---

*基于 Chromium 源码 extensions/ 目录分析 · 2026-05-13*
