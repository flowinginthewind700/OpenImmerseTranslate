# Open Immerse Translate v1.6.15

## X / Twitter immersive translation

This release strengthens X content discovery without adding another
site-by-site translation algorithm:

- Discovers post bodies in authenticated layouts even when
  `data-testid="tweetText"` is absent, using structured language and direction
  metadata inside post containers.
- Finds the right-column "What is happening" surface from structural evidence,
  including layouts without the usual test identifiers.
- Resolves cards and posts inserted after the initial scan, so late-loaded
  timeline and sidebar content enters the shared scanning pipeline.
- Keeps generic language markup on ordinary websites classified as generic
  content; X post semantics are only applied after X is selected by hostname or
  a strong X-specific signal.

## 中文更新说明

本次更新集中修复 X / Twitter 的沉浸式翻译内容发现：

- 登录态页面即使缺少 `data-testid="tweetText"`，也能从推文容器内的
  `lang` / `dir` 结构识别正文。
- 支持从页面结构识别右侧 “What is happening” 区域，不再只依赖固定测试标识。
- 对首次扫描后才插入的推文和侧栏卡片进行动态发现，使滚动加载内容进入统一翻译管线。
- 收紧 X 页面自动识别规则，普通多语言网站不会因为 `lang="en" dir="auto"`
  被错误套用 X 推文语义。

## Verification

- Browser kernel tests passed, including synthetic authenticated X layouts,
  late mutation discovery, and generic-site isolation.
- Extension load and content-script injection tests passed.
- Public guest X end-to-end scan passed.
- A real logged-in Chrome session is still a separate manual acceptance target;
  this release does not claim that environment has already been verified.

## 验证范围

- 浏览器内核测试全部通过，包括合成登录态 X 布局、延迟插入内容和普通网站隔离。
- 扩展加载及 content script 注入测试通过。
- X 公开访客页面端到端扫描通过。
- 真实登录态 Chrome 仍需单独人工验收，本次发布不将该项标记为已实测。

## Install

1. Download `OpenImmerseTranslate-v1.6.15.zip`.
2. Extract it to a local folder.
3. Open `chrome://extensions/` and enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder.
5. Reload already-open pages after updating the extension.

下载 `OpenImmerseTranslate-v1.6.15.zip`，解压后在 `chrome://extensions/`
开启开发者模式并加载已解压的扩展。更新后请刷新已经打开的网页。
