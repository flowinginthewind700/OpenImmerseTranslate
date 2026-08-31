

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

## 🛠 开发 | Development

```bash
# 安装依赖 / Install dependencies
npm install

# 构建 / Build
npm run build

# 生成图标 / Generate icons
npm run icons
```

### 项目结构 | Project Structure

```
OpenImmerseTranslate/
├── manifest.json           # Chrome 扩展配置
├── popup/                  # 弹出窗口 UI
├── content/                # 内容脚本（翻译核心）
├── background/             # 后台服务（API 请求）
├── shared/                 # 共享脚本
├── styles/                 # 样式文件
└── icons/                  # 图标资源
```

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

### Quick Start

1. Install from [Releases](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases)
2. Click the floating button or extension icon
3. Start translating! (Google Translate works out of the box)
4. Optional: Configure DeepSeek for better quality

### Contact

- Twitter: [@McQueenFu](https://x.com/McQueenFu)
- LinkedIn: [McQueenFu](https://www.linkedin.com/in/mcqueenfu/)
