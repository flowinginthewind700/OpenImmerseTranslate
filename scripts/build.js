#!/usr/bin/env node
/**
 * Chrome 扩展构建脚本
 * 将插件打包成 zip 文件，可用于发布或分发
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const BUILD_DIR = path.join(DIST_DIR, 'OpenImmerseTranslate');

// 需要包含的文件和文件夹
const INCLUDE_FILES = [
  'manifest.json',
  'popup',
  'content',
  'background',
  'shared',
  'styles',
  'icons'
];

// 需要排除的文件模式
const EXCLUDE_PATTERNS = [
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '.git',
  'node_modules',
  'scripts',
  'dist',
  'package.json',
  'package-lock.json',
  'README.md',
  '.gitignore'
];

// 清理目录
function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

// 复制文件/文件夹
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const files = fs.readdirSync(src);
    
    for (const file of files) {
      // 检查是否应该排除
      if (shouldExclude(file)) continue;
      
      copyRecursive(
        path.join(src, file),
        path.join(dest, file)
      );
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// 检查是否应该排除
function shouldExclude(filename) {
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
      return regex.test(filename);
    }
    return filename === pattern;
  });
}

// 获取版本号
function getVersion() {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.version;
}

// 主构建流程
async function build() {
  console.log('🚀 开始构建 Open Immerse Translate...\n');
  
  const version = getVersion();
  console.log(`📦 版本: ${version}\n`);
  
  // 1. 清理构建目录
  console.log('🧹 清理构建目录...');
  cleanDir(DIST_DIR);
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  
  // 2. 复制文件
  console.log('📁 复制文件...');
  for (const item of INCLUDE_FILES) {
    const src = path.join(ROOT_DIR, item);
    const dest = path.join(BUILD_DIR, item);
    
    if (fs.existsSync(src)) {
      copyRecursive(src, dest);
      console.log(`   ✓ ${item}`);
    } else {
      console.log(`   ⚠ ${item} (不存在，跳过)`);
    }
  }
  
  // 3. 创建 zip 文件
  console.log('\n📦 打包 zip 文件...');
  const zipName = `OpenImmerseTranslate-v${version}.zip`;
  const zipPath = path.join(DIST_DIR, zipName);
  
  try {
    // 使用系统 zip 命令
    execSync(`cd "${DIST_DIR}" && zip -r "${zipName}" OpenImmerseTranslate`, {
      stdio: 'pipe'
    });
    console.log(`   ✓ ${zipName}`);
  } catch (error) {
    console.log('   ⚠ zip 命令不可用，跳过打包');
    console.log('   提示：可以手动压缩 dist/OpenImmerseTranslate 文件夹');
  }
  
  // 4. 输出结果
  console.log('\n✅ 构建完成！\n');
  console.log('输出目录:');
  console.log(`   📂 ${BUILD_DIR}`);
  if (fs.existsSync(zipPath)) {
    console.log(`   📦 ${zipPath}`);
  }
  
  console.log('\n安装方式:');
  console.log('1. 打开 Chrome 浏览器');
  console.log('2. 访问 chrome://extensions/');
  console.log('3. 开启右上角「开发者模式」');
  console.log('4. 点击「加载已解压的扩展程序」');
  console.log(`5. 选择文件夹: ${BUILD_DIR}`);
  console.log('\n或者直接加载源码目录:');
  console.log(`   ${ROOT_DIR}`);
}

// 运行构建
build().catch(error => {
  console.error('❌ 构建失败:', error.message);
  process.exit(1);
});





