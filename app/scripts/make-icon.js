// 把 build/icon.svg 渲染成 PNG：
//   build/icon.png（1024×1024）electron-builder 打包时再转成 ico
//   src/assets/icon.png（256×256）软件运行时的窗口和托盘图标（打包只收 src/**）
// 用法：npm run icon（改了 icon.svg 之后运行）
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const OUTPUTS = [
  { file: path.join(appDir, 'build', 'icon.png'), size: 1024 },
  { file: path.join(appDir, 'src', 'assets', 'icon.png'), size: 256 },
];

// 在隐藏窗口里用 canvas 画 SVG 再导出 PNG，不依赖截图，和屏幕缩放无关
async function render(svg, size) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(appDir, 'build', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  for (const { file, size } of OUTPUTS) {
    const dataUrl = await win.webContents.executeJavaScript(`(${render})(${JSON.stringify(svg)}, ${size})`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`已生成 ${path.relative(appDir, file)}（${size}×${size}）`);
  }
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
