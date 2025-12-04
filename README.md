<div align="center">

# 🌐 Open Immerse Translate

<img src="icons/icon.svg" width="120" height="120" alt="Open Immerse Translate">

**开源沉浸式翻译 Chrome 扩展 | Open Source Immersive Translation Chrome Extension**

双语对照翻译，开箱即用 | Bilingual Translation, Ready to Use

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[🇨🇳 中文](#-功能特点) • [🇺🇸 English](#-english)

---

</div>

## ✨ 功能特点

<table>
<tr>
<td width="50%">

### 🆓 开箱即用
- **默认免费** - 内置 Google 翻译，无需配置
- **一键翻译** - 点击即可翻译整个页面
- 可升级到 AI 翻译获得更好体验

</td>
<td width="50%">

### 🎯 沉浸式翻译
- 译文内嵌于原文下方
- 双语对照，便于学习
- 保持阅读流畅性

</td>
</tr>
<tr>
<td width="50%">

### 🤖 多 AI 模型支持
- ⭐ **DeepSeek** (推荐，性价比最高)
- OpenAI (GPT-4o)
- Anthropic Claude
- Moonshot (Kimi)
- 智谱 GLM
- Ollama (本地运行)
- 任意 OpenAI 兼容 API

</td>
<td width="50%">

### ⚡ 智能翻译
- 视口优先翻译算法
- 滚动时自动翻译新内容
- 流式翻译，边翻边显示
- 源语言可选（默认自动检测）

</td>
</tr>
</table>

## 📦 快速开始

### 安装

#### 方式一：下载 Release（推荐）

1. 前往 [Releases](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases) 页面
2. 下载最新版本的 `OpenImmerseTranslate-vX.X.X.zip`
3. 解压到任意文件夹
4. 打开 Chrome，访问 `chrome://extensions/`
5. 开启右上角「**开发者模式**」
6. 点击「**加载已解压的扩展程序**」
7. 选择解压后的文件夹

#### 方式二：从源码安装

```bash
git clone https://github.com/flowinginthewind700/OpenImmerseTranslate.git
cd OpenImmerseTranslate
npm install
npm run build
```

然后加载 `dist/OpenImmerseTranslate` 文件夹。

### 开始使用

**无需任何配置，安装后即可使用！**

1. 点击页面右侧的悬浮翻译按钮 🌐
2. 或点击浏览器工具栏的扩展图标 → 「翻译当前页面」
3. 享受双语阅读！

## ⭐ 推荐升级到 DeepSeek

默认的 Google 翻译适合轻度使用。如需更好的翻译质量，推荐使用 **DeepSeek**：

| 优势 | 说明 |
|-----|------|
| 💰 **超高性价比** | API 价格极低，几乎免费 |
| 🚀 **速度快** | 响应迅速，体验流畅 |
| 🎯 **质量优秀** | AI 翻译，更准确自然 |

**配置步骤：**

1. 访问 [DeepSeek 官网](https://platform.deepseek.com/) 注册
2. 获取 API Key
3. 在插件设置中：
   - 服务提供商选择 `DeepSeek`
   - 填入 API Key
   - 保存设置

## 📖 使用指南

### 翻译整个页面

| 方式 | 操作 |
|------|------|
| 悬浮按钮 | 点击页面右侧的悬浮翻译按钮 |
| 弹出窗口 | 点击扩展图标 → 翻译当前页面 |
| 右键菜单 | 页面空白处右键 → 翻译整个页面 |

### 翻译选中文本

1. 选中网页上的文本
2. 点击出现的翻译按钮
3. 查看翻译结果

### 悬浮按钮

- **拖拽移动**：按住按钮拖动到任意位置
- **自动吸附**：松开后自动吸附到左/右边缘
- **显示/隐藏**：在设置 → 界面设置中开关

### 源语言设置

默认自动检测源语言。如需指定，可在设置中选择：

🇺🇸 English • 🇨🇳 简体中文 • 🇹🇼 繁體中文 • 🇯🇵 日本語 • 🇰🇷 한국어 • 🇫🇷 Français • 🇩🇪 Deutsch • 🇪🇸 Español • 🇷🇺 Русский • 🇸🇦 العربية • 🇵🇹 Português • 🇮🇹 Italiano • 🇻🇳 Tiếng Việt • 🇹🇭 ไทย

## 🔧 支持的翻译服务

| 服务商 | 费用 | API Key | 推荐指数 |
|--------|------|---------|----------|
| **Google 翻译** | 免费 | 不需要 | ⭐⭐⭐ |
| **DeepSeek** | 极低 | 需要 | ⭐⭐⭐⭐⭐ |
| **OpenAI** | 中等 | 需要 | ⭐⭐⭐⭐ |
| **Anthropic Claude** | 中等 | 需要 | ⭐⭐⭐⭐ |
| **Moonshot Kimi** | 低 | 需要 | ⭐⭐⭐⭐ |
| **智谱 GLM** | 低 | 需要 | ⭐⭐⭐⭐ |
| **Ollama** | 免费 | 不需要 | ⭐⭐⭐ |

## 🛠 开发

### 项目结构

```
OpenImmerseTranslate/
├── manifest.json           # Chrome 扩展配置
├── popup/                  # 弹出窗口
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   └── i18n.js            # 国际化
├── content/                # 内容脚本
│   └── content.js         # 翻译核心逻辑
├── background/             # 后台服务
│   └── service-worker.js  # API 请求处理
├── styles/
│   └── content.css        # 页面注入样式
└── icons/                  # 图标资源
```

### 本地开发

```bash
npm install      # 安装依赖
npm run build    # 构建
npm run icons    # 生成图标
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

[MIT License](LICENSE)

## 📬 联系作者

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

Made with ❤️ by [@McQueenFu](https://x.com/McQueenFu)

</div>

---

<a name="-english"></a>

# 🇺🇸 English

## Overview

**Open Immerse Translate** is an open-source Chrome extension for immersive bilingual translation. It works out of the box with free Google Translate, and can be upgraded to AI-powered translation for better quality.

## ✨ Features

- 🆓 **Free to Use** - Built-in Google Translate, no configuration needed
- 🎯 **Immersive Translation** - Translations displayed below original text
- 🤖 **Multiple AI Models** - DeepSeek (recommended), OpenAI, Claude, and more
- ⚡ **Smart Performance** - Viewport-first translation with streaming display
- 🌍 **Multi-language** - 14 languages supported

## 📦 Quick Start

### Installation

1. Go to [Releases](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases)
2. Download the latest `OpenImmerseTranslate-vX.X.X.zip`
3. Extract to any folder
4. Open Chrome, go to `chrome://extensions/`
5. Enable "Developer mode"
6. Click "Load unpacked"
7. Select the extracted folder

### Usage

**No configuration needed! Just install and use!**

1. Click the floating translate button 🌐 on the right side of any page
2. Or click the extension icon → "Translate Page"
3. Enjoy bilingual reading!

## ⭐ Recommended: Upgrade to DeepSeek

For better translation quality, we recommend **DeepSeek**:

| Advantage | Description |
|-----------|-------------|
| 💰 **Cost-effective** | Extremely low API price |
| 🚀 **Fast** | Quick response |
| 🎯 **Quality** | Excellent AI translation |

**Setup:**

1. Visit [DeepSeek](https://platform.deepseek.com/) and register
2. Get your API Key
3. In extension settings: Select `DeepSeek`, enter API Key, Save

## 🔧 Supported Services

| Service | Cost | API Key | Rating |
|---------|------|---------|--------|
| **Google Translate** | Free | Not needed | ⭐⭐⭐ |
| **DeepSeek** | Very low | Required | ⭐⭐⭐⭐⭐ |
| **OpenAI** | Medium | Required | ⭐⭐⭐⭐ |
| **Claude** | Medium | Required | ⭐⭐⭐⭐ |
| **Moonshot Kimi** | Low | Required | ⭐⭐⭐⭐ |
| **Ollama** | Free | Not needed | ⭐⭐⭐ |

## 📖 Features

### Source Language

Default: Auto Detect. Supported languages:

🇺🇸 English • 🇨🇳 Chinese • 🇯🇵 Japanese • 🇰🇷 Korean • 🇫🇷 French • 🇩🇪 German • 🇪🇸 Spanish • 🇷🇺 Russian • 🇸🇦 Arabic • 🇵🇹 Portuguese • 🇮🇹 Italian • 🇻🇳 Vietnamese • 🇹🇭 Thai

### Floating Button

- **Drag & Drop** - Move to any position
- **Auto Snap** - Snaps to left/right edge
- **Toggle** - Show/hide in Settings → Interface

## 📬 Contact

- 🐦 Twitter: [@McQueenFu](https://x.com/McQueenFu)
- 💼 LinkedIn: [McQueenFu](https://www.linkedin.com/in/mcqueenfu/)
- 📝 Issues: [GitHub Issues](https://github.com/flowinginthewind700/OpenImmerseTranslate/issues)

## 📄 License

[MIT License](LICENSE)

---

<div align="center">

**If you find this project helpful, please give it a ⭐ Star!**

Made with ❤️ by [@McQueenFu](https://x.com/McQueenFu)

</div>
