// 打包后自检：用打包好的 asr.js、ffmpeg、模型识别一段音频，确认 Mac 上本地语音识别能跑通
// 用法：ELECTRON_RUN_AS_NODE=1 "河传答哒.app/Contents/MacOS/河传答哒" scripts/smoke-asr.js <Resources 目录> <音频文件>
const path = require('path');
const [resources, file] = process.argv.slice(2).map(p => path.resolve(p));
const appDir = path.join(resources, 'app.asar');
const { transcribe } = require(path.join(appDir, 'asr.js'));
const ffmpeg = require(path.join(appDir, 'node_modules', 'ffmpeg-static')).replace('app.asar', 'app.asar.unpacked');
const texts = [];
transcribe({ file, modelDir: path.join(resources, 'models'), ffmpeg, threads: 2 }, m => {
  if (m.type === 'text') texts.push(m.text);
  if (m.type === 'done') console.log(`识别完成 ${m.seconds.toFixed(1)} 秒：${texts.join(' ')}`);
}).then(() => {
  if (!texts.length) { console.error('没有识别出文字'); process.exit(1); }
}, e => { console.error(e); process.exit(1); });
