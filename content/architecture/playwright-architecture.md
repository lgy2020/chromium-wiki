# Playwright 架构思想分析

> 一套 API 通吃三大浏览器引擎，协议层抽象如何重新定义浏览器自动化

---

## 核心设计哲学

Playwright 不是"另一个 Selenium"。它的架构哲学是：**不要让用户去适应浏览器的复杂性，而是通过协议层抽象把复杂性吞掉，对外暴露一个确定性的、自动等待的、天然隔离的接口。**

它不是在做浏览器自动化，它是在做浏览器行为的"确定性封装"。

---

## 1. 协议层抽象 — 一套 API，三套引擎

这是 Playwright 最根本的架构选择。它不是用 CDP 一个协议通吃所有浏览器，而是为每个浏览器引擎实现了独立的协议通道：

| 浏览器 | 协议 |
|---|---|
| Chromium | Chrome DevTools Protocol (CDP) |
| Firefox | 自研 Juggler 协议（绕过 Firefox 原生 Remote Protocol） |
| WebKit | 自研 WebKit 协议（直接 patch 了 WebKit 源码） |

**思想**：真正的跨浏览器不是"大家都说同一种语言"，而是"我在每个翻译都做好一层适配"。这让 Playwright 不受 CDP 能力边界的限制 — Firefox 和 WebKit 的能力可以独立扩展。

### 协议通信流程

```
用户代码
  ↓
Playwright API 层（统一接口）
  ↓
协议适配层（Protocol Dispatcher）
  ↓
├── ChromiumChannel → CDP over WebSocket
├── FirefoxChannel  → Juggler over Pipe
└── WebKitChannel   → WebKit Protocol over Pipe
  ↓
浏览器进程
```

每个浏览器通道实现了相同的 `BrowserContext` / `Page` / `Frame` 语义，但底层通信机制完全不同。

---

## 2. BrowserContext — 轻量隔离的核心单元

这是 Playwright 和 Selenium 最大的架构差异：

- **Selenium**：每个测试 → 一个 WebDriver 进程 → 重量级
- **Playwright**：一个 Browser 进程 → 多个 BrowserContext → 极轻量

BrowserContext 是一个独立的"隐身窗口"，拥有独立的：

- Cookie / LocalStorage
- 权限 / 地理位置
- Service Worker 注册
- 网络拦截规则
- 认证状态

```
Browser (Chromium 进程)
  ├── BrowserContext A (用户1的会话)
  │     ├── Page 1
  │     └── Page 2
  ├── BrowserContext B (用户2的会话)
  │     └── Page 1
  └── BrowserContext C (无痕测试)
        └── Page 1
```

**思想**：把"浏览器实例"和"会话状态"解耦。创建一个新 Context 几乎零成本（毫秒级），这让并行测试、多用户模拟变得非常自然。

### 与 Chromium 内部的对应关系

BrowserContext 的设计直接映射了 Chromium 内部的 `content::BrowserContext`（即 Profile）。Playwright 复用了 Chromium 已有的进程隔离架构：

| Playwright 概念 | Chromium 内部对应 |
|---|---|
| Browser | `BrowserProcess` 管理的浏览器实例 |
| BrowserContext | `content::BrowserContext`（Profile） |
| Page | `content::WebContents` |
| Frame | `content::RenderFrameHost` |
| CDP 通道 | `DevToolsSession` / `DevToolsAgent` |

---

## 3. 自动等待 — 把可靠性内建到协议层

传统 Selenium 的痛点：

```python
element.click()  # 可能元素还没渲染出来 → StaleElementReferenceError
# 于是到处写 time.sleep() 或 WebDriverWait
```

Playwright 的做法：**每个 action 内置一套 actionability checks**：

```
click() 内部执行链:
  1. 等待元素 attached to DOM
  2. 等待元素 visible
  3. 等待元素 stable（没有动画）
  4. 等待元素 enabled
  5. 等待元素 receives events（没有被遮挡）
  6. 才执行 click
```

**思想**：把"什么时候能操作"这个判断从用户代码下沉到框架协议层。不是给用户更好的 API 来写等待，而是让用户根本不需要写等待。

### 重试机制

不仅是等待，Playwright 还内置了断言重试：

```python
expect(page).to_have_title("Login")  # 自动重试直到超时
```

断言不是一次性检查，而是在超时窗口内持续轮询。这让测试对异步渲染天然友好。

---

## 4. 网络拦截 — 进程内的 Mock 能力

Playwright 的 `route()` API 可以在协议层拦截请求：

```python
page.route("**/api/data", lambda route: route.fulfill(body="mock"))
```

这不需要代理服务器，不需要 Chrome Extension，直接在浏览器协议层实现。

**思想**：测试不应该依赖外部服务。Mock 不是 hack，是基础设施。

### 实现原理

网络拦截发生在 `network::URLLoaderFactory` 链上。Playwright 通过 CDP 的 `Fetch.enable` 或 Firefox/WebKit 的等效机制，在请求发出前注入拦截逻辑：

```
页面发起请求
  ↓
URLLoaderFactory 拦截链
  ├── Playwright route handler（用户自定义）
  │     ├── route.fulfill() → 直接返回 mock 数据
  │     ├── route.continue() → 放行到真实服务器
  │     └── route.abort() → 阻断请求
  └── 真实网络层
```

---

## 5. 端到端测试框架 — 不只是自动化库

Playwright 的野心不只是"浏览器操控库"。它从一开始就设计成完整的测试框架：

| 能力 | 说明 |
|---|---|
| Test Runner | `@playwright/test`：内置并行、重试、fixture、worker 隔离 |
| Codegen | 录制操作生成代码 |
| Trace Viewer | 时间旅行调试：每步操作都有截图 + 网络快照 + DOM 快照 |
| UI Mode | 交互式调试界面 |
| API Testing | 内置 API 请求能力，不需要额外的 HTTP 客户端 |

**思想**：自动化只是手段，测试才是目的。把工具链从"浏览器操控库"升级为"端到端测试操作系统"。

---

## 6. 与 Selenium/CDP 的架构对比

| 维度 | Selenium | Playwright | CDP 直连 |
|---|---|---|---|
| 协议 | WebDriver (W3C) | CDP + Juggler + WK | 仅 CDP |
| 隔离模型 | 进程级（每 test 一个 driver） | Context 级（共享进程） | 无隔离 |
| 等待策略 | 用户手写 WebDriverWait | 内置 auto-wait | 用户手写 |
| 浏览器支持 | 广（包括 IE） | 三大现代引擎 | 仅 Chromium |
| 测试框架 | 需搭配 TestNG/Jest | 内置 | 无 |
| 启动速度 | 慢（新进程） | 快（新 Context） | 快 |

---

## 7. 设计启示

从 Chromium 源码阅读的角度看，Playwright 的几个设计值得思考：

1. **协议层是最有价值的抽象层** — 浏览器内部的 IPC（Mojo）和外部的 CDP 之间，存在一个"用户友好"的协议层机会
2. **隔离模型可以复用浏览器原生架构** — BrowserContext 不是 Playwright 发明的，它复用了 Chromium 的 Profile 概念
3. **确定性比灵活性更重要** — 自动等待牺牲了一部分"精确控制"，换来了大量测试的稳定性
4. **工具链 > 工具** — Trace Viewer、Codegen 这些"周边工具"往往比核心 API 更能决定用户粘性

---

*来源：Playwright 官方文档 · Chromium 源码 · 架构分析*
