const { app, BrowserWindow, ipcMain, Menu, shell, utilityProcess, safeStorage, session, Tray, Notification, nativeImage, screen, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 软件从"大学助手"改名为"河传答哒"后，数据文件夹（%APPDATA%\软件名）也换了名字。
// 新文件夹里还没有数据时，把旧文件夹整个复制过来（课表日程笔记、AI 设置、记住的学号密码、录音都在里面）。
// 必须在用到 userData 之前做（单实例锁、页面存储都在这个文件夹里）；旧文件夹保留不删，出问题还能找回
(function migrateUserData() {
  try {
    const now = app.getPath('userData'), old = path.join(app.getPath('appData'), '大学助手');
    if (path.resolve(now) === path.resolve(old) || !fs.existsSync(old) || fs.existsSync(path.join(now, 'Local Storage'))) return;
    fs.cpSync(old, now, { recursive: true, force: false, errorOnExist: false });
    console.log('已把旧版"大学助手"的数据搬到', now);
  } catch (e) { console.warn('搬旧数据失败', e); }
})();

let mainWin = null, tray = null;
const ICON = path.join(__dirname, 'build', 'icon.ico');
// 开机自启时带 --hidden：只在后台运行（照样提醒），不弹窗口
const startHidden = process.argv.includes('--hidden');

// 偏好：关闭窗口时是否缩到托盘（默认是，这样才能继续提醒）；是否显示桌宠（默认显示）
const PREF_FILE = () => path.join(app.getPath('userData'), 'prefs.json');
let prefs = { tray: true, pet: true };
function prefsLoad() { try { prefs = { tray: true, pet: true, ...JSON.parse(fs.readFileSync(PREF_FILE(), 'utf8')) }; } catch (e) {} }
function prefsSave() { try { fs.writeFileSync(PREF_FILE(), JSON.stringify(prefs)); } catch (e) {} }

function createMain() {
  mainWin = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    title: '河传答哒', show: !startHidden,
    icon: ICON,
    // 不要系统标题栏：右上角的最小化 / 最大化 / 关闭由页面自己画（橙色模糊光晕里的三个按钮）
    frame: false,
    // 窗口藏起来时定时器也要照常跑，不然提醒会晚
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  Menu.setApplicationMenu(null);
  mainWin.loadFile('index.html');
  // 窗口状态告诉页面：最大化时按钮换成"还原"图标，窗口不在前台时光晕变淡
  const winState = () => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('win:state', { max: mainWin.isMaximized(), focus: mainWin.isFocused() });
  for (const ev of ['maximize', 'unmaximize', 'focus', 'blur', 'restore']) mainWin.on(ev, winState);
  // 页面加载完才能回答小组件和桌宠要的数据：加载完通知它们重新拿
  mainWin.webContents.on('did-finish-load', () => {
    winState();
    sendWidgets('widget:refresh');
    if (petWin) petWin.webContents.send('pet:refresh');
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.on('close', e => {
    if (app.isQuitting || !prefs.tray) return;
    e.preventDefault();
    mainWin.hide();
    if (!prefs.trayTipShown) {
      prefs.trayTipShown = true; prefsSave();
      notify('河传答哒还在后台运行', '会继续按时提醒你。要彻底退出，右键点屏幕右下角托盘里的图标');
    }
  });
  // 主窗口真的关掉了（没开托盘）就退出：桌宠窗口还开着，不会自动触发 window-all-closed
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}
function showMain() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}

// 托盘图标：单击打开；右键菜单可以开关开机自启、退出
const LOGIN_ARGS = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
const autoStartOn = () => app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin;
function setAutoStart(on) { app.setLoginItemSettings({ openAtLogin: on, args: LOGIN_ARGS }); updateTrayMenu(); }
// 开机自启登记的是程序路径；改名后程序文件名变了（大学助手.exe → 河传答哒.exe），旧登记会指向不存在的文件，这里换成现在的路径
function fixAutoStartPath() {
  if (!app.isPackaged) return;
  try {
    const items = app.getLoginItemSettings({ args: LOGIN_ARGS }).launchItems || [];
    if (items.some(i => i.enabled && i.path && path.resolve(i.path) !== path.resolve(process.execPath))) setAutoStart(true);
  } catch (e) {}
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('河传答哒');
  tray.on('click', showMain);
  updateTrayMenu();
}
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开河传答哒', click: showMain },
    { label: '显示桌宠', type: 'checkbox', checked: !!prefs.pet, click: m => setPet(m.checked) },
    { label: '显示桌面小组件', type: 'checkbox', checked: !prefs.widgetsOff, click: m => setWidgetsOff(!m.checked) },
    { label: '管理桌面小组件…', click: () => { showMain(); mainWin.webContents.send('widgets:edit', ''); } },
    { label: '开机自动启动', type: 'checkbox', checked: autoStartOn(), click: m => setAutoStart(m.checked) },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

// Windows 通知；点一下打开主窗口。留着引用，防止通知还没点就被回收、点击没反应。
// 桌宠也会跟着跳一下、冒个气泡
const shown = new Set();
function notify(title, body) {
  if (petWin) petWin.webContents.send('pet:alert', { title, body });
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  shown.add(n);
  n.on('click', () => { showMain(); shown.delete(n); });
  n.on('close', () => shown.delete(n));
  n.show();
}
ipcMain.handle('app:notify', (_e, { title, body }) => { notify(String(title || ''), String(body || '')); return true; });
ipcMain.handle('app:getPrefs', () => ({ tray: prefs.tray, pet: !!prefs.pet, petSize: prefs.petSize || 'm', widget: !prefs.widgetsOff, autostart: autoStartOn() }));
ipcMain.handle('app:setPrefs', (_e, p) => {
  if ('tray' in p) { prefs.tray = !!p.tray; prefsSave(); }
  if ('pet' in p) setPet(!!p.pet);
  if ('petSize' in p && PET_SIZES[p.petSize]) { prefs.petSize = p.petSize; prefsSave(); if (petWin) { petWin.destroy(); createPet(); } }
  if ('widget' in p) setWidgetsOff(!p.widget);
  if ('autostart' in p) setAutoStart(!!p.autostart);
  return true;
});
// 页面自己画的窗口按钮
ipcMain.on('win:ctl', (e, a) => {
  if (!mainWin || e.sender !== mainWin.webContents) return;
  if (a === 'min') mainWin.minimize();
  else if (a === 'max') mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize();
  else if (a === 'close') mainWin.close();  // 走原来的关闭逻辑（开了托盘就缩到托盘）
});
// 页面的数据变了（加了日程、勾了待办……）：小组件和桌宠重新拿一次
ipcMain.on('app:dataChanged', e => {
  if (!mainWin || e.sender !== mainWin.webContents) return;
  sendWidgets('widget:refresh');
  if (petWin) petWin.webContents.send('pet:refresh');
});

// 拖动小窗口：按下后每帧跟着鼠标走（用主进程的鼠标位置，不受屏幕缩放影响）
function follow(getPos, move) {
  const c = screen.getCursorScreenPoint(), a = { ...getPos() };
  return setInterval(() => { const p = screen.getCursorScreenPoint(); move({ x: a.x + p.x - c.x, y: a.y + p.y - c.y }); }, 16);
}
// 让小窗口留在屏幕里
function clampTo(p, w, h) {
  const wa = screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea;
  return { x: Math.round(Math.min(Math.max(p.x, wa.x), wa.x + wa.width - w)), y: Math.round(Math.min(Math.max(p.y, wa.y), wa.y + wa.height - h)) };
}

// ========== 桌宠：屏幕上的悬浮小日历，把聊天文字拖给它就去识别日程 ==========
// 识别、加日历都交给主窗口的页面做（AI 设置、日程数据都在那边），桌宠只管显示。
// 窗口平时只有小日历那么大；弹气泡时按气泡大小撑大，气泡放在小日历上面（太靠屏幕顶就放下面）。
// 画面按 130×140 设计，设置里的大小（小 / 中 / 大）是缩放倍数
const PET_SIZES = { s: .58, m: .72, l: .9 };
let PET_W = 94, PET_H = 101;
let petWin = null, petAnchor = null, petBubble = null, petDrag = 0, petCursor = 0, appTheme = 'light';
const clampPet = p => clampTo(p, PET_W, PET_H);
function petLayout() {
  const a = petAnchor;
  if (!petBubble) { petWin.setBounds({ x: a.x, y: a.y, width: PET_W, height: PET_H }); return { petLeft: 0, petTop: 0, above: true }; }
  const wa = screen.getDisplayNearestPoint(a).workArea;
  const W = Math.max(PET_W, petBubble.w), H = PET_H + petBubble.h;
  const x = Math.round(Math.min(Math.max(a.x + PET_W / 2 - W / 2, wa.x), wa.x + wa.width - W));
  const above = a.y - petBubble.h >= wa.y;
  petWin.setBounds({ x, y: above ? a.y - petBubble.h : a.y, width: W, height: H });
  return { petLeft: a.x - x, petTop: above ? petBubble.h : 0, above };
}
function createPet() {
  if (petWin) return;
  const s = PET_SIZES[prefs.petSize] || PET_SIZES.m;
  PET_W = Math.round(130 * s); PET_H = Math.round(140 * s);
  const wa = screen.getPrimaryDisplay().workArea;
  petAnchor = clampPet(prefs.petPos || { x: wa.x + wa.width - PET_W - 30, y: wa.y + wa.height - PET_H - 30 });
  petBubble = null;
  petWin = new BrowserWindow({
    x: petAnchor.x, y: petAnchor.y, width: PET_W, height: PET_H, show: false,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, title: '河传答哒',
    webPreferences: { preload: path.join(__dirname, 'pet-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  petWin.loadFile('pet.html', { query: { s: String(s) } });
  petWin.once('ready-to-show', () => petWin && petWin.showInactive());
  // 拖进来的文件、链接不要把页面导航走
  petWin.webContents.on('will-navigate', e => e.preventDefault());
  petWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 眼睛跟着鼠标转：鼠标动了才发
  let last = '';
  petCursor = setInterval(() => {
    if (!petWin || petDrag) return;
    const p = screen.getCursorScreenPoint(), k = p.x + ',' + p.y;
    if (k === last) return;
    last = k;
    petWin.webContents.send('pet:cursor', { dx: p.x - (petAnchor.x + PET_W / 2), dy: p.y - (petAnchor.y + PET_H * .55) });
  }, 100);
  petWin.on('closed', () => { petWin = null; clearInterval(petDrag); clearInterval(petCursor); petDrag = 0; });
}
function setPet(on) {
  prefs.pet = on; prefsSave();
  if (on) createPet(); else if (petWin) petWin.destroy();
  updateTrayMenu();
}
const fromPet = e => petWin && e.sender === petWin.webContents;
ipcMain.on('pet:dragStart', e => {
  if (!fromPet(e) || petDrag) return;
  petDrag = follow(() => petAnchor, p => { petAnchor = clampPet(p); if (petWin && !petBubble) petWin.setPosition(petAnchor.x, petAnchor.y); });
});
ipcMain.on('pet:dragEnd', e => {
  if (!fromPet(e) || !petDrag) return;
  clearInterval(petDrag); petDrag = 0;
  prefs.petPos = petAnchor; prefsSave();
});
ipcMain.handle('pet:layout', (e, size) => {
  if (!fromPet(e)) return null;
  petBubble = size && size.h ? { w: Math.min(Math.ceil(size.w), 420), h: Math.min(Math.ceil(size.h), 600) } : null;
  return petLayout();
});
// 让主窗口的页面干活：发 pet:ask，页面做完用 pet:reply 回来（桌宠和小组件共用）
const petJobs = new Map();
let petSeq = 0;
function askMain(type, data, timeout = 320000) {
  if (!mainWin || mainWin.isDestroyed()) return Promise.resolve({ ok: false, message: '主窗口没开着' });
  return new Promise(resolve => {
    const id = ++petSeq;
    // 页面那边没回（比如正在刷新）也别一直等着；AI 本身最长 5 分钟
    const t = setTimeout(() => { petJobs.delete(id); resolve({ ok: false, message: '等太久了，再试一次吧' }); }, timeout);
    petJobs.set(id, r => { clearTimeout(t); resolve(r); });
    mainWin.webContents.send('pet:ask', { id, type, ...data });
  });
}
ipcMain.handle('pet:reply', (e, id, r) => {
  if (!mainWin || e.sender !== mainWin.webContents) return false;
  const f = petJobs.get(id);
  petJobs.delete(id);
  if (f) f(r);
  return true;
});
ipcMain.handle('pet:recognize', (e, text) => fromPet(e) ? askMain('recognize', { text: String(text || '').slice(0, 60000) }) : null);
ipcMain.handle('pet:add', (e, list) => fromPet(e) ? askMain('add', { list: Array.isArray(list) ? list.slice(0, 50) : [] }) : null);
ipcMain.handle('pet:status', async e => { if (!fromPet(e)) return null; const r = await askMain('snapshot', {}, 8000); return r && r.ok !== false ? r : null; });
ipcMain.handle('pet:clipboard', e => fromPet(e) ? clipboard.readText() : '');
ipcMain.handle('pet:open', (e, data) => {
  if (!fromPet(e)) return false;
  if (data) askMain('open', { text: String(data.text || ''), list: Array.isArray(data.list) ? data.list.slice(0, 50) : [] });
  showMain();
  return true;
});
ipcMain.handle('pet:toggleWidget', e => { if (fromPet(e)) setWidgetsOff(!prefs.widgetsOff); return true; });
ipcMain.handle('pet:hide', e => {
  if (!fromPet(e)) return false;
  setPet(false);
  notify('桌宠先藏起来了', '想让它回来：右键点托盘图标，勾上「显示桌宠」；或者在「设置 → 启动」里打开');
  return true;
});
ipcMain.handle('pet:getTheme', () => appTheme);
ipcMain.on('app:theme', (e, t) => {
  if (!mainWin || e.sender !== mainWin.webContents) return;
  appTheme = ['light', 'dark', 'system'].includes(t) ? t : 'light';
  if (petWin) petWin.webContents.send('pet:theme', appTheme);
  sendWidgets('app:theme', appTheme);
});

// ========== 桌面小组件：可以放好几个，每个是一种（时钟、下一节课、待办、月历……），各自一个小窗口 ==========
// 配置存在 prefs.widgets（数组，每项有 id、type、样子和位置）；prefs.widgetsOff 是"先都藏起来"。
// 怎么摆、什么样子在软件的「桌面小组件」页面里改；窗口大小跟着卡片走（页面量好了发 widget:resize）
const WIDGET_TYPES = ['overview', 'clock', 'next', 'today', 'todo', 'countdown', 'week', 'month', 'term'];
const WIDGET_MODS = ['clock', 'next', 'today', 'todo', 'week', 'term', 'countdown'];
const wDefault = type => ({ type, theme: 'auto', accent: 'clay', size: 'm', opacity: .94, top: false, locked: false, countdown: null, pos: null,
  modules: WIDGET_MODS.map(id => ({ id, on: ['clock', 'next', 'today', 'todo', 'countdown'].includes(id) })) });
const newWid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function widgetList() {
  if (!Array.isArray(prefs.widgets)) {
    // 以前只有一个小组件（prefs.widget）：搬成"今日概览"；新装的人桌面上先什么都不放，自己去「桌面小组件」页面挑
    const old = prefs.widget;
    // 旧配置里缺的项不要盖掉默认值（不然比如 modules 变成空，画的时候会出错）
    const keep = old ? Object.fromEntries(['theme', 'accent', 'opacity', 'top', 'locked', 'countdown', 'modules', 'pos'].filter(k => old[k] != null).map(k => [k, old[k]])) : {};
    prefs.widgets = !old || old.on === false ? [] : [{ ...wDefault('overview'), ...keep, size: { s: 's', l: 'l' }[old.width] || 'm', id: newWid() }];
    if (old) prefs.widgetsOff = old.on === false;
    delete prefs.widget;
    prefsSave();
  }
  return prefs.widgets;
}
// 整理一份从页面传来的配置：只收认得的字段
function cleanWidget(old, c) {
  const n = { ...old };
  if (['auto', 'light', 'dark', 'glass', 'glassdark'].includes(c.theme)) n.theme = c.theme;
  if (/^[a-z]{2,12}$/.test(c.accent || '')) n.accent = c.accent;
  if (['s', 'm', 'l'].includes(c.size)) n.size = c.size;
  if ('opacity' in c) n.opacity = Math.min(1, Math.max(.4, +c.opacity || .94));
  if ('top' in c) n.top = !!c.top;
  if ('locked' in c) n.locked = !!c.locked;
  if ('countdown' in c) n.countdown = c.countdown && c.countdown.title && c.countdown.date ? { title: String(c.countdown.title).slice(0, 30), date: String(c.countdown.date).slice(0, 10) } : null;
  if (Array.isArray(c.modules)) n.modules = c.modules.filter(m => WIDGET_MODS.includes(m.id)).map(m => ({ id: m.id, on: !!m.on }));
  return n;
}
const widgetWins = new Map();   // id → { win, size, drag }
function createWidget(w, i = 0) {
  if (widgetWins.has(w.id)) return;
  const wa = screen.getPrimaryDisplay().workArea, size = { w: 330, h: 360 };
  const p = clampTo(w.pos || { x: wa.x + wa.width - size.w - 12 - i * 28, y: wa.y + 12 + i * 28 }, size.w, size.h);
  const win = new BrowserWindow({
    x: p.x, y: p.y, width: size.w, height: size.h, show: false,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: !!w.top, hasShadow: false, title: '河传答哒 小组件',
    webPreferences: { preload: path.join(__dirname, 'widget-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  const rec = { win, size, drag: 0 };
  widgetWins.set(w.id, rec);
  win.loadFile('widget.html', { query: { id: w.id } });
  win.once('ready-to-show', () => !win.isDestroyed() && win.showInactive());
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { clearInterval(rec.drag); if (widgetWins.get(w.id) === rec) widgetWins.delete(w.id); });
}
function showWidgets() {
  const list = widgetList();
  for (const [id, r] of widgetWins) if (prefs.widgetsOff || !list.some(w => w.id === id)) r.win.destroy();
  if (!prefs.widgetsOff) list.forEach((w, i) => createWidget(w, i));
  updateTrayMenu();
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('widgets:changed');
}
function setWidgetsOff(off) { prefs.widgetsOff = !!off; prefsSave(); showWidgets(); }
const sendWidgets = (ch, data) => { for (const r of widgetWins.values()) r.win.webContents.send(ch, data); };
// 小组件窗口发来的消息：认出是哪一个
function widgetOf(e) {
  for (const [id, r] of widgetWins) if (r.win.webContents === e.sender) return { id, r, w: widgetList().find(x => x.id === id) };
  return null;
}
function updateWidget(id, patch) {
  const list = widgetList(), i = list.findIndex(w => w.id === id);
  if (i < 0) return null;
  list[i] = cleanWidget(list[i], patch);
  prefsSave();
  const r = widgetWins.get(id);
  if (r) { r.win.setAlwaysOnTop(!!list[i].top); r.win.webContents.send('widget:config', list[i]); }
  return list[i];
}
function removeWidget(id) {
  prefs.widgets = widgetList().filter(w => w.id !== id); prefsSave();
  showWidgets();
}
ipcMain.handle('widget:getConfig', e => { const x = widgetOf(e); return x && x.w ? { cfg: x.w, theme: appTheme } : null; });
ipcMain.handle('widget:setConfig', (e, c) => { const x = widgetOf(e); if (!x || !c) return false; updateWidget(x.id, c); mainWin && mainWin.webContents.send('widgets:changed'); return true; });
ipcMain.on('widget:resize', (e, s) => {
  const x = widgetOf(e); if (!x || !s) return;
  x.r.size = { w: Math.min(Math.max(Math.ceil(s.w), 160), 600), h: Math.min(Math.max(Math.ceil(s.h), 80), 1200) };
  const b = x.r.win.getBounds(), p = clampTo({ x: b.x, y: b.y }, x.r.size.w, x.r.size.h);
  x.r.win.setBounds({ x: p.x, y: p.y, width: x.r.size.w, height: x.r.size.h });
});
ipcMain.on('widget:dragStart', e => {
  const x = widgetOf(e); if (!x || x.r.drag) return;
  const win = x.r.win;
  x.r.drag = follow(() => win.getBounds(), p => { const q = clampTo(p, x.r.size.w, x.r.size.h); if (!win.isDestroyed()) win.setPosition(q.x, q.y); });
});
ipcMain.on('widget:dragEnd', e => {
  const x = widgetOf(e); if (!x || !x.r.drag) return;
  clearInterval(x.r.drag); x.r.drag = 0;
  const b = x.r.win.getBounds();
  if (x.w) { x.w.pos = { x: b.x, y: b.y }; prefsSave(); }
});
ipcMain.handle('widget:data', async e => { if (!widgetOf(e)) return null; const r = await askMain('snapshot', {}, 8000); return r && r.ok !== false ? r : null; });
ipcMain.handle('widget:toggleDone', (e, id) => widgetOf(e) ? askMain('toggleDone', { eid: String(id) }, 8000) : null);
ipcMain.handle('widget:open', (e, it) => {
  if (!widgetOf(e) || !it) return false;
  askMain('openItem', { kind: it.kind === 'course' ? 'course' : 'event', iid: String(it.id) }, 8000);
  showMain();
  return true;
});
// 小组件右上角的笔：打开软件的「桌面小组件」页面，选中这一个
ipcMain.handle('widget:edit', e => { const x = widgetOf(e); if (!x) return false; showMain(); mainWin.webContents.send('widgets:edit', x.id); return true; });
ipcMain.handle('widget:remove', e => {
  const x = widgetOf(e); if (!x) return false;
  removeWidget(x.id);
  notify('小组件已经从桌面上拿掉了', '想再放回来：打开软件左边「工具 → 桌面小组件」，挑一个添加');
  return true;
});
// 软件里「桌面小组件」页面用的
const fromMain = e => mainWin && e.sender === mainWin.webContents;
ipcMain.handle('widgets:list', e => fromMain(e) ? { list: widgetList(), off: !!prefs.widgetsOff } : null);
ipcMain.handle('widgets:add', (e, type) => {
  if (!fromMain(e) || !WIDGET_TYPES.includes(type)) return null;
  const w = { ...wDefault(type), id: newWid() };
  widgetList().push(w); prefs.widgetsOff = false; prefsSave();
  showWidgets();
  return w.id;
});
ipcMain.handle('widgets:update', (e, id, patch) => fromMain(e) && patch ? updateWidget(String(id), patch) : null);
ipcMain.handle('widgets:remove', (e, id) => { if (fromMain(e)) removeWidget(String(id)); return true; });
ipcMain.handle('widgets:setOff', (e, off) => { if (fromMain(e)) setWidgetsOff(off); return true; });
// 定位：让那个小组件跳到最前面闪一下
ipcMain.handle('widgets:locate', (e, id) => {
  if (!fromMain(e)) return false;
  const r = widgetWins.get(String(id)); if (!r) return false;
  r.win.showInactive(); r.win.moveTop();
  r.win.webContents.send('widget:flash');
  return true;
});

// 直接录音：界面每隔几秒发来一段，追加写进 userData/recordings 里的文件（只认这里发的编号，界面不能指定路径）
const REC_DIR = () => path.join(app.getPath('userData'), 'recordings');
const recFiles = new Map();
let recSeq = 0;
ipcMain.handle('rec:begin', () => {
  fs.mkdirSync(REC_DIR(), { recursive: true });
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const file = path.join(REC_DIR(), `课堂录音-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.webm`);
  fs.writeFileSync(file, '');
  recFiles.set(++recSeq, file);
  return recSeq;
});
ipcMain.handle('rec:append', (_e, id, buf) => {
  const file = recFiles.get(id);
  if (!file) return false;
  fs.appendFileSync(file, Buffer.from(buf));
  return true;
});
ipcMain.handle('rec:end', (_e, id) => { const file = recFiles.get(id) || ''; recFiles.delete(id); return file; });

// 打开教务系统窗口：用户自己登录（账号密码、验证码都由用户在学校页面里输入，软件不保存）
const JW_PARTITION = 'persist:jw';
ipcMain.handle('jw:open', (_e, url) => {
  const win = new BrowserWindow({
    width: 1200, height: 800, title: '教务系统 — 登录后打开"学生课表查询"',
    webPreferences: { partition: JW_PARTITION, contextIsolation: true }
  });
  // 门户里点开的新窗口也用同一个登录状态
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 1200, height: 800, webPreferences: { partition: JW_PARTITION, contextIsolation: true } }
  }));
  win.loadURL(url);
  return true;
});

// 学校教务系统是正方教务（jwxt.hebic.cn）。在已登录的教务页面里直接调用它自己的数据接口：
//   个人课表 xskbcx_cxXsgrkb、作息时间 xskbcx_cxRjc、首页校历 index_cxAreaFive（学期起止日期）
// 注意：教务页面引入的旧库改写了 Array.prototype.filter 等方法，脚本里只用 for 循环，不用 filter/map
const JW_HOST = 'jwxt.hebic.cn';
const JW_GRAB = `(async () => {
  const post = async (u, data) => {
    const r = await fetch(u, { method: 'POST', body: new URLSearchParams(data), headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (r.status === 901) throw new Error('登录已失效，请在教务系统窗口里重新登录');  // 正方会话过期的状态码
    if (!r.ok) throw new Error(u + ' HTTP ' + r.status);
    return r.text();
  };
  const now = new Date(), y = now.getFullYear(), mo = now.getMonth() + 1;
  const pick = id => { const s = document.getElementById(id); return s && s.value; };
  const xnm = pick('xnm') || String(mo >= 8 ? y : y - 1);
  const xqm = pick('xqm') || (mo >= 8 || mo <= 1 ? '3' : '12');
  const kbText = await post('/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151', { xnm, xqm, kzlx: 'ck', xsdm: '' });
  if (kbText.trim().startsWith('<')) throw new Error('登录已失效，请在教务系统窗口里重新登录');
  const kb = JSON.parse(kbText);
  let periods = [], term = null;
  const warn = [];
  try {
    const rows = JSON.parse(await post('/kbcx/xskbcx_cxRjc.html?gnmkdm=N2151', { xnm, xqm, xqh_id: '' }));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (+r.jcmc && r.qssj && r.jssj) periods.push({ n: +r.jcmc, s: r.qssj, e: r.jssj });
    }
  } catch (e) { warn.push('作息时间：' + e.message); }
  try {
    const m = (await post('/xtgl/index_cxAreaFive.html', {})).match(/\\((\\d{4}-\\d{2}-\\d{2})至(\\d{4}-\\d{2}-\\d{2})\\)/);
    if (m) term = { start: m[1], end: m[2] };
  } catch (e) { warn.push('学期日期：' + e.message); }
  const kbList = [], other = [], kl = kb.kbList || [], sl = kb.sjkList || [];
  for (let i = 0; i < kl.length; i++) {
    const k = kl[i];
    kbList.push({ kcmc: k.kcmc, xqj: k.xqj, jcs: k.jcs, zcd: k.zcd, cdmc: k.cdmc, xm: k.xm });
  }
  for (let i = 0; i < sl.length; i++) if (sl[i].sjkcgs || sl[i].qtkcgs) other.push(sl[i].sjkcgs || sl[i].qtkcgs);
  // 考试安排（本学期）、成绩（全部学期）：正方的分页查询接口，读失败不影响课表
  const query = extra => {
    const d = { _search: 'false', nd: String(Date.now()), 'queryModel.showCount': '500', 'queryModel.currentPage': '1', 'queryModel.sortName': '', 'queryModel.sortOrder': 'asc', time: '0' };
    for (const k in extra) d[k] = extra[k];
    return d;
  };
  let exams = null, grades = null;
  try {
    const it = JSON.parse(await post('/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105', query({ xnm, xqm, ksmcdmb_id: '', kch: '', kc: '', ksrq: '', kkbm_id: '' }))).items || [];
    exams = [];
    for (let i = 0; i < it.length; i++) { const x = it[i]; exams.push({ kcmc: x.kcmc, kssj: x.kssj, cdmc: x.cdmc, cdxqmc: x.cdxqmc, zwh: x.zwh, ksmc: x.ksmc }); }
  } catch (e) { warn.push('考试安排：' + e.message); }
  try {
    const it = JSON.parse(await post('/cjcx/cjcx_cxDgXscj.html?doType=query&gnmkdm=N305005', query({ xnm: '', xqm: '' }))).items || [];
    grades = [];
    for (let i = 0; i < it.length; i++) { const x = it[i]; grades.push({ kcmc: x.kcmc, cj: x.cj, jd: x.jd, xf: x.xf, xnmmc: x.xnmmc, xqmmc: x.xqmmc, kcxzmc: x.kcxzmc, ksxz: x.ksxz }); }
  } catch (e) { warn.push('成绩：' + e.message); }
  // 学生姓名：课表接口返回的 xsxx 里一般就有（XM）；没有就从教务首页右上角的个人信息里找
  let name = (kb.xsxx && (kb.xsxx.XM || kb.xsxx.xm)) || '';
  if (!name) {
    try {
      const t = await (await fetch('/xtgl/index_cxYhxxIndex.html?xt=jw&localeKey=zh_CN&gnmkdm=index', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
      const m = t.match(/media-heading[^>]*>\\s*([^<&\\s]+)/);
      if (m) name = m[1];
    } catch (e) { warn.push('姓名：' + e.message); }
  }
  return { xnm, xqm, periods, term, warn, kbList, other, exams, grades, name: String(name).trim() };
})()`;
ipcMain.handle('jw:grab', async () => {
  const frames = [];
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === mainWin || w.isDestroyed()) continue;
    for (const f of w.webContents.mainFrame.framesInSubtree) {
      try { if (new URL(f.url).host === JW_HOST) frames.push(f); } catch (e) {}
    }
  }
  if (!frames.length) return { ok: false, message: '还没有打开教务系统：请在弹出的窗口里登录门户，进入「教务系统」后再点抓取' };
  frames.sort((a, b) => /xskbcx/.test(b.url) - /xskbcx/.test(a.url));  // 优先用课表页面
  if (/login/i.test(frames[0].url)) return { ok: false, message: '教务系统还没登录：请在弹出的窗口里先登录，再点抓取' };
  try {
    return { ok: true, data: await frames[0].executeJavaScript(JW_GRAB) };
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0].replace(/^Error:\s*/, '');
    return { ok: false, message: /登录/.test(msg) ? msg : '读取课表失败：' + msg };
  }
});

// ========== 在软件里直接登录教务系统 ==========
// 学校的登录走统一身份认证（CAS，cas.hebic.cn）：教务系统自己的登录页用不了。
// 流程：隐藏窗口打开教务系统的单点登录入口 → 跳到 CAS 登录页 → 把用户填的学号/密码（需要时加验证码）
// 填进去、点 CAS 页面自己的登录按钮（密码由学校页面自己 RSA 加密）→ CAS 带票据跳回教务系统 → 读课表。
// 验证码由用户看图填写，软件不识别、不绕过。
const CAS_HOST = 'cas.hebic.cn';
// 教务系统的单点登录入口（正方常见的几个，按顺序试，哪个能进就用哪个）
const JW_SSO = ['jziotlogin', 'zfiotlogin', 'lyiotlogin', 'ktiotlogin', 'driotlogin', 'login'].map(p => `https://${JW_HOST}/sso/${p}`);
let loginWin = null;

const hostOf = u => { try { return new URL(u).host; } catch (e) { return ''; } };
const inJw = u => hostOf(u) === JW_HOST && !/login_slogin|\/sso\//.test(u);

// CAS 登录页的状态：是否需要验证码（由学校服务器决定，一般连续输错后才要）、验证码图片、错误提示
const CAS_STATE = `(async () => {
  let need = false;
  try { need = /true/.test(await (await fetch('v2/getKaptchaStatus')).text()); } catch (e) {}
  let img = '';
  const box = document.getElementById('kaptcha'), pic = document.getElementById('yzmPic');
  if (need && box && pic) {
    box.style.display = '';
    await new Promise(r => { pic.onload = r; pic.onerror = r; pic.src = 'kaptcha?time=' + Date.now(); });
    const c = document.createElement('canvas');
    c.width = pic.naturalWidth || 100; c.height = pic.naturalHeight || 36;
    c.getContext('2d').drawImage(pic, 0, 0);
    img = c.toDataURL('image/png');
  }
  const em = document.getElementById('errormsg');
  return { needCode: need, img, err: em ? em.innerText.trim() : '' };
})()`;

function closeLoginWin() {
  if (loginWin && !loginWin.isDestroyed()) loginWin.destroy();
  loginWin = null;
}
async function grabIn(wc) {
  try { return { ok: true, data: await wc.executeJavaScript(JW_GRAB) }; }
  catch (e) { return { ok: false, message: '读取课表失败：' + String(e.message || e).split('\n')[0].replace(/^Error:\s*/, '') }; }
}
// 等页面跳转全部结束（连续 0.8 秒没有在加载）
function waitSettled(wc, timeout = 20000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let quiet = Date.now();
    const iv = setInterval(() => {
      if (wc.isDestroyed()) { clearInterval(iv); return resolve(); }
      if (wc.isLoading()) quiet = Date.now();
      if (Date.now() - quiet > 800 || Date.now() - t0 > timeout) { clearInterval(iv); resolve(); }
    }, 100);
  });
}
// 依次试单点登录入口：进了教务系统返回 true；跳到 CAS 登录页（还没登录）就停在那里返回 false
async function enterJw(w) {
  for (const url of JW_SSO) {
    try { await w.loadURL(url); } catch (e) { /* 跳转中途的中断不算失败 */ }
    await waitSettled(w.webContents);
    const now = w.webContents.getURL();
    if (inJw(now)) return true;
    if (hostOf(now) === CAS_HOST) return false;
  }
  return false;
}

// 打开登录；如果之前的登录还有效，会直接进教务系统，这时直接抓取
ipcMain.handle('jw:loginStart', async () => {
  closeLoginWin();
  const w = loginWin = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { partition: JW_PARTITION, contextIsolation: true } });
  if (await enterJw(w)) {
    const r = await grabIn(w.webContents);
    closeLoginWin();
    return { ...r, loggedIn: true };
  }
  if (w.isDestroyed()) return { ok: false, message: '登录窗口已关闭' };
  if (hostOf(w.webContents.getURL()) !== CAS_HOST) {
    closeLoginWin();
    return { ok: false, message: '连不上学校的统一身份认证，请检查网络（可能需要连校园网）' };
  }
  return { ok: true, loggedIn: false, ...(await w.webContents.executeJavaScript(CAS_STATE)) };
});

ipcMain.handle('jw:captcha', async () => {
  if (!loginWin || loginWin.isDestroyed()) return { img: '' };
  return loginWin.webContents.executeJavaScript(CAS_STATE);
});

// 在 CAS 登录页填学号密码（需要时加验证码），点页面自己的登录按钮；返回页面有没有开始跳转
async function casSubmit(wc, { user, pass, code }) {
  const navStarted = new Promise(res => {
    const t = setTimeout(() => { wc.removeListener('did-start-navigation', h); res(false); }, 5000);
    const h = (_ev, url, isInPlace, isMainFrame) => { if (isInPlace || isMainFrame === false) return; clearTimeout(t); wc.removeListener('did-start-navigation', h); res(true); };
    wc.on('did-start-navigation', h);
  });
  // 学校页面出错时可能 alert()，隐藏窗口里改成写进错误提示，方便读出来
  await wc.executeJavaScript(`(() => {
    const em = document.getElementById('errormsg');
    window.alert = m => { if (em) em.innerText = m; };
    if (em) em.innerText = '';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('username', ${JSON.stringify(String(user))});
    set('ppassword', ${JSON.stringify(String(pass))});
    const code = ${JSON.stringify(String(code || ''))};
    if (code) { document.getElementById('kaptcha').style.display = ''; set('authcode', code); }
    document.getElementById('dl').click();
    return true;
  })()`);
  return navStarted;
}

ipcMain.handle('jw:loginSubmit', async (_e, { user, pass, code }) => {
  const w = loginWin;
  if (!w || w.isDestroyed()) return { ok: false, message: '登录页已关闭，请重新打开' };
  const wc = w.webContents;
  if (hostOf(wc.getURL()) !== CAS_HOST) return { ok: false, message: '登录页已过期，请关掉重新打开' };
  if (!(await casSubmit(wc, { user, pass, code }))) {
    const st = await wc.executeJavaScript(CAS_STATE);
    return { ok: false, message: st.err || '登录没有反应，请重试', ...st };
  }
  await waitSettled(wc);
  if (w.isDestroyed()) return { ok: false, message: '登录窗口已关闭' };
  if (hostOf(wc.getURL()) === CAS_HOST) {  // 还停在登录页：学号密码或验证码不对
    const st = await wc.executeJavaScript(CAS_STATE);
    return { ok: false, message: st.err || '登录失败：学号或密码不对', ...st };
  }
  if (!inJw(wc.getURL()) && !(await enterJw(w))) {
    closeLoginWin();
    return { ok: false, message: '已经登录成功，但没能进入教务系统。请改用「其他导入方式」' };
  }
  const r = await grabIn(wc);
  closeLoginWin();
  return r;
});
ipcMain.handle('jw:loginCancel', () => { closeLoginWin(); return true; });
// 退出登录：清掉教务系统/统一认证的登录状态和保存的学号密码（换人用、公共电脑用）
ipcMain.handle('jw:logout', async () => {
  closeLoginWin();
  for (const w of BrowserWindow.getAllWindows()) if (w !== mainWin && !w.isDestroyed()) w.destroy();
  await session.fromPartition(JW_PARTITION).clearStorageData();
  try { fs.rmSync(CRED_FILE(), { force: true }); } catch (e) {}
  return true;
});

// 记住学号和密码：用 Windows 自带的加密（DPAPI，经由 Electron safeStorage），只保存在本机
const CRED_FILE = () => path.join(app.getPath('userData'), 'jw-cred.json');
function credRead() {
  try {
    const c = JSON.parse(fs.readFileSync(CRED_FILE(), 'utf8'));
    const pass = c.pass && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(c.pass, 'base64')) : '';
    return { user: c.user || '', pass };
  } catch (e) { return { user: '', pass: '' }; }
}
ipcMain.handle('cred:get', () => credRead());
ipcMain.handle('cred:set', (_e, { user, pass, remember }) => {
  try {
    if (!remember) { fs.rmSync(CRED_FILE(), { force: true }); return true; }
    const enc = pass && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(pass).toString('base64') : '';
    fs.writeFileSync(CRED_FILE(), JSON.stringify({ user, pass: enc }));
    return true;
  } catch (e) { return false; }
});

// ========== 学校门户「我的日历」同步（多设备） ==========
// 门户（portal.hebic.cn）和教务系统用同一个统一身份认证。在隐藏窗口里打开门户的日历页，用页面自己的接口读写日程。
// 接口是从门户网页的代码里找的（不是公开接口，门户改版可能要跟着改）：
//   卡片参数 kpbj/get/showCardParam（里面的 scheduleApi 是查询接口，一般是 meeting/getMeetingListForPerson）
//   新增 meeting/addMeetingInfo、修改 meeting/updateMeetingInfo、删除 meeting/deleteMeetingInfo
//   POST 前先取 security/token 放进 XSRF-TOKEN；没登录时返回 error_code -4
const PORTAL_HOST = 'portal.hebic.cn';
const PORTAL_KPID = 'CE241818849A0D26E053871D470A8FAD';  // 门户「我的日历」卡片
const PORTAL_CAL = `https://${PORTAL_HOST}/calendar-detail?kpid=${PORTAL_KPID}`;
const PORTAL_LIB = `window.__hc = (() => {
  const jsdm = () => localStorage.getItem('jsdm') || '';
  const check = j => {
    if (!j || j.error_code === -4) throw new Error('LOGIN');
    if (j.error_code !== 0) throw new Error(j.message || '门户返回错误');
    return j.data;
  };
  const get = async (u, q) => check(await (await fetch(u + '?' + new URLSearchParams({ ...q, jsdm: jsdm(), _: Date.now() }))).json());
  const post = async (u, d) => {
    const tk = (await (await fetch('/api/security/token?_=' + Date.now())).json()).data || '';
    document.cookie = 'XSRF-TOKEN=' + tk + ';path=/;';
    const r = await fetch(u, { method: 'POST', body: new URLSearchParams({ ...d, jsdm: jsdm() }), headers: { 'X-XSRF-TOKEN': tk } });
    return check(await r.json());
  };
  const write = async (u, d) => {
    const r = (await post(u, d)) || {};
    if (r.code !== undefined && String(r.code) !== '0') throw new Error(r.message || r.msg || '门户没有保存成功');
    return r;
  };
  let api = '';
  const listApi = async () => {
    if (api) return api;
    try {
      let p = await post('/api/kpbj/get/showCardParam', { kpid: ${JSON.stringify(PORTAL_KPID)} });
      let cs = p && p.kpcs;
      if (typeof cs === 'string') cs = JSON.parse(cs);
      api = (cs && cs.scheduleApi) || '';
    } catch (e) { if (e.message === 'LOGIN') throw e; }
    return api || (api = '/api/meeting/getMeetingListForPerson');
  };
  return {
    list: async ({ from, to }) => { const d = await get(await listApi(), { startdate: from, enddate: to }); return Array.isArray(d) ? d : []; },
    add: f => write('/api/meeting/addMeetingInfo', f),
    update: f => write('/api/meeting/updateMeetingInfo', f),
    del: f => write('/api/meeting/deleteMeetingInfo', f)
  };
})(); true`;
let portalWin = null, portalIdle = null;
function closePortalWin() {
  clearTimeout(portalIdle);
  if (portalWin && !portalWin.isDestroyed()) portalWin.destroy();
  portalWin = null;
}
// 门户页面里能不能调接口：'ok' 已登录，'login' 没登录，'' 页面没打开（网络问题）
async function portalReady(wc) {
  if (hostOf(wc.getURL()) !== PORTAL_HOST) return '';
  try {
    await wc.executeJavaScript(PORTAL_LIB);
    await wc.executeJavaScript(`window.__hc.list({ from: '2000-01-01', to: '2000-01-01' })`);
    return 'ok';
  } catch (e) { return /LOGIN/.test(String(e.message || e)) ? 'login' : ''; }
}
// 准备好门户窗口：走一遍统一认证（之前登录过就直接带票据回到门户）；
// 还没登录就用记住的学号密码登录，要验证码或没记住密码就让用户先在软件里登录一次
ipcMain.handle('portal:begin', async () => {
  clearTimeout(portalIdle);
  if (portalWin && !portalWin.isDestroyed() && await portalReady(portalWin.webContents) === 'ok') return { ok: true };
  closePortalWin();
  const w = portalWin = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { partition: JW_PARTITION, contextIsolation: true } });
  const wc = w.webContents;
  // 门户页面偶尔有资源迟迟加载不完：最多等 25 秒，接口能不能用由下面 portalReady 判断
  const loaded = w.loadURL(`https://${CAS_HOST}/cas/login?service=${encodeURIComponent(PORTAL_CAL)}`).catch(() => { /* 跳转中途的中断不算失败 */ });
  await Promise.race([loaded, new Promise(r => setTimeout(r, 25000))]);
  await waitSettled(wc);
  if (w.isDestroyed()) return { ok: false, message: '同步窗口被关闭了' };
  if (hostOf(wc.getURL()) === CAS_HOST) {
    const c = credRead(), st = await wc.executeJavaScript(CAS_STATE);
    const needLogin = { ok: false, needLogin: true, message: '需要先登录：在课程表页点「导入课表」用学号登录一次（勾上记住密码，以后就能自动同步）' };
    if (!c.user || !c.pass || st.needCode) { closePortalWin(); return needLogin; }
    const moved = await casSubmit(wc, { ...c, code: '' });
    if (moved) await waitSettled(wc);
    if (w.isDestroyed()) return { ok: false, message: '同步窗口被关闭了' };
    if (hostOf(wc.getURL()) === CAS_HOST) { closePortalWin(); return needLogin; }
  }
  const r = await portalReady(wc);
  if (r === 'ok') return { ok: true };
  closePortalWin();
  return r === 'login'
    ? { ok: false, message: '登录了统一身份认证，但门户没有认这次登录，请稍后再试' }
    : { ok: false, message: '连不上学校门户，请检查网络（可能需要连校园网）' };
});
const PORTAL_OPS = ['list', 'add', 'update', 'del'];
ipcMain.handle('portal:call', async (_e, op, arg) => {
  if (!PORTAL_OPS.includes(op) || !portalWin || portalWin.isDestroyed()) return { ok: false, message: '同步中断了，请再试一次' };
  try {
    return { ok: true, data: await portalWin.webContents.executeJavaScript(`window.__hc.${op}(${JSON.stringify(arg || {})})`) };
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0].replace(/^Error:\s*/, '');
    return { ok: false, message: msg === 'LOGIN' ? '门户的登录过期了，请再同步一次' : msg };
  }
});
// 同步完窗口先留一分钟，接着再同步不用重新登录
ipcMain.handle('portal:end', () => { clearTimeout(portalIdle); portalIdle = setTimeout(closePortalWin, 60e3); return true; });

// ========== AI（OpenAI 兼容接口：智谱、硅基流动、DeepSeek 等） ==========
// API Key 用 Windows 自带加密（safeStorage）保存在本机，只在主进程里使用：
// 不进网页的 localStorage，导出的备份里也没有
const AI_FILE = () => path.join(app.getPath('userData'), 'ai.json');
// 软件内置的智谱免费 Key：用户不用设置就能用 AI。用户在设置里填了自己的 Key 就优先用自己的。
// 内置 Key 只发给智谱，选了别的服务必须填自己的 Key
const AI_BUILTIN = { base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash', key: 'a0ec296e4b20434b8ccc6a4a49166485.BDKzJidC0qeMMvSB' };
const isZhipu = base => /bigmodel\.cn/.test(base || '');
const ZHIPU_BACKUP = 'glm-4-flash-250414';  // 智谱另一个免费模型，主模型忙时自动换用
function aiRead() {
  let c = { base: '', model: '', key: '' };
  try {
    const j = JSON.parse(fs.readFileSync(AI_FILE(), 'utf8'));
    const key = j.key && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(j.key, 'base64')) : '';
    c = { base: j.base || '', model: j.model || '', key };
  } catch (e) {}
  if (!c.key && (!c.base || isZhipu(c.base))) c = { base: c.base || AI_BUILTIN.base, model: c.model || AI_BUILTIN.model, key: AI_BUILTIN.key };
  return c;
}
ipcMain.handle('ai:get', () => {
  const c = aiRead(), builtin = c.key === AI_BUILTIN.key;
  return { base: c.base, model: c.model, hasKey: !!c.key, builtin };
});
// key 不传表示保留原来的，传空字符串表示删除
ipcMain.handle('ai:set', (_e, { base, model, key }) => {
  try {
    const k = key === undefined ? aiRead().key : key;
    if (k && !safeStorage.isEncryptionAvailable()) return { ok: false, message: '这台电脑不支持加密保存 Key' };
    fs.writeFileSync(AI_FILE(), JSON.stringify({ base, model, key: k ? safeStorage.encryptString(k).toString('base64') : '' }));
    return { ok: true };
  } catch (e) { return { ok: false, message: '保存失败：' + e.message }; }
});

// 给用户看的提示：说人话，不出现状态码和服务器原文（原文打到控制台方便排查）
function aiErr(status, body, builtin) {
  console.warn('AI 请求失败', status, String(body).slice(0, 300));
  if (status === 429) return '云端服务器正在处理中，请稍后回来再试～';
  if (status === 401 || status === 403) return builtin ? 'AI 暂时用不了，请稍后再试' : '你填的 Key 好像不对，去「设置 → AI 功能」里看看';
  if (status === 404 || status === 400) return builtin ? 'AI 暂时用不了，请稍后再试' : 'AI 设置好像有点问题，去「设置 → AI 功能」里看看';
  return '云端服务器开小差了，请稍后再试';
}

// 流式请求：边生成边把新内容发给界面（ai:delta），结束后返回全文。同一时间只跑一个请求
let aiCtrl = null;
ipcMain.handle('ai:chat', async (e, { messages, id, override }) => {
  const c = aiRead();
  if (override) for (const k of ['base', 'model', 'key']) if (override[k]) c[k] = override[k];
  if (!c.key || (c.key === AI_BUILTIN.key && !isZhipu(c.base))) return { ok: false, message: '这个 AI 服务要填你自己的 Key 才能用' };
  if (!c.base || !c.model) return { ok: false, message: 'AI 设置还没填完整，去「设置 → AI 功能」里看看' };
  if (aiCtrl) return { ok: false, message: '上一个还在处理，请稍等一下' };
  const ctrl = aiCtrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  const url = c.base.replace(/\/+$/, '') + '/chat/completions';
  // 智谱的 GLM-4.5 以后默认会先"深度思考"，整理笔记用不着，关掉能快很多；不认这个参数就去掉重试
  const zhipu = /bigmodel\.cn/.test(c.base);
  let model = c.model;
  const send = noThink => fetch(url, {
    method: 'POST', signal: ctrl.signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.3, ...(noThink ? { thinking: { type: 'disabled' } } : {}) })
  });
  try {
    let noThink = zhipu, r = await send(noThink);
    if (r.status === 400 && noThink) r = await send(noThink = false);
    // 被拒（429）：智谱免费的 glm-4.7-flash 经常"访问量过大"（实测 2026-10 高峰时一半以上被拒），
    // 先换成同样免费、空闲得多的 glm-4-flash-250414，再不行就等一会儿自动重试
    for (let i = 1; r.status === 429 && i <= 5; i++) {
      if (zhipu && model !== ZHIPU_BACKUP) { model = ZHIPU_BACKUP; r = await send(noThink); continue; }
      if (id && !e.sender.isDestroyed()) e.sender.send('ai:delta', { id, waiting: i });
      await new Promise(res => setTimeout(res, 2000 * i));
      if (ctrl.signal.aborted) throw new Error('aborted');
      r = await send(noThink);
    }
    if (!r.ok) return { ok: false, message: aiErr(r.status, await r.text(), c.key === AI_BUILTIN.key) };
    const dec = new TextDecoder();
    let text = '', buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const ch = JSON.parse(data).choices;
          const d = ch && ch[0] && ch[0].delta && ch[0].delta.content;  // 只要正文，不要思考过程
          if (d) { text += d; if (id && !e.sender.isDestroyed()) e.sender.send('ai:delta', { id, delta: d }); }
        } catch (err) {}
      }
    }
    return { ok: true, text };
  } catch (err) {
    if (ctrl.signal.aborted) return { ok: false, message: ctrl.cancelled ? '已停止' : '云端服务器处理得太久了，请稍后回来再试' };
    console.warn('AI 连接失败', err);
    return { ok: false, message: '网络好像不太通，检查一下网络再试' };
  } finally {
    clearTimeout(timer);
    if (aiCtrl === ctrl) aiCtrl = null;
  }
});
ipcMain.handle('ai:cancel', () => { if (aiCtrl) { aiCtrl.cancelled = true; aiCtrl.abort(); } return true; });

// 本地语音识别：在独立子进程里跑（界面不卡），识别完子进程退出、内存释放
// 打包后模型在 resources/models，ffmpeg 在 app.asar.unpacked 里
const MODEL_DIR = app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, 'models');
const FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
let asrProc = null;

ipcMain.handle('asr:start', (e, file) => {
  if (asrProc) return { ok: false, message: '已经有一个识别任务在进行' };
  const wc = e.sender;
  const proc = asrProc = utilityProcess.fork(path.join(__dirname, 'asr-worker.js'), [], { serviceName: '语音识别' });
  let finished = false;
  proc.on('message', m => {
    if (!wc.isDestroyed()) wc.send('asr:event', m);
    if (m.type === 'done' || m.type === 'error') { finished = true; proc.kill(); }  // 结束子进程，释放模型内存
  });
  proc.on('exit', () => {
    if (asrProc === proc) asrProc = null;
    if (!finished && !proc.cancelled && !wc.isDestroyed()) wc.send('asr:event', { type: 'error', message: '识别进程意外退出' });
  });
  const threads = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
  proc.postMessage({ file, modelDir: MODEL_DIR, ffmpeg: FFMPEG, threads });
  return { ok: true };
});
ipcMain.handle('asr:cancel', () => {
  if (asrProc) { asrProc.cancelled = true; asrProc.kill(); asrProc = null; }
  return true;
});

// 安装时勾了"固定到任务栏"：安装程序会在程序目录留一个标记文件。
// Windows 10/11 不允许程序自己固定到任务栏，所以第一次打开时显示一个图示教用户点一下，显示后删掉标记
const PIN_FLAG = path.join(path.dirname(process.execPath), 'pin-taskbar.flag');
ipcMain.handle('app:pinGuide', () => {
  try { if (fs.existsSync(PIN_FLAG)) { fs.rmSync(PIN_FLAG, { force: true }); return true; } } catch (e) {}
  return false;
});

// 明确告诉 Windows 这是哪个程序，任务栏才会用自己的图标，不和 Electron 混在一起
app.setAppUserModelId('cn.student.campusassistant');
// 只开一个：再次打开（比如点开始菜单）时把已经在运行的那个调出来
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(() => { prefsLoad(); createMain(); createTray(); fixAutoStartPath(); if (prefs.pet) createPet(); showWidgets(); });
}
app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => { if (!prefs.tray) app.quit(); });
