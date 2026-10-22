/* 桌面小组件的画法：桌面上的小组件窗口（widget.html）和软件里「桌面小组件」页面的预览共用。
   WK.apply(元素, 数据, 配置, 软件主题) 把一个小组件画进元素里；数据是主窗口页面 snapshot() 给的那一份 */
(function () {
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const ACCENTS = { clay: ['#c6613f', '#e08a6b', '陶土'], ink: ['#3d5a80', '#8aa7c9', '墨蓝'], pine: ['#4f7a5a', '#8db592', '松绿'], plum: ['#86689f', '#b49bce', '藕紫'], rose: ['#c2566f', '#e48aa0', '海棠'], graphite: ['#4a4a48', '#d4d1c8', '石墨'] };
  const THEMES = [['auto', '跟随软件'], ['light', '浅色'], ['dark', '深色'], ['glass', '透明·浅'], ['glassdark', '透明·深']];
  const SIZES = [['s', '小', .86], ['m', '中', 1], ['l', '大', 1.2]];
  const MOD_NAME = { clock: '时间日期', next: '下一节课', today: '今天的安排', todo: '待办与截止', week: '本周一览', term: '学期进度', countdown: '倒计时' };
  const MODS = ['clock', 'next', 'today', 'todo', 'week', 'term', 'countdown'];
  // 每一种小组件：名字、一句话介绍、标准宽度
  const TYPES = {
    overview: { name: '今日概览', desc: '时间、下一节课、今天的安排和待办，一张卡全有', w: 288 },
    clock: { name: '时钟', desc: '大字时间，日期、农历和教学周', w: 272 },
    next: { name: '下一节课', desc: '正在上哪节、下一节还有多久', w: 288 },
    today: { name: '今天的安排', desc: '课程和日程按时间排好，过去的自动变淡', w: 296 },
    todo: { name: '待办清单', desc: '作业、考试、截止，可以直接勾掉', w: 296 },
    countdown: { name: '倒计时', desc: '离考试、四六级还有几天', w: 248 },
    week: { name: '本周课表', desc: '一周七天，每天有哪几节课', w: 440 },
    month: { name: '月历', desc: '这个月哪天有安排，用小圆点标出来', w: 296 },
    term: { name: '学期进度', desc: '第几周了、过了多少，一个圆环看清', w: 268 }
  };
  function defaults(type) {
    return { type, theme: 'auto', accent: 'clay', size: 'm', opacity: .94, top: false, locked: false, countdown: null,
      modules: MODS.map(id => ({ id, on: ['clock', 'next', 'today', 'todo', 'countdown'].includes(id) })) };
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const minsTo = hm => { const [h, m] = hm.split(':').map(Number), n = new Date(); return h * 60 + m - (n.getHours() * 60 + n.getMinutes()); };
  const dayDiff = ds => { const [y, m, d] = ds.split('-').map(Number), t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5); };
  const md = ds => { const [y, m, d] = ds.split('-').map(Number); return `${m}月${d}日 周${WD[new Date(y, m - 1, d).getDay()]}`; };
  const dur = m => m < 100 ? [m, '分钟'] : [Math.round(m / 6) / 10, '小时'];
  const hello = () => { const h = new Date().getHours(); return h < 5 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 22 ? '晚上好' : '夜深了'; };
  const countdownOf = (D, cfg) => (cfg.countdown && cfg.countdown.title && cfg.countdown.date) ? { ...cfg.countdown, own: true } : D.exam;

  /* ---------- 各个部分（今日概览由它们拼起来，单独的小组件也用） ---------- */
  const P = {
    clock(D) {
      const t = D.term;
      return `<div class="wk-c-top"><span>${esc(D.md)} · 星期${esc(D.wd)}</span>${t.inTerm ? `<span class="wk-pill">第 ${t.week} 周</span>` : ''}</div>
        <div class="wk-time" data-clock>${nowHM()}</div>
        <div class="wk-c-sub"><span>农历${esc(D.lunar)}</span><span>·</span><span>${hello()}${D.name ? '，' + esc(D.name) : ''}</span></div>`;
    },
    next(D) {
      const c = D.cur, n = D.next;
      if (c) {
        const left = minsTo(c.end), total = minsTo(c.end) - minsTo(c.start), [v, u] = dur(Math.max(0, left));
        return `<div class="wk-lab"><span>正在上课</span></div>
          <div class="wk-nx"><i class="wk-bar"></i><div class="wk-bd"><div class="wk-nx-t">${esc(c.title)}</div><div class="wk-nx-m">${esc(c.start)}–${esc(c.end)}${c.room ? ' · ' + esc(c.room) : ''}</div></div>
          <div class="wk-nx-r"><div class="wk-n">${v}</div><div class="wk-u">${u}后下课</div></div></div>
          <div class="wk-prog"><i style="width:${Math.min(100, Math.max(0, (1 - left / total) * 100)).toFixed(1)}%"></i></div>`;
      }
      if (n && n.isToday) {
        const [v, u] = dur(Math.max(0, minsTo(n.start)));
        return `<div class="wk-lab"><span>下一节</span></div>
          <div class="wk-nx"><i class="wk-bar"></i><div class="wk-bd"><div class="wk-nx-t">${esc(n.title)}</div><div class="wk-nx-m">${esc(n.start)}–${esc(n.end)}${n.room ? ' · ' + esc(n.room) : ''}</div></div>
          <div class="wk-nx-r"><div class="wk-n">${v}</div><div class="wk-u">${u}后</div></div></div>`;
      }
      if (n) return `<div class="wk-lab"><span>今天的课上完了</span></div>
          <div class="wk-nx"><i class="wk-bar" style="opacity:.4"></i><div class="wk-bd"><div class="wk-nx-t">${esc(n.title)}</div><div class="wk-nx-m">${esc(n.when)} ${esc(n.start)}${n.room ? ' · ' + esc(n.room) : ''}</div></div></div>`;
      return `<div class="wk-lab"><span>课程</span></div><div class="wk-empty">最近一周没有课${D.hasCourses ? '' : '（还没导入课表）'}</div>`;
    },
    today(D, max = 6) {
      const hm = nowHM(), list = D.items;
      if (!list.length) return `<div class="wk-lab"><span>今天</span></div><div class="wk-empty">今天没有安排，好好休息</div>`;
      const rows = list.slice(0, max).map(i => {
        const past = i.done || (i.end ? i.end <= hm : i.start && i.start < hm && i.kind === 'course');
        const now = !i.done && i.start && i.end && i.start <= hm && hm < i.end;
        return `<div class="wk-row${past && !now ? ' past' : ''}${now ? ' now' : ''}" data-open="${i.kind}:${esc(i.id)}"><span class="wk-tm">${esc(i.start || '全天')}</span><i class="wk-dot wk-c-${i.type}"></i><span class="wk-tt">${esc(i.title)}</span>${now ? '<span class="wk-tag">进行中</span>' : ''}</div>`;
      }).join('');
      return `<div class="wk-lab"><span>今天</span><b>${list.length} 项</b></div>${rows}${list.length > max ? `<div class="wk-more">还有 ${list.length - max} 项</div>` : ''}`;
    },
    todo(D, max = 5) {
      if (!D.tasks.length) return `<div class="wk-lab"><span>待办</span></div><div class="wk-empty">没有待办，轻松一下 ～</div>`;
      return `<div class="wk-lab"><span>待办</span><b>${D.tasks.length} 件</b></div>` + D.tasks.slice(0, max).map(t => {
        const n = dayDiff(t.date), hot = n <= 1;
        const due = n < 0 ? `过期 ${-n} 天` : n === 0 ? `今天${t.start ? ' ' + t.start : ''}` : n === 1 ? `明天${t.start ? ' ' + t.start : ''}` : n <= 7 ? `还剩 ${n} 天` : md(t.date).replace(/ .*/, '');
        return `<div class="wk-row"><span class="wk-ck" data-done="${esc(t.id)}" title="标记完成"></span><span class="wk-tt" data-open="event:${esc(t.id)}">${esc(t.title)}</span><span class="wk-due${hot ? ' hot' : ''}">${due}</span></div>`;
      }).join('');
    },
    week(D) {
      return `<div class="wk-lab"><span>本周</span>${D.term.inTerm ? `<b>第 ${D.term.week} 周</b>` : ''}</div><div class="wk-wk">` + D.week.map(d => {
        const dots = ['course', 'task', 'event'].filter(t => d.types.includes(t)).map(t => `<i class="wk-c-${t}"></i>`).join('');
        return `<div class="${d.isToday ? 'today' : d.date < D.today ? 'past' : ''}"><div class="wk-wk-d">${d.wd}</div><div class="wk-wk-n">${d.day}</div><div class="wk-wk-dots">${dots}</div></div>`;
      }).join('') + '</div>';
    },
    term(D) {
      const t = D.term;
      if (!t.inTerm) return `<div class="wk-lab"><span>学期</span></div><div class="wk-empty">${t.week < 1 ? `还有 ${1 - t.week} 周开学` : '这学期结束啦，假期愉快'}</div>`;
      const p = termPct(t);
      return `<div class="wk-lab"><span>学期进度</span><b>${p.toFixed(0)}%</b></div><div class="wk-tm-bar"><i style="width:${p.toFixed(1)}%"></i></div>
        <div class="wk-tm-txt"><span>第 <b>${t.week}</b> 周 / 共 ${t.total} 周</span><span>还剩 ${Math.max(0, t.total - t.week)} 周</span></div>`;
    },
    countdown(D, cfg) {
      const c = countdownOf(D, cfg);
      if (!c) return '';
      const n = dayDiff(c.date);
      if (n < 0 && c.own) return `<div class="wk-lab"><span>倒计时</span></div><div class="wk-empty">「${esc(c.title)}」已经过去了，换一个吧</div>`;
      return `<div class="wk-lab"><span>${c.own ? '倒计时' : '最近的考试'}</span></div><div class="wk-cd">
        <div class="wk-cd-n">${n === 0 ? '今天' : n}${n === 0 ? '' : '<small>天</small>'}</div>
        <div class="wk-cd-r"><div class="wk-cd-t">${esc(c.title)}</div><div class="wk-cd-d">${md(c.date)}</div></div></div>`;
    }
  };
  const termPct = t => Math.min(100, Math.max(0, ((t.week - 1) * 7 + t.dow) / (t.total * 7) * 100));

  /* ---------- 每一种小组件 ---------- */
  const R = {
    overview(D, cfg) {
      // 倒计时要配置（自己设的那一个），其他部分第二个参数是"最多几行"，用默认
      const html = cfg.modules.filter(m => m.on && P[m.id]).map(m => { const h = m.id === 'countdown' ? P.countdown(D, cfg) : P[m.id](D); return h ? `<section class="wk-mod">${h}</section>` : ''; }).join('');
      return html || '<div class="wk-empty" style="padding:8px 0">什么都没显示。到软件的「桌面小组件」页面里挑几样要显示的内容吧</div>';
    },
    clock(D) {
      const t = D.term;
      return `<div class="wk-clock"><div class="wk-time" data-clock>${nowHM()}</div><div class="wk-date">${esc(D.md)} · 星期${esc(D.wd)}</div>
        <div class="wk-chips"><span>农历${esc(D.lunar)}</span>${t.inTerm ? `<span class="on">第 ${t.week} 教学周</span>` : ''}<span>${hello()}</span></div></div>`;
    },
    next: D => `<div class="wk-next">${P.next(D)}</div>`,
    today: D => P.today(D, 8),
    todo: D => P.todo(D, 7),
    countdown(D, cfg) {
      const c = countdownOf(D, cfg);
      if (!c) return `<div class="wk-lab"><span>倒计时</span></div><div class="wk-empty">还没有考试。到软件的「桌面小组件」页面里设一个倒计时吧</div>`;
      const n = dayDiff(c.date);
      return `<div class="wk-lab"><span>${c.own ? '倒计时' : '最近的考试'}</span></div><div class="wk-count">
        <div class="wk-cd-n">${n < 0 ? '已过' : n === 0 ? '今天' : n}${n > 0 ? '<small>天</small>' : ''}</div>
        <div class="wk-cd-t">${esc(c.title)}</div><div class="wk-cd-d">${md(c.date)}</div></div>`;
    },
    week(D) {
      const cols = D.week.map(d => `<div class="${d.isToday ? 'today' : d.date < D.today ? 'past' : ''}"><div class="wk-wk-d">${d.wd}</div><div class="wk-wk-n">${d.day}</div>
        <div class="wk-wcol">${(d.items || []).slice(0, 4).map(i => `<span class="t-${i.type}" title="${esc(i.start + ' ' + i.title)}">${esc(i.title)}</span>`).join('')}${d.items && d.items.length > 4 ? `<small>+${d.items.length - 4}</small>` : ''}</div></div>`).join('');
      return `<div class="wk-lab"><span>本周课表</span>${D.term.inTerm ? `<b>第 ${D.term.week} 周</b>` : ''}</div><div class="wk-wk wk-week">${cols}</div>`;
    },
    month(D) {
      const m = D.month;
      const cells = ['一', '二', '三', '四', '五', '六', '日'].map(w => `<div class="h">${w}</div>`).join('') + m.days.map(d => {
        const dots = ['course', 'task', 'event'].filter(t => d.types.includes(t)).map(t => `<b class="wk-c-${t}"></b>`).join('');
        return `<div class="d${d.out ? ' out' : ''}${d.today ? ' today' : ''}"><span>${d.d}</span><i>${d.out ? '' : dots}</i></div>`;
      }).join('');
      return `<div class="wk-mt"><b>${esc(m.title)}</b>${D.term.inTerm ? `<span class="wk-pill">第 ${D.term.week} 周</span>` : ''}</div><div class="wk-mg">${cells}</div>`;
    },
    term(D) {
      const t = D.term;
      if (!t.inTerm) return P.term(D);
      const p = termPct(t), C = 2 * Math.PI * 46;
      return `<div class="wk-lab"><span>学期进度</span><b>${p.toFixed(0)}%</b></div><div class="wk-ring"><div class="wk-ring-w">
        <svg viewBox="0 0 108 108"><circle class="bg" cx="54" cy="54" r="46"/><circle class="fg" cx="54" cy="54" r="46" stroke-dasharray="${(C * p / 100).toFixed(1)} ${C.toFixed(1)}"/></svg>
        <div class="wk-ring-c"><b>${t.week}</b><small>/ ${t.total} 周</small></div></div>
        <div class="wk-ring-r">已过 <b>${p.toFixed(0)}%</b><br>还剩 <b>${Math.max(0, t.total - t.week)}</b> 周</div></div>`;
    }
  };

  function themeOf(cfg, appTheme) {
    if (cfg.theme && cfg.theme !== 'auto') return cfg.theme;
    if (appTheme === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return appTheme === 'dark' ? 'dark' : 'light';
  }
  // 画一个小组件；live = 桌面上那个能点的（预览里不能点）
  function apply(card, D, cfg, appTheme, live) {
    const t = themeOf(cfg, appTheme), dark = t === 'dark' || t === 'glassdark', a = ACCENTS[cfg.accent] || ACCENTS.clay, acc = dark ? a[1] : a[0];
    card.classList.add('wk');
    card.classList.toggle('wk-live', !!live);
    card.dataset.t = t;
    card.style.setProperty('--acc', acc);
    card.style.setProperty('--acc-soft', `color-mix(in srgb, ${acc} ${dark ? 22 : 13}%, transparent)`);
    card.style.setProperty('--a', (t.startsWith('glass') ? (dark ? .62 : .6) : 1) * (cfg.opacity || 1));
    card.style.width = (TYPES[cfg.type] || TYPES.overview).w + 'px';
    card.style.zoom = (SIZES.find(s => s[0] === cfg.size) || SIZES[1])[2];
    const r = R[cfg.type] || R.overview;
    card.innerHTML = D ? r(D, cfg) : '<div class="wk-empty" style="padding:16px 0">正在读取课表和日程…</div>';
  }
  window.WK = { TYPES, ACCENTS, THEMES, SIZES, MOD_NAME, MODS, defaults, apply, themeOf, nowHM };
})();
