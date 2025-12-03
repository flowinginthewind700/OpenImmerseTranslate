<div align="center">

# 🌐 Open Immerse Translate

<img src="icons/icon.svg" width="120" height="120" alt="Open Immerse Translate">

**开源沉浸式翻译 Chrome 扩展**

支持自定义 LLM API 的双语对照翻译工具

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://developer.chrome.com/docs/extensions/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](#english) • [功能特点](#-功能特点) • [快速开始](#-快速开始) • [使用指南](#-使用指南) • [开发](#-开发)

---

<img src="docs/demo.gif" width="600" alt="Demo">

</div>

## ✨ 功能特点

<table>
<tr>
<td width="50%">

### 🎯 沉浸式翻译
- 译文内嵌于原文下方，保持阅读流畅性
- 原文与译文双语对照，便于学习
- 自动检测源语言，智能翻译

</td>
<td width="50%">

### ⚡ 悬浮快捷按钮
- 页面右侧悬浮翻译按钮，一键翻译
- 支持拖拽自定义位置
- 自动吸附边缘，位置持久保存

</td>
</tr>
<tr>
<td width="50%">

### 🤖 多 LLM 支持
- OpenAI (GPT-4o, GPT-4o-mini)
- Anthropic Claude
- DeepSeek
- Moonshot (Kimi)
- 智谱 GLM
- 任意 OpenAI 兼容 API

</td>
<td width="50%">

### 🚀 智能性能优化
- 视口优先翻译算法
- 渐进式加载，滚动触发
- 批量请求 + 限流控制
- 指数退避重试机制

</td>
</tr>
</table>

## 📦 快速开始

### 安装

#### 方式一：从源码安装（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/flowinginthewind700/OpenImmerseTranslate.git
cd OpenImmerseTranslate

# 2. 构建（可选）
npm install
npm run build
```

然后在 Chrome 中加载：

1. 打开 `chrome://extensions/`
2. 开启右上角「**开发者模式**」
3. 点击「**加载已解压的扩展程序**」
4. 选择项目根目录或 `dist/OpenImmerseTranslate` 文件夹

#### 方式二：下载 Release

1. 前往 [Releases](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases) 页面
2. 下载最新版本的 `OpenImmerseTranslate-vX.X.X.zip`
3. 解压后按上述步骤加载

### 配置 API

首次使用需配置 LLM 服务：

1. 点击浏览器工具栏的扩展图标
2. 点击右上角 **设置** ⚙️
3. 选择服务提供商
4. 填入 API 地址和密钥
5. 点击「测试连接」验证
6. 保存设置

## 📖 使用指南

### 翻译整个页面

| 方式 | 操作 |
|------|------|
| 悬浮按钮 | 点击页面右侧的悬浮翻译按钮 |
| 弹出窗口 | 点击扩展图标 → 翻译当前页面 |
| 右键菜单 | 页面空白处右键 → 翻译整个页面 |

### 翻译选中文本

1. 选中网页上的文本
2. 点击出现的 🌐 翻译按钮
3. 查看翻译结果，支持复制

### 悬浮按钮

- **拖拽移动**：按住按钮拖动到任意位置
- **自动吸附**：松开后自动吸附到左/右边缘
- **隐藏按钮**：悬停时点击 × 关闭
- **位置记忆**：刷新页面后恢复上次位置

## 🔧 支持的 LLM 服务

| 服务商 | API 地址 | 推荐模型 |
|--------|----------|----------|
| **OpenAI** | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| **Anthropic** | `https://api.anthropic.com/v1/messages` | `claude-3-haiku-20240307` |
| **DeepSeek** | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| **Moonshot** | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| **智谱 GLM** | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash` |
| **Ollama** | `http://localhost:11434/v1/chat/completions` | `llama3.2` |
| **自定义** | 任意 OpenAI 兼容 API | - |

### 自定义 API

支持任何兼容 OpenAI Chat Completions API 格式的服务：

```
POST /v1/chat/completions
Authorization: Bearer <API_KEY>

{
  "model": "your-model",
  "messages": [{"role": "user", "content": "..."}]
}
```

## 🌍 支持的语言

<table>
<tr>
<td>🇨🇳 简体中文</td>
<td>🇹🇼 繁體中文</td>
<td>🇺🇸 English</td>
<td>🇯🇵 日本語</td>
</tr>
<tr>
<td>🇰🇷 한국어</td>
<td>🇫🇷 Français</td>
<td>🇩🇪 Deutsch</td>
<td>🇪🇸 Español</td>
</tr>
<tr>
<td>🇷🇺 Русский</td>
<td>🇸🇦 العربية</td>
<td>🇵🇹 Português</td>
<td>🇮🇹 Italiano</td>
</tr>
</table>

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
├── icons/                  # 图标资源
├── scripts/
│   ├── build.js           # 构建脚本
│   └── create-icons.js    # 图标生成
└── dist/                   # 构建输出
```

### 本地开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 生成图标
npm run icons
```

### 技术栈

- **Chrome Extension Manifest V3**
- **Intersection Observer API** - 视口检测
- **Chrome Storage API** - 配置持久化
- **Fetch API** - LLM 请求

### 核心算法

#### 视口优先翻译

```
┌─────────────────────────────────┐
│                                 │
│  ┌───────────────────────────┐  │
│  │      已翻译内容            │  │  ← 已翻译
│  └───────────────────────────┘  │
│                                 │
│  ╔═══════════════════════════╗  │
│  ║      当前视口             ║  │  ← 优先翻译
│  ║                           ║  │
│  ╚═══════════════════════════╝  │
│                                 │
│  ┌───────────────────────────┐  │
│  │      预加载区域            │  │  ← 预加载 1 屏
│  └───────────────────────────┘  │
│                                 │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│       待翻译（滚动触发）         │  ← 延迟加载
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                                 │
└─────────────────────────────────┘
```

#### 限流策略

- 最大并发请求：2
- 请求间隔：1.5s
- 指数退避重试：3 次（2s → 4s → 8s）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

### 贡献指南

- 遵循现有代码风格
- 添加必要的注释
- 更新相关文档
- 确保功能正常工作

## 📄 License

本项目采用 [MIT License](LICENSE) 开源协议。

## 🙏 致谢

- 本项目受 [沉浸式翻译](https://immersivetranslate.com/) 启发
- 感谢所有贡献者的支持

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

如有问题或建议，欢迎通过以下方式联系：

- 🐦 **Twitter**: [@McQueenFu](https://x.com/McQueenFu)
- 💼 **LinkedIn**: [McQueenFu](https://www.linkedin.com/in/mcqueenfu/)
- 📝 **GitHub Issues**: [提交 Issue](https://github.com/flowinginthewind700/OpenImmerseTranslate/issues)

---

<div align="center">

**如果这个项目对你有帮助，欢迎 ⭐ Star 支持！**

Made with ❤️ by [@McQueenFu](https://x.com/McQueenFu)

</div>

---

<a name="english"></a>

## English

### Overview

Open Immerse Translate is an open-source Chrome extension for immersive bilingual translation. It displays translations below the original text, supporting various LLM APIs including OpenAI, Claude, DeepSeek, and any OpenAI-compatible APIs.

### Features

- 🌐 **Immersive Translation** - Inline bilingual display
- ⚡ **Floating Action Button** - One-click translation from any page
- 🤖 **Multi-LLM Support** - OpenAI, Claude, DeepSeek, Kimi, and more
- 🚀 **Smart Performance** - Viewport-first translation with progressive loading
- 🌍 **Multi-language** - UI supports Chinese and English

### Quick Start

1. Clone the repository
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the project folder
5. Configure your LLM API in settings

### Contact

- 🐦 Twitter: [@McQueenFu](https://x.com/McQueenFu)
- 💼 LinkedIn: [McQueenFu](https://www.linkedin.com/in/mcqueenfu/)

### License

MIT License
