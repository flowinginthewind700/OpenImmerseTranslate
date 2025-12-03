#!/usr/bin/env node
/**
 * 创建精美的 PNG 图标
 * 使用纯 Node.js 绘制带渐变的翻译图标
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 计算
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createIHDR(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8);   // bit depth
  data.writeUInt8(6, 9);   // RGBA
  data.writeUInt8(0, 10);  // compression
  data.writeUInt8(0, 11);  // filter
  data.writeUInt8(0, 12);  // interlace
  return createChunk('IHDR', data);
}

// 颜色混合
function blendColors(c1, c2, t) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t)
  };
}

// 绘制圆角矩形
function isInsideRoundedRect(x, y, width, height, radius, padding) {
  const px = padding;
  const py = padding;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const r = radius;
  
  // 检查是否在圆角矩形内
  if (x < px || x >= px + w || y < py || y >= py + h) return false;
  
  // 检查四个角
  const corners = [
    { cx: px + r, cy: py + r },      // 左上
    { cx: px + w - r, cy: py + r },  // 右上
    { cx: px + r, cy: py + h - r },  // 左下
    { cx: px + w - r, cy: py + h - r } // 右下
  ];
  
  for (const corner of corners) {
    const dx = x - corner.cx;
    const dy = y - corner.cy;
    const isInCornerArea = (
      (corner.cx === px + r && x < px + r) || (corner.cx === px + w - r && x >= px + w - r)
    ) && (
      (corner.cy === py + r && y < py + r) || (corner.cy === py + h - r && y >= py + h - r)
    );
    
    if (isInCornerArea && (dx * dx + dy * dy > r * r)) {
      return false;
    }
  }
  
  return true;
}

// 创建图标像素数据
function createIconPixels(size) {
  const pixels = [];
  const padding = Math.floor(size * 0.03);
  const radius = Math.floor(size * 0.22);
  
  // 颜色定义
  const blue = { r: 0, g: 122, b: 255 };    // Apple Blue
  const purple = { r: 175, g: 82, b: 222 }; // Apple Purple
  const white = { r: 255, g: 255, b: 255 };
  
  for (let y = 0; y < size; y++) {
    pixels.push(0); // filter byte
    for (let x = 0; x < size; x++) {
      // 检查是否在圆角矩形内
      if (isInsideRoundedRect(x, y, size, size, radius, padding)) {
        // 计算渐变 (左上到右下)
        const t = (x + y) / (size * 2);
        const bgColor = blendColors(blue, purple, t);
        
        // 添加光泽效果 (上半部分更亮)
        const shineT = y / size;
        const shine = shineT < 0.5 ? (0.5 - shineT) * 0.3 : 0;
        
        const r = Math.min(255, Math.round(bgColor.r + shine * 255));
        const g = Math.min(255, Math.round(bgColor.g + shine * 255));
        const b = Math.min(255, Math.round(bgColor.b + shine * 255));
        
        // 绘制图标内容 (简化的 A 和 文 符号)
        const centerX = size / 2;
        const centerY = size / 2;
        const iconSize = size * 0.6;
        const startX = (size - iconSize) / 2;
        const startY = (size - iconSize) / 2;
        
        // 相对坐标
        const rx = (x - startX) / iconSize;
        const ry = (y - startY) / iconSize;
        
        let isIcon = false;
        
        if (rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) {
          // 绘制 "A" (左上区域)
          if (rx < 0.45 && ry < 0.5) {
            const ax = (rx - 0.22) / 0.22;
            const ay = ry / 0.5;
            // A 的形状
            if (ay > 0.2) {
              const expectedX = Math.abs(ax) * (1 - ay) * 0.8;
              if (Math.abs(Math.abs(ax) - expectedX) < 0.15) {
                isIcon = true;
              }
              // A 的横线
              if (ay > 0.55 && ay < 0.7 && Math.abs(ax) < 0.3) {
                isIcon = true;
              }
            }
          }
          
          // 绘制 "文" (右下区域)
          if (rx > 0.55 && ry > 0.5) {
            const wx = (rx - 0.77) / 0.22;
            const wy = (ry - 0.75) / 0.25;
            // 横线
            if (Math.abs(wy + 0.6) < 0.12 && Math.abs(wx) < 0.8) {
              isIcon = true;
            }
            // 竖线
            if (Math.abs(wx) < 0.1 && wy > -0.6 && wy < 0.8) {
              isIcon = true;
            }
            // 撇捺
            if (wy > 0 && wy < 0.8) {
              if (Math.abs(wx - wy * 0.6) < 0.12 || Math.abs(wx + wy * 0.6) < 0.12) {
                isIcon = true;
              }
            }
          }
          
          // 绘制双向箭头 (中间)
          if (rx > 0.35 && rx < 0.65 && ry > 0.35 && ry < 0.65) {
            const arrowX = (rx - 0.5) / 0.15;
            const arrowY = (ry - 0.5) / 0.15;
            // 箭头线
            if (Math.abs(arrowY) < 0.2 && Math.abs(arrowX) < 0.8) {
              isIcon = true;
            }
            // 箭头头部
            if (arrowX > 0.3) {
              if (Math.abs(arrowY - (arrowX - 0.5) * 0.8) < 0.15 ||
                  Math.abs(arrowY + (arrowX - 0.5) * 0.8) < 0.15) {
                isIcon = true;
              }
            }
            if (arrowX < -0.3) {
              if (Math.abs(arrowY - (arrowX + 0.5) * -0.8) < 0.15 ||
                  Math.abs(arrowY + (arrowX + 0.5) * -0.8) < 0.15) {
                isIcon = true;
              }
            }
          }
        }
        
        if (isIcon) {
          pixels.push(white.r, white.g, white.b, 240);
        } else {
          pixels.push(r, g, b, 255);
        }
      } else {
        // 透明
        pixels.push(0, 0, 0, 0);
      }
    }
  }
  
  return Buffer.from(pixels);
}

function createIDAT(size) {
  const raw = createIconPixels(size);
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return createChunk('IDAT', compressed);
}

function createIEND() {
  return createChunk('IEND', Buffer.alloc(0));
}

function createPNG(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = createIHDR(size, size);
  const idat = createIDAT(size);
  const iend = createIEND();
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// 生成图标
const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, '../icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('🎨 正在生成精美图标...\n');

sizes.forEach(size => {
  const png = createPNG(size);
  const outputPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outputPath, png);
  console.log(`   ✓ icon${size}.png (${size}x${size})`);
});

console.log('\n✅ 图标生成完成！');
console.log('   蓝紫渐变背景 + 圆角 + 翻译符号');
