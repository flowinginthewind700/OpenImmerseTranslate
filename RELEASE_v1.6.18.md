# Open Immerse Translate v1.6.18

## Shared SPA root safety fix

This patch closes an adaptive-root overlap found after v1.6.17. It changes the
shared content kernel rather than adding another X-only translation pipeline or
MutationObserver.

- Rejects a page-wide application shell when it visibly contains `main`,
  `[role="main"]`, `article`, or `[role="article"]`.
- Keeps bounded top bars and side rails eligible after rejecting their parent
  application shell.
- Prevents profile names, verification text, dates, and engagement actions from
  being misclassified as navigation labels.
- Preserves tweet text as `post-body`.
- Applies the same admission rule to initial scans, dynamically inserted
  navigation, virtualized timeline posts, scrolling content, and SPA route
  changes.
- Adds shared-policy and synthetic X regressions for the root-overlap case.

## 中文更新说明

本次补丁修复 v1.6.17 之后发现的自适应根节点范围重叠问题。修改位于所有网站
共用的内容识别内核，没有新增第二套 X 专用翻译管线或 MutationObserver。

- 当整页应用壳可见地包含 `main`、`[role="main"]`、`article` 或
  `[role="article"]` 时，不再把整个应用壳识别为导航根。
- 拒绝应用壳后，仍保留有明确边界的顶部栏和侧栏作为导航根。
- 防止资料名称、认证说明、日期和互动操作被误识别为导航标签。
- 确保推文正文继续使用 `post-body` 语义。
- 首次扫描、动态插入的导航、虚拟化时间线、滚动加载内容和 SPA 换页共用同一
  套准入规则。
- 增加共享策略测试和 X 合成页面回归测试，覆盖应用壳与正文区域重叠的场景。

## Verification

- All browser kernel tests passed.
- Shared adaptive UI policy: `15/15`.
- Synthetic X content: `38/38`.
- Content integration: `43/43`.
- `npm test` passed, including extension build, MV3 loading, content-script
  injection, service-worker startup, popup initialization, and generic/X-like
  translation contracts.
- Live public guest X test passed: 24 scanned units, 23 visible units, 14
  navigation units, 25 provider targets, 3/3 visible post bodies translated,
  20/20 navigation labels translated, maximum queue size 18, and an idle
  pipeline after completion.
- Authenticated X navigation was not manually inspected in a logged-in Chrome
  session. Logged-in and landmark-free X layouts remain covered by synthetic
  fixtures.

## 验证范围

- 全部浏览器内核测试通过。
- 共享自适应 UI 策略测试 `15/15`。
- X 合成页面测试 `38/38`。
- 内容集成测试 `43/43`。
- `npm test` 全部通过，包括扩展构建、MV3 加载、content script 注入、
  service worker 启动、popup 初始化，以及普通页面和 X-like 页面翻译契约。
- X 公开访客页端到端测试通过：扫描 24 个单元、23 个可见单元、14 个导航单元，
  25 个 provider 目标；首屏 3/3 条推文正文翻译成功，20/20 个导航标签翻译成功；
  最大队列长度 18，完成后翻译管线空闲。
- 未对真实登录态 Chrome 账号进行人工导航验收；登录态和无 landmark 的 X 布局
  仍由合成回归夹具覆盖。

## Install

1. Download `OpenImmerseTranslate-v1.6.18.zip`.
2. Extract it to a local folder.
3. Open `chrome://extensions/` and enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder.
5. Reload already-open pages after updating the extension.

下载 `OpenImmerseTranslate-v1.6.18.zip`，解压后在 `chrome://extensions/`
开启开发者模式并加载已解压的扩展。更新后请刷新已经打开的网页。
