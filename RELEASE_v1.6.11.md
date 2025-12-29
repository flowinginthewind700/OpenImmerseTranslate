# ✨ Open Immerse Translate v1.6.11

## 🐛 Bug Fixes / 错误修复

### 🔧 修复停止翻译后队列未清理的问题 / Fix Stale Translation Queue After Stop

* **中文**: 修复了停止翻译后，翻译队列没有被清理的问题。现在点击"停止翻译"时，队列会立即清空，重新开始翻译时会优先处理视口内的新内容，不会继续处理旧的队列任务。
* **EN**: Fixed the issue where the translation queue was not cleared after stopping translation. Now when you click "Stop Translation", the queue is immediately cleared, and when you restart translation, it will prioritize new content in the viewport instead of continuing to process old queue tasks.

**改进内容 / Improvements**:
- ✅ 停止翻译时立即清空队列 / Clear queue immediately when stopping translation
- ✅ 重新开始翻译时优先处理视口内容 / Prioritize viewport content when restarting translation
- ✅ 正在执行的翻译任务会及时响应停止信号 / Active translation tasks respond to stop signal promptly

---

## 📦 Installation / 安装方式

### Download ZIP (Recommended) / 下载 ZIP（推荐）

1. Download `OpenImmerseTranslate-v1.6.11.zip` below / 下载下方 ZIP
2. Extract to any folder / 解压到任意文件夹
3. Open Chrome, go to `chrome://extensions/` / 打开 Chrome，访问 chrome://extensions/
4. Enable "Developer mode" / 开启「开发者模式」
5. Click "Load unpacked" / 点击「加载已解压的扩展程序」
6. Select the extracted folder / 选择解压后的文件夹

### Build from Source / 从源码构建

```bash
git clone https://github.com/flowinginthewind700/OpenImmerseTranslate.git
cd OpenImmerseTranslate
npm install
npm run build
```

---

## 🚀 How to Use / 使用方法

### 基本使用 / Basic Usage

1. **配置 API（如需要）** / **Configure API (if needed)**
   - 点击扩展图标，进入设置页面 / Click extension icon, go to Settings
   - 选择 AI 服务提供商（推荐 DeepSeek） / Select AI service provider (DeepSeek recommended)
   - 填入 API Key（Google 翻译无需配置） / Enter API Key (Google Translate requires no configuration)

2. **开始翻译** / **Start Translation**
   - 打开需要翻译的网页 / Open the webpage you want to translate
   - 点击扩展图标，点击「翻译当前页面」/ Click extension icon, click "Translate Current Page"
   - 插件会优先翻译视口内可见的内容 / Extension will prioritize translating visible content in viewport

3. **停止翻译** / **Stop Translation**
   - 点击「停止翻译」按钮 / Click "Stop Translation" button
   - 翻译队列会立即清空 / Translation queue will be cleared immediately
   - 再次开始翻译时，会优先处理视口内的新内容 / When restarting, new viewport content will be prioritized

4. **恢复原样** / **Restore Original**
   - 点击「恢复原样」按钮可移除所有翻译 / Click "Restore" button to remove all translations

---

## ⭐ Recommended: DeepSeek / 推荐 DeepSeek

While Google Translate (default) is free and works immediately, we recommend DeepSeek for better quality:

虽然 Google 翻译（默认）免费且开箱即用，但我们推荐 DeepSeek 获得更好的翻译质量：

| Google Translate | DeepSeek ⭐ |                |
| ---------------- | ---------- | -------------- |
| Price / 价格       | Free / 免费  | Very Low / 超低价 |
| Quality / 质量     | Good / 好   | Excellent / 优秀 |
| Setup / 配置       | None / 无需  | API Key        |

---

## 🔗 Links / 链接

* 🐙 [GitHub 项目主页 / Project Home](https://github.com/flowinginthewind700/OpenImmerseTranslate)
* 📦 [Releases 版本页面 / Release Page](https://github.com/flowinginthewind700/OpenImmerseTranslate/releases)
* 💬 [Issues 反馈问题 / Issue Tracker](https://github.com/flowinginthewind700/OpenImmerseTranslate/issues)
* 🌐 [官网 / Official Website](https://translate.mgx.world)

---

**Enjoy bilingual reading! 享受双语阅读！ 🌍📖**


