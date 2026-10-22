// 语音识别子进程入口（由 main.js 用 utilityProcess 启动）
// 结束时不能立刻 process.exit，否则最后一条消息可能还没送到；由主进程收到 done/error 后结束本进程
const { transcribe } = require('./asr');

process.parentPort.once('message', async ({ data }) => {
  const send = m => process.parentPort.postMessage(m);
  try {
    await transcribe(data, send);
  } catch (e) {
    send({ type: 'error', message: e.message || String(e) });
  }
  setTimeout(() => process.exit(0), 10000).unref();  // 兜底：主进程没来得及结束时自行退出
});
