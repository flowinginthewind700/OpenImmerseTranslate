# Open Immerse Translate v1.6.16

## Universal immersive layout fixes

This release fixes translation visibility at the shared translation-kernel
layer. It does not add another set of site-specific X DOM rules.

- Releases fixed height, max-height, line-clamp, and clipping constraints along
  compact navigation labels, including deeply nested wrappers.
- Keeps page cards and article boundaries protected, so a linked story card is
  not mistaken for a compact control.
- Renders translated navigation labels as normal text flow while preserving the
  original label's layout and restoring every changed inline style exactly.
- Expands SPA navigation inference to deeper application shells while excluding
  `main`, `article`, and timeline content containers.
- Retranslates the replacement label when React replaces the entire original
  text node, without duplicating translations or removing links and listeners.
- Keeps the existing live X scroll and mutation-observer checks, so late-loaded
  posts must still be discovered and translated after the initial viewport.

## 中文更新说明

本次更新在共享翻译内核层修复译文不可见问题，没有继续增加 X 专用 DOM 规则：

- 解除紧凑导航标签上的固定高度、最大高度、行数截断和裁切约束，并支持多层
  嵌套的文字分支。
- 保护页面卡片与文章边界，不会把整张链接卡片误判成紧凑控件。
- 译文使用正常换行布局，同时保留原标签布局；翻译结束时精确恢复所有内联样式。
- 将 SPA 导航结构推断扩展到更深的页面外壳，同时排除 `main`、`article`
  和内容时间线容器。
- 当 React 整体替换原标签节点时，自动翻译新节点，不重复插入译文，也不破坏
  原链接和事件监听器。
- 保留公开 X 页面滚动加载和 MutationObserver 检查，首屏后出现的新推文仍必须
  被实际发现并翻译。

## Verification

- Browser kernel tests passed: translation layout `24/24`, adaptive UI policy
  `12/12`, content integration `42/42`, and synthetic X coverage `36/36`.
- Extension loading, content-script injection, service-worker startup, and popup
  initialization passed.
- Public guest X end-to-end test passed with all three initially rendered post
  bodies visibly translated, navigation labels rendered, lazy scrolling
  exercised, a dynamically inserted post translated, and the pipeline returning
  to idle.
- A real authenticated Chrome session remains a separate manual acceptance
  target. This release does not claim that logged-in X has already been manually
  verified.

## 验证范围

- 浏览器内核测试全部通过：翻译布局 `24/24`、自适应 UI 策略 `12/12`、
  内容集成 `42/42`、合成 X 页面 `36/36`。
- 扩展加载、content script 注入、service worker 启动及 popup 初始化测试通过。
- X 公开访客页端到端测试通过：首屏 3 条推文正文均显示译文，导航标签完成翻译，
  滚动懒加载被实际触发，动态插入的推文完成翻译，且翻译队列最终回到空闲状态。
- 真实登录态 Chrome 仍需单独人工验收，本次发布不声称已完成登录态 X 的人工实测。

## Install

1. Download `OpenImmerseTranslate-v1.6.16.zip`.
2. Extract it to a local folder.
3. Open `chrome://extensions/` and enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder.
5. Reload already-open pages after updating the extension.

下载 `OpenImmerseTranslate-v1.6.16.zip`，解压后在 `chrome://extensions/`
开启开发者模式并加载已解压的扩展。更新后请刷新已经打开的网页。
