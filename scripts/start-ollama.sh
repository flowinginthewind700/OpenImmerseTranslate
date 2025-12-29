#!/bin/bash
# 启动 Ollama 并允许 Chrome 扩展访问
# 双击运行此脚本，或在终端中执行: bash start-ollama.sh

echo "🦙 正在启动 Ollama..."
echo "✅ 已启用 Chrome 扩展访问权限"
echo ""
echo "按 Ctrl+C 停止服务"
echo "----------------------------------------"

OLLAMA_ORIGINS="*" ollama serve





