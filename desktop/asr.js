// 本地语音识别：ffmpeg 把任意音视频解码成 16kHz 单声道 → silero VAD 按句切分 → SenseVoice 逐句识别
// 边解码边识别，内存占用和录音长度无关
const { spawn } = require('child_process');
const path = require('path');
const sherpa = require('sherpa-onnx-node');

const RATE = 16000;
const WINDOW = 512;  // silero VAD 每次喂 512 个采样点

async function transcribe({ file, modelDir, ffmpeg, threads }, send) {
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: path.join(modelDir, 'sensevoice', 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 },
      tokens: path.join(modelDir, 'sensevoice', 'tokens.txt'),
      numThreads: threads, provider: 'cpu', debug: 0
    }
  });
  const vad = new sherpa.Vad({
    sileroVad: { model: path.join(modelDir, 'silero_vad.onnx'), threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: WINDOW },
    sampleRate: RATE, numThreads: 1, debug: 0
  }, 60);

  const ff = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { windowsHide: true });
  const exited = new Promise(r => ff.on('close', r));
  let errTail = '', durationSent = false;
  ff.stderr.on('data', d => {
    errTail = (errTail + d).slice(-4000);
    const m = !durationSent && /Duration: (\d+):(\d+):([\d.]+)/.exec(errTail);
    if (m) { durationSent = true; send({ type: 'duration', duration: +m[1] * 3600 + +m[2] * 60 + +m[3] }); }
  });

  // Electron 不允许外部内存缓冲区，所以取片段时传 false
  async function drain() {
    while (!vad.isEmpty()) {
      const seg = vad.front(false);
      vad.pop();
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: seg.samples, sampleRate: RATE });
      const r = await recognizer.decodeAsync(stream);
      const text = (r.text || '').trim();
      if (text) send({ type: 'text', start: seg.start / RATE, text });
    }
  }

  let pending = new Float32Array(0), odd = null, total = 0;
  for await (let chunk of ff.stdout) {  // for await 自带背压：识别跟不上时 ffmpeg 会暂停
    if (odd) { chunk = Buffer.concat([odd, chunk]); odd = null; }
    if (chunk.length % 2) { odd = chunk.subarray(chunk.length - 1); chunk = chunk.subarray(0, chunk.length - 1); }
    const n = chunk.length / 2, f = new Float32Array(pending.length + n);
    f.set(pending);
    for (let i = 0; i < n; i++) f[pending.length + i] = chunk.readInt16LE(i * 2) / 32768;
    let off = 0;
    for (; off + WINDOW <= f.length; off += WINDOW) vad.acceptWaveform(f.slice(off, off + WINDOW));
    pending = f.slice(off);
    total += n;
    await drain();
    send({ type: 'progress', seconds: total / RATE });
  }
  vad.flush();
  await drain();
  const code = await exited;
  if (total === 0) throw new Error(code ? '无法读取这个文件：' + (errTail.trim().split('\n').pop() || '格式不支持') : '文件里没有声音');
  send({ type: 'done', seconds: total / RATE });
}

module.exports = { transcribe };
