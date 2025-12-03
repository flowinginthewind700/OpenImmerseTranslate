# 贡献指南 | Contributing Guide

感谢你有兴趣为 Open Immerse Translate 做出贡献！

Thank you for your interest in contributing to Open Immerse Translate!

## 如何贡献 | How to Contribute

### 报告 Bug | Report Bugs

1. 搜索 [Issues](https://github.com/flowinginthewind700/OpenImmerseTranslate/issues) 确认问题未被报告
2. 创建新 Issue，包含：
   - 清晰的标题和描述
   - 复现步骤
   - 预期行为与实际行为
   - Chrome 版本和操作系统
   - 截图或错误日志（如有）

### 功能建议 | Feature Requests

欢迎通过 Issue 提出新功能建议，请描述：
- 功能的用途和价值
- 期望的实现方式
- 是否愿意参与开发

### 提交代码 | Submit Code

#### 开发流程

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/YOUR_USERNAME/OpenImmerseTranslate.git
cd OpenImmerseTranslate

# 2. 创建特性分支
git checkout -b feature/your-feature-name

# 3. 安装依赖
npm install

# 4. 开发并测试
# 在 Chrome 中加载扩展进行测试

# 5. 提交更改
git add .
git commit -m "feat: add your feature description"

# 6. 推送并创建 PR
git push origin feature/your-feature-name
```

#### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具变更 |

示例：
```
feat: add floating translation button
fix: resolve API rate limit error
docs: update installation guide
```

#### 代码风格

- 使用 2 空格缩进
- 使用有意义的变量和函数名
- 添加必要的注释
- 保持代码简洁清晰

### Pull Request 流程

1. 确保 PR 针对 `main` 分支
2. 填写 PR 模板，描述更改内容
3. 确保代码正常工作
4. 等待审核和合并

## 项目结构 | Project Structure

```
OpenImmerseTranslate/
├── manifest.json           # 扩展配置
├── popup/                  # 弹出窗口 UI
├── content/                # 页面注入脚本
├── background/             # 后台服务
├── styles/                 # 样式文件
├── icons/                  # 图标资源
└── scripts/                # 构建脚本
```

## 开发指南 | Development Guide

### 本地测试

1. 在 `chrome://extensions/` 加载扩展
2. 修改代码后点击刷新按钮
3. 打开 DevTools 查看日志

### 调试技巧

- **Popup**: 右键扩展图标 → 检查弹出内容
- **Content Script**: 在页面 DevTools 中查看
- **Background**: 扩展详情页 → 检查视图

## 行为准则 | Code of Conduct

- 尊重所有贡献者
- 保持友善和专业
- 欢迎不同背景的参与者

## 问题求助 | Get Help

- 查阅 [README](README.md)
- 搜索现有 Issues
- 创建新 Issue 询问

---

再次感谢你的贡献！🎉

Thank you for contributing! 🎉

