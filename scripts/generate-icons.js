/**
 * 图标生成脚本
 * 将 SVG 图标转换为不同尺寸的 PNG
 * 
 * 使用方法：
 * 1. 安装依赖: npm install sharp
 * 2. 运行脚本: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// 尝试使用 sharp 库
async function generateWithSharp() {
  const sharp = require('sharp');
  const sizes = [16, 32, 48, 128];
  const svgPath = path.join(__dirname, '../icons/icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);
  
  for (const size of sizes) {
    const outputPath = path.join(__dirname, `../icons/icon${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`✓ Generated icon${size}.png`);
  }
  
  console.log('\n所有图标生成完成！');
}

// 如果没有 sharp，提供替代方案
async function main() {
  try {
    await generateWithSharp();
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('未找到 sharp 模块。请选择以下方式之一生成图标：\n');
      console.log('方式一：安装 sharp 并重新运行');
      console.log('  npm install sharp');
      console.log('  node scripts/generate-icons.js\n');
      console.log('方式二：使用 ImageMagick');
      console.log('  convert icons/icon.svg -resize 16x16 icons/icon16.png');
      console.log('  convert icons/icon.svg -resize 32x32 icons/icon32.png');
      console.log('  convert icons/icon.svg -resize 48x48 icons/icon48.png');
      console.log('  convert icons/icon.svg -resize 128x128 icons/icon128.png\n');
      console.log('方式三：使用在线工具');
      console.log('  访问 https://cloudconvert.com/svg-to-png');
      console.log('  上传 icons/icon.svg 并导出不同尺寸\n');
      
      // 创建简单的占位图标（纯色方块）
      console.log('正在创建临时占位图标...');
      createPlaceholderIcons();
    } else {
      throw error;
    }
  }
}

// 创建简单的占位PNG图标
function createPlaceholderIcons() {
  const sizes = [16, 32, 48, 128];
  
  // PNG 文件头和 IHDR chunk 的生成函数
  function createSimplePNG(size) {
    // 创建一个简单的纯色 PNG
    // 这是一个最小的有效 PNG 文件结构
    const png = Buffer.alloc(8 + 25 + 12 + size * size * 4 + 12 + 12);
    let offset = 0;
    
    // PNG 签名
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(png, offset);
    offset += 8;
    
    // 为简化，这里使用一个预生成的最小PNG模板
    // 实际项目中建议使用 sharp 或其他库
    return null;
  }
  
  // 由于手动生成PNG比较复杂，建议用户使用工具
  console.log('占位图标创建跳过。请使用上述方法之一生成实际图标。');
  console.log('\n提示：插件在没有图标的情况下也可以加载，只是会显示默认图标。');
}

main().catch(console.error);

