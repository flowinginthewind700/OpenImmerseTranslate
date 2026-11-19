# Open Immerse Translate v1.6.17

## Adaptive X and SPA translation fixes

This release strengthens the shared content kernel used by every site and adds
conservative geometry evidence for X's right column. It does not add a second
X-only translation pipeline or another site-specific MutationObserver.

- Translates icon-only toolbar and navigation controls from `aria-label` or
  `title` while preserving their icon, link destination, identity, and event
  listeners.
- Ignores horizontal and vertical overflow containers when deciding whether
  adaptive navigation is visible, including viewport-wide top bars and tall
  scrolling rails.
- Discovers labelled navigation controls without requiring a pre-registered
  semantic root, while continuing to exclude article-local actions.
- Recognizes a right-side X content column from bounded column geometry and
  rich-text evidence when the expected `aside`, landmark, or test identifier is
  absent.
- Scans newly inserted right-column stories and virtualized posts through the
  existing shared MutationObserver and dynamic scanner.
- Watches `aria-label` and `title` changes, invalidates stale translations, and
  keeps generated attribute-label hosts monolingual even when bilingual mode is
  enabled.

## 中文更新说明

本次更新强化所有网站共用的内容识别内核，并为 X 右侧栏增加保守的几何证据；
没有新增第二套 X 专用翻译管线，也没有新增站点专用 MutationObserver。

- 支持从 `aria-label` 或 `title` 翻译仅含图标的顶栏和导航控件，同时保留图标、
  链接地址、DOM 身份和事件监听器。
- 判断导航是否可见时，不再把横向或纵向滚动容器误当作裁切边界，覆盖超宽顶栏
  和高于视口的滚动侧栏。
- 无需页面预先提供语义根节点，也能发现带标签的导航控件，同时继续排除文章内部
  的局部操作按钮。
- 当 X 右栏缺少常见 `aside`、landmark 或测试标识时，可通过受限的右栏几何范围
  和富文本证据识别内容区域。
- 通过现有共享 MutationObserver 和动态扫描器处理滚动后插入的右栏内容和虚拟化
  推文。
- 监听 `aria-label` 和 `title` 变化，失效旧译文，并确保属性标签生成的文本在
  双语模式下仍保持单语展示。

## Verification

- All browser kernel pages passed, including content unitizer `9/9`, adaptive UI
  policy `14/14`, page scanner `23/23`, synthetic X coverage `37/37`, and
  content integration `43/43`.
- Extension build, MV3 loading, content-script injection, service-worker startup,
  popup initialization, and generic/X-like translation contracts passed.
- Public guest X end-to-end verification passed after a transient first-run
  network failure. It observed 41 scanned units, visible translations for all
  three initially rendered post bodies, 44 navigation translation calls,
  dynamic/lazy content handling, and an idle pipeline after completion.
- A real authenticated Chrome account was not manually inspected. Logged-in
  layout behavior is covered by synthetic landmark-free X fixtures. This release
  does not claim universal website support or completed manual verification of
  every authenticated X variant.

## 验证范围

- 全部浏览器内核测试页通过，包括内容单元化 `9/9`、自适应 UI 策略 `14/14`、
  页面扫描 `23/23`、合成 X 页面 `37/37`、内容集成 `43/43`。
- 扩展构建、MV3 加载、content script 注入、service worker 启动、popup
  初始化，以及普通页面和 X-like 页面翻译契约全部通过。
- X 公开访客页端到端验证通过；首次运行遇到一次临时网络连接失败，重跑通过。
  实测观察到 41 个扫描单元、首屏 3 条推文正文全部显示译文、44 次导航翻译调用、
  动态/懒加载内容处理，以及结束时翻译管线回到空闲。
- 未对真实登录态 Chrome 账号进行人工 DOM 检查；登录态布局由无 landmark 的合成
  X 回归夹具覆盖。本次发布不声称支持全世界所有网站，也不声称已完成所有 X
  登录态变体的人工验收。

## Install

1. Download `OpenImmerseTranslate-v1.6.17.zip`.
2. Extract it to a local folder.
3. Open `chrome://extensions/` and enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder.
5. Reload already-open pages after updating the extension.

下载 `OpenImmerseTranslate-v1.6.17.zip`，解压后在 `chrome://extensions/`
开启开发者模式并加载已解压的扩展。更新后请刷新已经打开的网页。
