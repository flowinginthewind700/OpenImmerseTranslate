<div align="center">

# 🌐 Open Immerse Translate

<img src="icons/icon.svg" width="120" height="120" alt="Open Immerse Translate">

**开源沉浸式翻译 Chrome 扩展 | Open-source Immersive Translation Chrome Extension**

支持 Google 翻译（免费）和多种 LLM API 的双语对照翻译工具

Bilingual translation tool with Google Translate (free) and various LLM APIs

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[中文](#-功能特点) • [English](#english) • [安装 Installation](#-安装-installation) • [推荐配置 Recommended](#-推荐配置-recommended-setup)

---

</div>

## ✨ 功能特点 | Features

<table>
<tr>
<td width="50%">

### 🎯 沉浸式翻译 | Immersive Translation
- 译文内嵌于原文下方，保持阅读流畅性
- Translation appears below original text
- 原文与译文双语对照，便于学习
- Bilingual display for easy learning

</td>
<td width="50%">

### 🆓 开箱即用 | Ready to Use
- **默认 Google 翻译，免费无需配置！**
- **Default: Google Translate, FREE!**
- 推荐升级到 DeepSeek 获得更好体验
- Recommend DeepSeek for better quality

</td>
</tr>
<tr>
<td width="50%">

### 🤖 多 LLM 支持 | Multi-LLM Support
- **Google 翻译** (免费/Free) ⭐ 默认
- **DeepSeek** ⭐ 推荐/Recommended
- OpenAI (GPT-4o)
- Anthropic Claude
- Moonshot (Kimi)
- 智谱 GLM
- Ollama (本地/Local)
- 任意 OpenAI 兼容 API

</td>
<td width="50%">

### ⚡ 悬浮快捷按钮 | Floating Button
- 页面右侧悬浮翻译按钮，一键翻译
- One-click translation from floating button
- 支持拖拽自定义位置
- Draggable, auto-snap to edges
- 可在主界面开关
- Toggle on/off in main panel

</td>
</tr>
</table>

## 📦 安装 | Installation

### 方式一：下载 Release（推荐）| Download Release (Recommended)

1. 前往 [Releases](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases) 页面
   
   Go to [Releases](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases)

2. 下载最新版本的 `OpenImmerseTranslate-vX.X.X.zip`
   
   Download latest `OpenImmerseTranslate-vX.X.X.zip`

3. 解压到任意文件夹
   
   Extract to any folder

4. 打开 Chrome，访问 `chrome://extensions/`
   
   Open Chrome, go to `chrome://extensions/`

5. 开启右上角「**开发者模式**」
   
   Enable "**Developer mode**" (top right)

6. 点击「**加载已解压的扩展程序**」，选择解压后的文件夹
   
   Click "**Load unpacked**", select the extracted folder

更新或重新加载扩展后，请刷新已经打开的网页。Chrome 不会把新版本的
content script 自动注入到重载前已存在的标签页；扩展会尝试补注入完整内核，
但刷新页面是最稳定、可复现的升级方式。

After updating or reloading the extension, refresh pages that were already
open. Chrome does not automatically attach the new content script to those
tabs; the extension has a full-bundle reinjection fallback, but a refresh is
the most reliable upgrade path.

### 方式二：从源码安装 | Build from Source

```bash
git clone https://github.com/flowinginthewind700/OpenImmerseTranslate.git
cd OpenImmerseTranslate
npm install
npm run build
```

然后加载 `dist/OpenImmerseTranslate` 文件夹 | Then load `dist/OpenImmerseTranslate` folder

## 🚀 开始使用 | Getting Started

**安装后即可立即使用！默认使用 Google 翻译，无需任何配置。**

**Ready to use after installation! Default Google Translate, no configuration needed.**

1. 点击页面右侧的悬浮按钮 🌐 | Click floating button 🌐 on page side
2. 或点击扩展图标 → 翻译当前页面 | Or click extension icon → Translate Page
3. 享受双语阅读！| Enjoy bilingual reading!

## ⭐ 推荐配置 | Recommended Setup

虽然 Google 翻译免费好用，但我们**强烈推荐升级到 DeepSeek**：

While Google Translate works great, we **highly recommend upgrading to DeepSeek**:

| 对比 / Compare | Google 翻译 | DeepSeek ⭐ |
|----------------|-------------|-------------|
| 价格 / Price | 免费 Free | 超低价 Very Low |
| 质量 / Quality | 好 Good | 优秀 Excellent |
| 速度 / Speed | 快 Fast | 快 Fast |
| 上下文理解 | 一般 | 出色 |
| Context Understanding | Average | Excellent |

### 配置 DeepSeek | Setup DeepSeek

1. 访问 [platform.deepseek.com](https://platform.deepseek.com/) 注册
   
   Visit [platform.deepseek.com](https://platform.deepseek.com/) to register

2. 获取 API Key
   
   Get your API Key

3. 在插件设置中：
   - 服务提供商选择 `DeepSeek`
   - 填入 API Key
   - 模型使用 `deepseek-chat`

   In extension settings:
   - Select `DeepSeek` as provider
   - Enter your API Key
   - Use `deepseek-chat` model

4. 保存，开始享受高质量翻译！
   
   Save and enjoy high-quality translation!

## 📖 使用指南 | User Guide

### 翻译整个页面 | Translate Page

| 方式 / Method | 操作 / Action |
|---------------|---------------|
| 悬浮按钮 / Float Button | 点击页面右侧的 🌐 按钮 / Click 🌐 on page side |
| 弹出窗口 / Popup | 点击扩展图标 → 翻译当前页面 / Click icon → Translate |
| 右键菜单 / Context Menu | 页面右键 → 翻译整个页面 / Right click → Translate |

### 翻译选中文本 | Translate Selection

1. 选中网页上的文本 | Select text on page
2. 点击出现的 🌐 翻译按钮 | Click the 🌐 button
3. 查看翻译结果，支持复制 | View result, copy supported

### 翻译字幕文件 | Translate Subtitle Files

当前字幕工作台支持 **SRT** 和 **WebVTT**：

1. 点击扩展图标，选择「翻译字幕文件」
2. 导入不超过 10 MB 的 `.srt` 或 `.vtt` 文件，支持 UTF-8 和带 BOM 的 UTF-16
3. 选择源语言、目标语言和已配置的 Provider，开始分批翻译
4. 翻译过程中可停止；部分批次失败时可保留成功结果并继续翻译剩余片段
5. 译文可直接编辑，也可清空后重新翻译
6. 导出保留原时间轴的双语 SRT 或 WebVTT，可选择是否包含原文

字幕文件只在浏览器本地读取；除向所选 Provider 发送待翻译文本外，不会上传到本项目的其他服务。
当前版本尚未实现 EPUB 或 PDF 翻译，相关格式会在具备独立解析、导出和回归测试后再发布。

The subtitle workspace supports **SRT** and **WebVTT** files up to 10 MB, including
UTF-8 and BOM-prefixed UTF-16 input. Translations run in bounded batches, failed
batches can be resumed without discarding successful ones, and editable results
can be exported as bilingual SRT or WebVTT. EPUB and PDF are not supported yet.

### 悬浮按钮 | Floating Button

- **拖拽移动** | **Drag**: 按住按钮拖动 / Hold and drag
- **自动吸附** | **Auto-snap**: 松开后吸附到边缘 / Snaps to edge
- **开关控制** | **Toggle**: 在主界面开关 / Toggle in main panel

## 🔧 支持的服务 | Supported Services

| 服务 / Service | 需要 API Key | 推荐 |
|----------------|--------------|------|
| **Google 翻译** | ❌ 不需要 | 默认 |
| **DeepSeek** | ✅ 需要 | ⭐ 推荐 |
| **OpenAI** | ✅ 需要 | |
| **Claude** | ✅ 需要 | |
| **Moonshot** | ✅ 需要 | |
| **智谱 GLM** | ✅ 需要 | |
| **Ollama** | ❌ 本地 | |

## 🌍 支持的语言 | Supported Languages

<table>
<tr>
<td>🇨🇳 简体中文</td>
<td>🇹🇼 繁體中文</td>
<td>🇺🇸 English</td>
<td>🇯🇵 日本語</td>
<td>🇰🇷 한국어</td>
</tr>
<tr>
<td>🇫🇷 Français</td>
<td>🇩🇪 Deutsch</td>
<td>🇪🇸 Español</td>
<td>🇷🇺 Русский</td>
<td>🇸🇦 العربية</td>
</tr>
<tr>
<td>🇵🇹 Português</td>
<td>🇮🇹 Italiano</td>
<td>🇻🇳 Tiếng Việt</td>
<td>🇹🇭 ไทย</td>
<td>...</td>
</tr>
</table>

## 🌐 网站兼容策略 | Site Compatibility

扩展安装到 `<all_urls>`，通用扫描内核负责识别文章、导航、表格、表单标签、
开放 Shadow DOM 和动态插入内容；X/Twitter 等结构复杂的站点通过独立适配器
覆盖稳定语义节点。新增站点差异应进入适配器和回归测试，而不是继续扩大通用
选择器。

“全球网站”不是“所有网站无条件可用”的产品承诺。Canvas、封闭 Shadow DOM、
跨域 iframe、强反爬页面和私有编辑器仍可能需要单独适配。当前自动化覆盖普通
页面 fixture、X/Twitter fixture、构建后扩展加载、匿名公开 X 页面，以及真实
Google Translate provider 链路。

The extension runs on `<all_urls>` and uses a general semantic/layout scanner,
with tested site adapters for structurally complex sites such as X/Twitter.
Canvas-only content, closed shadow roots, cross-origin iframes, anti-bot pages,
and proprietary editors may still require dedicated adapters.

## 🛠 开发 | Development

```bash
# 安装依赖 / Install dependencies
npm install

# 构建 / Build
npm run build

# 全部测试 / All tests
npm test

# 仅浏览器内核测试 / Browser kernel tests only
npm run test:browser

# 仅 Chrome 扩展加载测试 / Extension load test only
npm run test:extension

# 真实 X 页面翻译 E2E（需要网络）/ Live X page translation E2E (network required)
npm run test:e2e:x

# 真实 X 页面 + Google 翻译闭环（需要网络）/ Live X + Google E2E
npm run test:e2e:x:google

# 内核改动采用 TDD：先补失败用例，再实现并跑完整验证
# Kernel changes follow TDD: add a failing test first, then run the full suite

# 生成图标 / Generate icons
npm run icons
```

### 项目结构 | Project Structure

```
OpenImmerseTranslate/
├── manifest.json           # Chrome 扩展配置
├── popup/                  # 弹出窗口 UI
├── subtitle/               # SRT/WebVTT 导入、编辑与双语导出工作台
├── content/                # 页面编排、扫描调度与翻译生命周期
├── background/             # 请求队列、限流、重试与 Provider 传输
├── shared/                 # 可独立测试的内容识别、提示词、模型和 DOM 内核
├── tests/                  # TDD 浏览器测试与扩展加载测试
├── docs/                   # 架构决策与第三方参考审计
├── styles/                 # 样式文件
└── icons/                  # 图标资源
```

参考项目来源、许可证边界和内核重写记录见
[Reference Project Evaluation](docs/reference-evaluation.md)。

## 🤝 贡献 | Contributing

欢迎提交 Issue 和 Pull Request！

Issues and PRs are welcome!

## 📄 License

[MIT License](LICENSE)

## 📬 联系 | Contact

<p align="center">
  <a href="https://x.com/McQueenFu">
    <img src="https://img.shields.io/badge/Twitter-@McQueenFu-1DA1F2?style=for-the-badge&logo=twitter&logoColor=white" alt="Twitter">
  </a>
  &nbsp;&nbsp;
  <a href="https://www.linkedin.com/in/mcqueenfu/">
    <img src="https://img.shields.io/badge/LinkedIn-McQueenFu-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn">
  </a>
</p>

---

<div align="center">

**如果这个项目对你有帮助，欢迎 ⭐ Star 支持！**

**Star ⭐ if you find this helpful!**

Made with ❤️ by [@McQueenFu](https://x.com/McQueenFu)

</div>

---

<a name="english"></a>

## English

Open Immerse Translate is an open-source Chrome extension for immersive bilingual translation. 

### Key Features

- 🆓 **Free by Default** - Uses Google Translate, no setup needed
- ⭐ **DeepSeek Recommended** - Upgrade for better quality at low cost
- 🌐 **Immersive Translation** - Inline bilingual display
- ⚡ **Floating Button** - One-click translation
- 🤖 **Multi-LLM** - OpenAI, Claude, DeepSeek, Kimi, and more
- 🎞️ **Subtitle Workbench** - Translate and export SRT/WebVTT with preserved timing

### Quick Start

1. Install from [Releases](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases)
2. Click the floating button or extension icon
3. Start translating! (Google Translate works out of the box)
4. Optional: Configure DeepSeek for better quality
5. Open the extension menu to import an SRT/WebVTT subtitle file

### Contact

- Twitter: [@McQueenFu](https://x.com/McQueenFu)
- LinkedIn: [McQueenFu](https://www.linkedin.com/in/mcqueenfu/)
