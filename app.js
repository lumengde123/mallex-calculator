/* =========================================================
   MallEX 算力卡计算器 — 核心逻辑
   纯前端，无依赖。所有推算在浏览器内完成。
   ========================================================= */
(() => {
  'use strict';

  /* ---------------- 算力卡定义 ---------------- */
  // total = 到期本息总价（买入价 + 收益），每日产出 = total / 持有天数
  const CARDS = [
    { id: 'l1', name: '初级1算力卡', short: '初1', price: 5,     total: 6,     max: 8, act: 0.5  },
    { id: 'l2', name: '初级2算力卡', short: '初2', price: 10,    total: 12,    max: 4, act: 1    },
    { id: 'm1', name: '中级算力卡',   short: '中级', price: 100,   total: 123,   max: 4, act: 10   },
    { id: 'a1', name: '进阶算力卡',   short: '进阶', price: 500,   total: 630,   max: 3, act: 50   },
    { id: 'h1', name: '高级算力卡',   short: '高级', price: 1000,  total: 1290,  max: 2, act: 100  },
    { id: 'e1', name: '精英算力卡',   short: '精英', price: 2000,  total: 2640,  max: 1, act: 200  },
    { id: 's1', name: '超级算力卡',   short: '超级', price: 5000,  total: 6750,  max: 1, act: 500  },
    { id: 'x1', name: '专家算力卡',   short: '专家', price: 10000, total: 13800, max: 1, act: 1000 },
  ];
  const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

  // 两套周期规则
  const RULES = {
    old: { key: 'old', days: 35, label: '35 天' },
    new: { key: 'new', days: 40, label: '40 天' },
  };
  // 活跃度 > 100 触发新版规则
  const ACT_THRESHOLD = 100;

  const LS_KEY = 'mallex-calc-v1'; // 旧版单存档（仅用于迁移）
  const PROFILES_KEY = 'mallex-calc-profiles'; // 多存档

  /* ---------------- 工具函数 ---------------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2, 9);

  const pad2 = (n) => String(n).padStart(2, '0');
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function diffDays(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function weekday(dateStr) {
    return WEEKDAYS[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
  }
  function fmt(n, d = 2) {
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('zh-CN', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
  function fmtShort(n) {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return fmt(n, 2);
  }
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ---------------- 状态 ---------------- */
  function defaultStore() {
    const t = todayStr();
    return {
      balance: 0,
      startDate: t,
      horizon: 90,
      holdings: [],
      manual: [],
      auto: [],
      coins: [],
      rates: { mexUsd: 0, usdCny: 0 },
      view: 'all',
      skipPast: false,
    };
  }

  let store = null;
  let syncScrollFab = () => {};

  const HORIZONS = [35, 45, 90, 135, 365];
  const HORIZON_MIN = 7;
  const HORIZON_MAX = 1500;

  // 档位内取最近的一档；否则视为自定义天数（保留原值）
  function snapHorizon(n) {
    const v = Math.round(Number(n) || 0);
    if (!v) return 90;
    if (HORIZONS.includes(v)) return v;
    const nearest = HORIZONS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    // 落在两档之间且差距明显 → 当作自定义
    if (Math.abs(nearest - v) > 2) {
      return Math.min(HORIZON_MAX, Math.max(HORIZON_MIN, v));
    }
    return nearest;
  }

  function normalizeStore(s) {
    if (!s || typeof s !== 'object') return null;
    const d = defaultStore();
    return {
      balance: Number(s.balance) || 0,
      // 起算日可改：当天余额 = 表格第一行的余额，早于它且已到期的卡不参与推算
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(s.startDate)) ? s.startDate : d.startDate,
      horizon: snapHorizon(s.horizon),
      holdings: Array.isArray(s.holdings) ? s.holdings : [],
      manual: Array.isArray(s.manual) ? s.manual : [],
      auto: Array.isArray(s.auto) ? s.auto : [],
      coins: Array.isArray(s.coins) ? s.coins : [],
      rates: {
        mexUsd: Number(s.rates && s.rates.mexUsd) || 0,
        usdCny: Number(s.rates && s.rates.usdCny) || 0,
      },
      view: s.view === 'events' ? 'events' : 'all',
      skipPast: !!s.skipPast,
    };
  }

  function sampleStore() {
    const s = defaultStore();
    s.balance = 100;
    s.holdings = [{ id: uid(), cardId: 'l1', qty: 2, date: todayStr(), rule: 'auto' }];
    return s;
  }

  /* ---------------- 多存档（localStorage） ---------------- */
  let profiles = { activeId: '', list: [] };

  function readProfiles() {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || !Array.isArray(p.list)) return null;
      p.list = p.list
        .filter((x) => x && x.id)
        .map((x) => ({
          id: String(x.id),
          name: String(x.name || '未命名'),
          updatedAt: Number(x.updatedAt) || 0,
          data: x.data && typeof x.data === 'object' ? x.data : {},
        }));
      if (!p.list.length) return null;
      if (!p.list.some((x) => x.id === p.activeId)) p.activeId = p.list[0].id;
      return { activeId: String(p.activeId), list: p.list };
    } catch {
      return null;
    }
  }

  function writeProfiles() {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }

  function activeProfile() {
    return profiles.list.find((p) => p.id === profiles.activeId) || profiles.list[0];
  }

  // 返回 true 表示这是首次访问（需要填示例数据）
  function initProfiles() {
    const existing = readProfiles();
    if (existing) {
      profiles = existing;
      // 已有多存档：旧单存档键已无意义，顺手清掉
      localStorage.removeItem(LS_KEY);
      return false;
    }
    let legacy = null;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) legacy = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    const id = uid();
    const data = normalizeStore(legacy) || sampleStore();
    profiles = {
      activeId: id,
      list: [{ id, name: '我的账号', updatedAt: Date.now(), data }],
    };
    writeProfiles();
    // 迁移完成即丢弃旧键，避免之后误以为「还有一份旧数据」
    if (legacy) localStorage.removeItem(LS_KEY);
    return !legacy;
  }

  let firstRun = initProfiles();
  store = normalizeStore(activeProfile().data) || defaultStore();

  function save() {
    const p = activeProfile();
    if (!p) return;
    p.data = store;
    p.updatedAt = Date.now();
    writeProfiles();
    scheduleHistory();
  }

  /* ---------------- 撤销 / 重做 ---------------- */
  const HISTORY_MAX = 80;
  let history = [];
  let hIndex = -1;
  let hTimer = null;
  let hSuppress = false;

  function snapshot() {
    return JSON.stringify(store);
  }

  function pushHistory() {
    if (hSuppress) return;
    const s = snapshot();
    if (hIndex >= 0 && history[hIndex] === s) return;
    history = history.slice(0, hIndex + 1);
    history.push(s);
    if (history.length > HISTORY_MAX) history.shift();
    hIndex = history.length - 1;
    updateHistoryBtns();
  }

  // 连续输入时延后合并，避免每敲一个数字就占一格
  function scheduleHistory() {
    if (hSuppress) return;
    clearTimeout(hTimer);
    hTimer = setTimeout(pushHistory, 500);
  }

  function flushHistory() {
    clearTimeout(hTimer);
    pushHistory();
  }

  function updateHistoryBtns() {
    const u = $('#undoBtn');
    const r = $('#redoBtn');
    if (u) u.disabled = hIndex <= 0;
    if (r) r.disabled = hIndex >= history.length - 1;
  }

  function applyHistory() {
    hSuppress = true;
    store = normalizeStore(JSON.parse(history[hIndex])) || defaultStore();
    save();
    syncInputs();
    render();
    hSuppress = false;
    updateHistoryBtns();
  }

  function undo() {
    flushHistory();
    if (hIndex <= 0) return;
    hIndex -= 1;
    applyHistory();
    toast('已撤销上一步');
  }

  function redo() {
    if (hIndex >= history.length - 1) return;
    hIndex += 1;
    applyHistory();
    toast('已重做');
  }

  /* ---------------- 存档操作 ---------------- */
  function switchProfile(id) {
    if (id === profiles.activeId) return false;
    const target = profiles.list.find((p) => p.id === id);
    if (!target) return false;
    save();
    profiles.activeId = id;
    writeProfiles();
    store = normalizeStore(target.data) || defaultStore();
    afterProfileChange();
    toast(`已切换到「${target.name}」`);
    return true;
  }

  function createProfile(name) {
    save();
    const id = uid();
    const nm = (name || '').trim().slice(0, 20) || `账号 ${profiles.list.length + 1}`;
    profiles.list.push({ id, name: nm, updatedAt: Date.now(), data: defaultStore() });
    profiles.activeId = id;
    writeProfiles();
    store = defaultStore();
    afterProfileChange();
    toast(`已新建存档「${nm}」`);
    return id;
  }

  function deleteProfile(id) {
    if (profiles.list.length <= 1) {
      toast('至少保留一个存档');
      return false;
    }
    const idx = profiles.list.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    const name = profiles.list[idx].name;
    profiles.list.splice(idx, 1);
    if (profiles.activeId === id) {
      profiles.activeId = profiles.list[Math.max(0, idx - 1)].id;
      store = normalizeStore(activeProfile().data) || defaultStore();
    }
    writeProfiles();
    afterProfileChange();
    toast(`已删除「${name}」`);
    return true;
  }

  function renameProfile(id, name) {
    const p = profiles.list.find((x) => x.id === id);
    if (!p) return false;
    const nm = (name || '').trim().slice(0, 20);
    if (!nm) return false;
    p.name = nm;
    writeProfiles();
    renderProfiles();
    updateProfileBtn();
    return true;
  }

  /* ---------------- 存档导出 / 导入（纯文本） ---------------- */
  // 导出内容带上存档名，导入时沿用原名（重名再加 (1)(2)…）
  function encodeStore(name, obj) {
    const json = JSON.stringify({ v: 1, name: name || '我的账号', data: obj });
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'MEX1:' + btoa(bin);
  }

  function decodeStore(str) {
    const s = String(str || '').replace(/\s+/g, '');
    if (!s.startsWith('MEX1:')) throw new Error('bad prefix');
    const bin = atob(s.slice(5));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    // 兼容旧格式（纯 store）
    return obj && obj.data ? obj : { v: 1, name: '', data: obj };
  }

  // 重名时追加 (1)(2)…
  function uniqueProfileName(base) {
    const used = new Set(profiles.list.map((p) => p.name));
    const name = String(base || '导入账号').slice(0, 20) || '导入账号';
    if (!used.has(name)) return name;
    let i = 1;
    while (used.has(`${name} (${i})`.slice(0, 20))) i++;
    return `${name} (${i})`.slice(0, 20);
  }

  function importProfile(data, name) {
    const norm = normalizeStore(data);
    if (!norm) throw new Error('bad data');
    save();
    const id = uid();
    const finalName = uniqueProfileName(name);
    profiles.list.push({ id, name: finalName, updatedAt: Date.now(), data: norm });
    profiles.activeId = id;
    writeProfiles();
    store = norm;
    afterProfileChange();
    toast(`已导入为「${finalName}」`);
  }

  function afterProfileChange() {
    // 换了一份数据，撤销栈也随之重置
    history = [];
    hIndex = -1;
    syncInputs();
    render();
    renderProfiles();
    updateProfileBtn();
    pushHistory();
  }

  /* ---------------- 持仓解析（含规则判定） ---------------- */
  // 将 holdings 展平为单张卡实例，并按时间顺序判定 auto 规则
  function resolveBase(holdings) {
    const raw = [];
    for (const h of holdings) {
      const def = CARD_BY_ID[h.cardId];
      if (!def) continue;
      const qty = Math.max(1, Math.min(99, Number(h.qty) || 1));
      for (let i = 0; i < qty; i++) {
        raw.push({ hId: h.id, def, start: h.date, rule: h.rule || 'auto' });
      }
    }
    raw.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

    const out = [];
    for (const inst of raw) {
      if (inst.rule !== 'old' && inst.rule !== 'new') {
        // 购买时刻仍持有的卡活跃度之和
        let act = 0;
        for (const r of out) {
          const end = addDays(r.start, r.days);
          if (r.start < inst.start && end >= inst.start) act += r.def.act;
        }
        inst.rule = act > ACT_THRESHOLD ? 'new' : 'old';
      }
      inst.days = RULES[inst.rule].days;
      inst.daily = inst.def.total / inst.days;
      out.push(inst);
    }
    return out;
  }

  /* ---------------- M 币（= MEX）交易换算 ---------------- */
  // M 币就是 MEX 的简称：数量即 MEX 数量，两个汇率只用于折算人民币。
  function coinCalc(c) {
    const amount = Number(c.amount) || 0;
    const mexUsd = Number(c.mexUsd) || Number(store.rates.mexUsd) || 0;
    const usdCny = Number(c.usdCny) || Number(store.rates.usdCny) || 0;
    const usdTotal = amount * mexUsd;
    const cnyTotal = usdTotal * usdCny;
    const mexTotal = amount;
    return { amount, mexUsd, usdCny, usdTotal, cnyTotal, mexTotal };
  }

  function coinAmountText(n) {
    return fmt(n, Math.abs(n % 1) < 1e-9 ? 0 : 2);
  }

  // 汇率显示：去掉多余的 0，最多 4 位有效数字
  function fmtRate(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    return String(Number(v.toPrecision(4)));
  }

  function coinText(c, info) {
    const side = c.side === 'sell' ? '卖出 MEX' : '买入 MEX';
    const base = `${side} ${coinAmountText(info.amount)}`;
    // 设定了汇率就把汇率一起写进徽章：@0.05 表示 1 MEX = 0.05 美元
    const rate = info.cnyTotal > 0 && info.mexUsd > 0 ? ` @${fmtRate(info.mexUsd)}` : '';
    return info.cnyTotal > 0 ? `${base}${rate} ≈ ¥${fmt(info.cnyTotal, 2)}` : base;
  }

  function coinTitle(c, info) {
    const parts = [`${coinAmountText(info.amount)} MEX`];
    if (info.mexUsd > 0) parts.push(`1 MEX = $${fmtRate(info.mexUsd)}`);
    if (info.usdCny > 0) parts.push(`$1 = ¥${fmtRate(info.usdCny)}`);
    if (info.cnyTotal > 0) parts.push(`≈ ¥${fmt(info.cnyTotal, 2)}`);
    return parts.join(' · ');
  }

  /* ---------------- 推算引擎 ---------------- */
  function simulate() {
    const endDate = addDays(store.startDate, Math.max(1, store.horizon) - 1);
    let balance = Number(store.balance) || 0;

    const initial = resolveBase(store.holdings);

    // 起算日（今天）时已到期的历史卡不再参与推算：余额已包含其最终结果
    const instances = initial
      .map((i) => ({
        def: i.def,
        start: i.start,
        rule: i.rule,
        days: i.days,
        daily: i.daily,
        tag: 'holding',
      }))
      .filter((i) => diffDays(i.start, store.startDate) < i.days);

    // 起始日仍在产出的卡 → 当前日产出 & 活跃度
    let startDaily = 0;
    let startActivity = 0;
    for (const inst of instances) {
      const age = diffDays(inst.start, store.startDate);
      if (age >= 0 && age < inst.days) {
        startActivity += inst.def.act;
        startDaily += inst.daily;
      }
    }

    // 手动购买按日期分组
    const manualMap = new Map();
    for (const m of store.manual) {
      if (!m.date || !CARD_BY_ID[m.cardId]) continue;
      if (!manualMap.has(m.date)) manualMap.set(m.date, []);
      manualMap.get(m.date).push(m);
    }

    // 条件自动规则
    const autoRules = store.auto
      .filter((r) => CARD_BY_ID[r.cardId])
      .map((r) => ({
        cardId: r.cardId,
        maxQty: Math.max(1, Number(r.maxQty) || 1),
        from: r.from || store.startDate,
        to: r.to || endDate,
        used: 0,
      }));

    // 起始日不早于起算日的持有卡 → 在起始日当天从余额扣款
    // （更早的卡视为「当时已付款、余额已反映」，不再扣）
    const holdBuyMap = new Map();
    for (const h of store.holdings) {
      const def = CARD_BY_ID[h.cardId];
      if (!def || !h.date) continue;
      if (diffDays(h.date, store.startDate) > 0) continue;
      const q = Math.max(1, Math.min(99, Number(h.qty) || 1));
      if (!holdBuyMap.has(h.date)) holdBuyMap.set(h.date, []);
      holdBuyMap.get(h.date).push({ def, qty: q });
    }

    // M 币交易按日期分组
    const coinMap = new Map();
    for (const c of store.coins || []) {
      if (!c.date) continue;
      if (!coinMap.has(c.date)) coinMap.set(c.date, []);
      coinMap.get(c.date).push(c);
    }

    const rows = [];
    const summary = { produced: 0, spent: 0, bought: 0, expired: 0, coinIn: 0, coinOut: 0 };
    let cur = store.startDate;
    let guard = 0;

    while (cur <= endDate && guard++ < 1500) {
      const events = [];
      let produced = 0;

      // 1) 每日产出 + 到期结算
      const survivors = [];
      // 今天到期（age === days）的卡：产出已停，但额度要到次日零点才释放
      const expiringToday = {};
      // 同一天到期的同种卡合并成一条：到期 初1 ×3（40天）
      const expireMap = new Map();
      for (const inst of instances) {
        const age = diffDays(inst.start, cur);
        if (age >= 1 && age <= inst.days) produced += inst.daily;
        if (age >= inst.days) {
          summary.expired++;
          if (age === inst.days) {
            expiringToday[inst.def.id] = (expiringToday[inst.def.id] || 0) + 1;
          }
          const key = `${inst.def.id}|${inst.rule}`;
          const e = expireMap.get(key) || { short: inst.def.short, rule: inst.rule, n: 0 };
          e.n += 1;
          expireMap.set(key, e);
        } else {
          survivors.push(inst);
        }
      }
      for (const e of expireMap.values()) {
        events.push({
          type: 'expire',
          text: `到期 ${e.short}${e.n > 1 ? ` ×${e.n}` : ''}（${e.rule === 'new' ? '40天' : '35天'}）`,
        });
      }
      instances.length = 0;
      instances.push(...survivors);

      // 起算日（今天）的产出已经体现在输入的余额里，不再累加一次；
      // 从明天起每日产出才计入余额。
      const isStartDay = cur === store.startDate;
      if (produced > 0 && !isStartDay) {
        balance += produced;
        summary.produced += produced;
      }

      // 活跃度（购买前）
      const activityNow = () => instances.reduce((s, i) => s + i.def.act, 0);

      // 当前持有数（额度是「同时持有上限」：到期当天仍占用，次日零点才释放）
      const heldCount = (id) =>
        instances.reduce((s, i) => s + (i.def.id === id && diffDays(i.start, cur) >= 0 ? 1 : 0), 0) +
        (expiringToday[id] || 0);

      // 1.5) M 币买入（充入）：先到账，当天才能拿来买卡
      for (const c of coinMap.get(cur) || []) {
        if (c.side === 'sell') continue;
        const info = coinCalc(c);
        balance += info.mexTotal;
        summary.coinIn += info.mexTotal;
        events.push({
          type: 'coinbuy',
          text: coinText(c, info),
          title: coinTitle(c, info),
          coinId: c.id,
        });
      }

      // 2) 当日买入的算力卡（起始日不早于起算日）扣款
      for (const b of holdBuyMap.get(cur) || []) {
        const cost = b.def.price * b.qty;
        balance -= cost;
        summary.spent += cost;
        events.push({ type: 'buy', text: `买入 ${b.def.short} ×${b.qty} · ${fmt(cost, 2)} MEX` });
        if (balance < 0) events.push({ type: 'warn', text: `余额不足，差 ${fmt(-balance, 2)} MEX` });
      }

      // 3) 手动购买
      const list = manualMap.get(cur) || [];
      for (const m of list) {
        const def = CARD_BY_ID[m.cardId];
        const want = Math.max(1, Math.min(99, Number(m.qty) || 1));
        const left = Math.max(0, def.max - heldCount(def.id));
        const afford = Math.floor(balance / def.price + 1e-9);
        const n = Math.min(want, left, afford);
        if (n > 0) {
          const rule = activityNow() > ACT_THRESHOLD ? 'new' : 'old';
          const days = RULES[rule].days;
          const daily = def.total / days;
          for (let i = 0; i < n; i++) {
            instances.push({ def, start: cur, rule, days, daily, tag: 'bought' });
          }
          const cost = n * def.price;
          balance -= cost;
          summary.spent += cost;
          summary.bought += n;
          events.push({
            type: 'buy',
            text: `买入 ${def.short} ×${n} · ${fmt(cost, 2)} MEX`,
            manualId: m.id,
            cardId: def.id,
          });
          if (n < want) {
            events.push({
              type: 'warn',
              text: `仅买入 ${n}/${want} 张（余额或额度不足）`,
            });
          }
        } else {
          events.push({
            type: 'warn',
            text: `${def.short} ×${want} 未成交（余额不足 / 额度用尽）`,
          });
        }
      }

      // 4) 条件自动购买（每天最多 1 张）
      for (const r of autoRules) {
        if (cur < r.from || cur > r.to) continue;
        if (r.used >= r.maxQty) continue;
        const def = CARD_BY_ID[r.cardId];
        const left = Math.max(0, def.max - heldCount(def.id));
        if (left <= 0 || balance < def.price) continue;

        const rule = activityNow() > ACT_THRESHOLD ? 'new' : 'old';
        const days = RULES[rule].days;
        const daily = def.total / days;
        instances.push({ def, start: cur, rule, days, daily, tag: 'auto' });
        balance -= def.price;
        r.used += 1;
        summary.spent += def.price;
        summary.bought += 1;
        events.push({
          type: 'buy',
          text: `条件买入 ${def.short} ×1 · ${fmt(def.price, 2)} MEX`,
        });
      }

      // 5) M 币卖出（提出）：买卡之后再结算
      for (const c of coinMap.get(cur) || []) {
        if (c.side !== 'sell') continue;
        const info = coinCalc(c);
        balance -= info.mexTotal;
        summary.coinOut += info.mexTotal;
        events.push({
          type: 'coinsell',
          text: coinText(c, info),
          title: coinTitle(c, info),
          coinId: c.id,
        });
      }

      // 6) 记录当日行
      const quota = CARDS.map((def) => {
        const leftQ = Math.max(0, def.max - heldCount(def.id));
        return { def, left: leftQ, afford: balance >= def.price };
      });

      // 当天仍持有的卡（按卡种聚合：数量 + 每张各自剩余的天数）
      const holdMap = new Map();
      for (const inst of instances) {
        const age = diffDays(inst.start, cur);
        if (age < 0) continue; // 还没到起始日，尚未买入
        const leftDays = inst.days - age;
        if (leftDays <= 0) continue;
        const key = inst.def.id;
        const e = holdMap.get(key) || { def: inst.def, qty: 0, lefts: [], daily: 0 };
        e.qty += 1;
        e.daily += inst.daily;
        e.lefts.push(leftDays);
        holdMap.set(key, e);
      }
      for (const e of holdMap.values()) e.lefts.sort((a, b) => a - b);
      const hold = CARDS.filter((d) => holdMap.has(d.id))
        .sort((a, b) => b.price - a.price) // 等级高的排前面
        .map((d) => holdMap.get(d.id));
      const activity = instances
        .filter((i) => diffDays(i.start, cur) >= 0)
        .reduce((s, i) => s + i.def.act, 0);

      rows.push({
        date: cur,
        weekday: weekday(cur),
        produced,
        balance,
        events,
        quota,
        hold,
        activity,
        isToday: cur === todayStr(),
      });

      cur = addDays(cur, 1);
    }

    // 期末状态
    const endActivity = instances.reduce((s, i) => s + i.def.act, 0);
    const endDaily = instances.reduce((s, i) => s + i.daily, 0);

    window.__dbg = { rows, initial, curNow: store.startDate };

    return {
      rows,
      summary: {
        ...summary,
        endBalance: balance,
        endHolding: instances.length,
        endActivity,
        endDaily,
        startDaily,
        startActivity,
        startHolding: initial.filter((i) => {
          const age = diffDays(i.start, store.startDate);
          return age >= 0 && age < i.days;
        }).length,
      },
      initial,
    };
  }

  /* ---------------- 渲染：概览 ---------------- */
  function renderStats(sim) {
    const s = sim.summary;
    // 概览与表格首行保持一致：起算日的产出不重复累加，但当天的买卖 / 扣款要反映出来
    const curBalance = sim.rows && sim.rows.length ? sim.rows[0].balance : Number(store.balance) || 0;
    const ruleLabel = s.startActivity > ACT_THRESHOLD ? '40 天（新版）' : '35 天（旧版）';
    const items = [
      { label: '当前余额', value: fmt(curBalance, 2), unit: 'MEX', inline: true, cls: 'deep' },
      { label: '当前日产出', value: fmt(s.startDaily, 4), unit: 'MEX/天', inline: true, cls: 'cyan' },
      { label: '持有算力卡', value: String(s.startHolding), unit: '张', inline: true, cls: 'blue' },
      { label: '当前活跃度', value: fmt(s.startActivity, 2), unit: ruleLabel, inline: false, cls: s.startActivity > ACT_THRESHOLD ? 'violet' : 'blue' },
    ];
    $('#stats').innerHTML = items
      .map(
        (it) => `
        <div class="stat">
          <span class="stat-label">${it.label}</span>
          <strong class="stat-value ${it.cls}">${it.value}${it.inline ? `<em class="stat-unit">${it.unit}</em>` : ''}</strong>
          ${it.inline ? '' : `<span class="stat-sub">${it.unit}</span>`}
        </div>`
      )
      .join('');
  }

  /* ---------------- 渲染：我的算力卡 ---------------- */
  function renderHoldings() {
    const box = $('#holdList');
    const totalCards = store.holdings.reduce((s, h) => s + Math.max(1, Number(h.qty) || 1), 0);
    $('#holdPill').textContent = `${totalCards} 张`;

    if (!store.holdings.length) {
      box.innerHTML = `<div class="empty-tip">还没有添加算力卡。填写下方表单，记录你目前持有的卡与各自起始日期。</div>`;
      return;
    }

    const resolved = resolveBase(store.holdings);
    const byHolding = new Map();
    for (const inst of resolved) {
      if (!byHolding.has(inst.hId)) byHolding.set(inst.hId, []);
      byHolding.get(inst.hId).push(inst);
    }

    box.innerHTML = store.holdings
      .map((h) => {
        const def = CARD_BY_ID[h.cardId];
        if (!def) return '';
        const insts = byHolding.get(h.id) || [];
        const sample = insts[0];
        const rule = sample ? sample.rule : 'old';
        const days = sample ? sample.days : RULES.old.days;
        const endDate = addDays(h.date, days);
        const dailyEach = def.total / days;
        const remain = Math.max(0, diffDays(store.startDate, endDate));
        const finished = diffDays(h.date, store.startDate) >= days;
        const willCharge = diffDays(h.date, store.startDate) <= 0;
        const charge = willCharge ? def.price * Math.max(1, Number(h.qty) || 1) : 0;
        return `
          <div class="row-item">
            <span class="dot" style="${finished ? 'background:var(--muted-2);box-shadow:none' : ''}"></span>
            <div class="row-main">
              <div class="row-title">
                ${esc(def.name)}
                <span class="tag qty">×${insts.length || h.qty}</span>
                <span class="tag ${rule}">${RULES[rule].label}</span>
                ${finished ? '<span class="tag" style="color:var(--muted-2);border:1px solid var(--line)">已到期</span>' : ''}
              </div>
              <div class="row-meta">
                ${h.date} 起 · ${endDate} 到期 · ${fmt(dailyEach, 4)} MEX/天${finished ? '' : ` · 剩余 ${remain} 天`}${charge > 0 ? ` · 买入扣 ${fmt(charge, 2)} MEX` : ''}
              </div>
            </div>
            <button class="x-btn" type="button" data-del-hold="${h.id}" aria-label="删除">✕</button>
          </div>`;
      })
      .join('');
  }

  /* ---------------- 渲染：今日持有（只读） ---------------- */
  const HUES = (m) => (m >= 15 ? '#16a34a' : m >= 8 ? '#65a30d' : m >= 4 ? '#ca8a04' : m >= 2 ? '#ea580c' : '#dc2626');

  function renderToday(sim) {
    const box = $('#todayList');
    const pill = $('#todayPill');
    if (!box || !pill) return;
    const row = sim.rows.find((r) => r.isToday) || null;
    const holds = row ? row.hold : [];
    const qty = holds.reduce((s, h) => s + h.qty, 0);
    pill.textContent = `${qty} 张`;

    if (!holds.length) {
      box.innerHTML = `<div class="empty-tip">今天没有持有中的算力卡。</div>`;
      return;
    }

    let dailyTotal = 0;
    const items = holds.map((h) => {
      dailyTotal += h.daily;
      const min = h.lefts[0];
      const shown = h.lefts.length > 4 ? `${h.lefts.slice(0, 3).join('/')}…` : h.lefts.join('/');
      return `
        <div class="today-item">
          <span class="ti-dot" style="--hc:${HUES(min)}"></span>
          <div class="ti-main">
            <div class="ti-name">${esc(h.def.name)}<em>×${h.qty}</em></div>
            <div class="ti-meta">剩余 ${shown} 天 · ${fmtRate(h.def.act)} 活跃度 / 张</div>
          </div>
          <div class="ti-out">${fmt(h.daily, 4)}<span>MEX/天</span></div>
        </div>`;
    });

    box.innerHTML =
      items.join('') +
      `<div class="today-total"><span>今日总算力产出</span><b>${fmt(dailyTotal, 4)} MEX/天</b></div>`;
  }

  /* ---------------- 渲染：购买计划列表 ---------------- */
  // 列表默认只露出 3 条的高度，更长的部分在区域内滚动
  const LIST_ROWS = 3;

  function renderList(box, innerHtml, fallbackH) {
    box.innerHTML = `<div class="list-body">${innerHtml}</div>`;
    const body = box.querySelector('.list-body');
    if (!body) return;
    const kids = Array.from(body.children);
    if (kids.length <= LIST_ROWS) return;
    body.classList.add('scroll');
    const first = kids[0];
    const last = kids[LIST_ROWS - 1];
    const h = last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
    // 卡片可能处于隐藏的 tab 里，量不到高度时交给 CSS 的默认值
    if (h >= 40) body.style.maxHeight = `${Math.round(h)}px`;
  }

  function renderManual() {
    const box = $('#buyList');
    if (!store.manual.length) {
      box.innerHTML = `<div class="empty-tip">暂无手动购买事件。可指定「某日买入某卡 ×N」。</div>`;
      return;
    }
    const sorted = [...store.manual].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const html = sorted
      .map((m) => {
        const def = CARD_BY_ID[m.cardId];
        if (!def) return '';
        return `
          <div class="row-item" data-edit-manual="${m.id}">
            <span class="dot" style="background:var(--indigo);box-shadow:0 0 0 3px rgba(79,70,229,.16)"></span>
            <div class="row-main">
              <div class="row-title">${esc(def.name)} <span class="tag qty">×${m.qty}</span></div>
              <div class="row-meta">${m.date} · 支出 ${fmt(def.price * m.qty, 2)} MEX · 到期回本 ${fmt(def.total * m.qty, 2)} MEX</div>
            </div>
            <button class="x-btn" type="button" data-del-manual="${m.id}" aria-label="删除">✕</button>
          </div>`;
      })
      .join('');
    renderList(box, html, 210);
  }

  function renderAuto() {
    const box = $('#autoList');
    if (!store.auto.length) {
      box.innerHTML = `<div class="empty-tip">暂无自动规则。可设定「余额够就买」，让后续推算自动执行。</div>`;
      return;
    }
    const html = store.auto
      .map((r, i) => {
        const def = CARD_BY_ID[r.cardId];
        if (!def) return '';
        const first = i === 0;
        const last = i === store.auto.length - 1;
        return `
          <div class="row-item">
            <span class="prio">${i + 1}</span>
            <div class="row-main">
              <div class="row-title">余额 ≥ ${fmt(def.price, 0)} 买入 ${esc(def.name)} <span class="tag qty">上限 ×${r.maxQty}</span></div>
              <div class="row-meta">${r.from || store.startDate} ~ ${r.to || addDays(store.startDate, store.horizon - 1)} · 每天 1 张${first ? ' · 优先扣款' : ''}</div>
            </div>
            <button class="ord-btn" type="button" data-auto-up="${r.id}" aria-label="提高优先级"${first ? ' disabled' : ''}>↑</button>
            <button class="ord-btn" type="button" data-auto-down="${r.id}" aria-label="降低优先级"${last ? ' disabled' : ''}>↓</button>
            <button class="x-btn" type="button" data-del-auto="${r.id}" aria-label="删除">✕</button>
          </div>`;
      })
      .join('');
    renderList(box, html, 210);
  }

  /* ---------------- 渲染：M 币交易 ---------------- */
  function renderCoins() {
    const box = $('#coinList');
    const list = [...(store.coins || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    $('#coinPill').textContent = `${list.length} 笔`;
    if (!list.length) {
      box.innerHTML = `<div class="empty-tip">暂无 M 币交易，在下面添加一笔。</div>`;
      return;
    }
    const html = list
      .map((c) => {
        const info = coinCalc(c);
        const isBuy = c.side !== 'sell';
        const color = isBuy ? 'var(--violet)' : 'var(--green)';
        const glow = isBuy ? 'rgba(115,87,230,.16)' : 'rgba(18,185,129,.16)';
        const delta = `${isBuy ? '+' : '−'}${fmt(info.mexTotal, 2)} MEX`;
        return `
          <div class="row-item" data-edit-coin="${c.id}">
            <span class="dot" style="background:${color};box-shadow:0 0 0 3px ${glow}"></span>
            <div class="row-main">
              <div class="row-title">${isBuy ? '买入' : '卖出'} MEX <span class="tag qty">×${coinAmountText(info.amount)}</span></div>
              <div class="row-meta">${c.date} · ${esc(coinTitle(c, info))} · ${delta}</div>
            </div>
            <button class="x-btn" type="button" data-del-coin="${c.id}" aria-label="删除">✕</button>
          </div>`;
      })
      .join('');
    renderList(box, html, 210);
  }

  /* ---------------- 渲染：额度条 ---------------- */
  function renderQuota(sim) {
    // 顶部额度条以「今天」为准
    const first = sim.rows[0];
    const quota = first ? first.quota : CARDS.map((def) => ({ def, left: def.max, afford: false }));
    $('#quotaStrip').innerHTML = quota
      .map((q) => {
        const cls = q.left <= 0 ? 'none' : q.afford ? 'has' : '';
        return `<div class="quota-chip ${cls}" title="${esc(q.def.name)} 剩余额度 ${q.left} 张">
          <span class="q-name">${esc(q.def.short)}</span>
          <span class="q-val">${q.left}<small style="font-size:10px;color:inherit;opacity:.7">/${q.def.max}</small></span>
        </div>`;
      })
      .join('');
  }

  /* ---------------- 渲染：每日表格 ---------------- */
  // 不分页：整个区间一次性展示（分页会打断连续看趋势）
  function renderPager() {
    const box = $('#pager');
    box.innerHTML = '';
    box.hidden = true;
  }

  function renderTable(sim) {
    const body = $('#dayBody');
    let base = store.view === 'events' ? sim.rows.filter((r) => r.events.length > 0) : sim.rows;

    // 「省略过去数据」：从今天那行开始显示，历史行不再列出（余额仍在后台算好）
    if (store.skipPast) {
      const todayRow = sim.rows.find((r) => r.isToday);
      if (todayRow) base = base.filter((r) => r.date >= todayRow.date);
    }

    const allRows = base;

    if (!allRows.length) {
      body.innerHTML = `<p style="text-align:center;color:var(--muted-2);padding:22px">所选区间内没有可显示的行</p>`;
      renderPager();
      return;
    }

    const rows = allRows;
    renderPager();

    body.innerHTML = rows
      .map((r) => {
        const evHtml = r.events.length
          ? `<div class="ev-list">${r.events
              .map((e) => {
                const attrs = e.manualId
                  ? ` data-undo-manual="${esc(e.manualId)}" role="button" tabindex="0" title="点击撤销 1 张"`
                  : e.title
                    ? ` title="${esc(e.title)}"`
                    : '';
                return `<span class="ev ${e.type}${e.manualId ? ' undoable' : ''}"${attrs}>${esc(e.text)}</span>`;
              })
              .join('')}</div>`
          : '';

        const q = r.quota
          .filter((x) => x.left > 0 && x.afford)
          .map(
            (x) =>
              `<button type="button" class="qb" data-buy-date="${r.date}" data-buy-card="${x.def.id}" title="在 ${r.date} 买入 ${esc(x.def.name)} ×1">${esc(x.def.short)}×${x.left}</button>`
          )
          .join('');
        const qCell = q ? `<div class="quota-cell"><span class="qc-label">可买</span>${q}</div>` : '';

        // 当天持仓：卡种 × 数量 + 最早剩余天数（剩余越少，徽章越醒目）
        const holdHtml = r.hold.length
          ? `<div class="hold-line">${r.hold
              .map((h) => {
                const min = h.lefts[0];
                // 剩余天数越多越绿，越少越红
                const hue = min >= 15 ? '#16a34a' : min >= 8 ? '#65a30d' : min >= 4 ? '#ca8a04' : min >= 2 ? '#ea580c' : '#dc2626';
                const hint = min <= 3 ? ' · 即将到期' : '';
                // 同卡种多张时把各自剩余天数都列出来：15/19/26天
                const shown = h.lefts.length > 4 ? `${h.lefts.slice(0, 3).join('/')}…` : h.lefts.join('/');
                const leftText = `${shown}天`;
                const titleText =
                  h.lefts.length > 1
                    ? `${esc(h.def.name)} · 各张剩余 ${h.lefts.join(' / ')} 天${hint}`
                    : `${esc(h.def.name)} · 剩余 ${min} 天${hint}`;
                return `<span class="hc" style="--hc:${hue}" title="${titleText}">${esc(h.def.short)}<em>×${h.qty}</em> <i>${leftText}</i></span>`;
              })
              .join('')}${
              r.activity > 0 ? `<span class="act" title="当天持有卡的活跃度之和">活跃 ${fmt(r.activity, 0)}</span>` : ''
            }</div>`
          : '';

        // 没有事件时不再留一行「—」，直接显示持仓与可购标签，行高更紧凑
        const cellInner = evHtml + holdHtml + qCell || '<span class="ev none">—</span>';

        return `<div class="day-item${r.isToday ? ' today' : ''}">
          <div class="di-top">
            <span class="di-date"><b>${r.date.slice(5)}</b><i>${r.isToday ? '今天' : r.weekday}</i></span>
            <span class="di-prod${r.produced > 0 ? '' : ' zero'}"${r.isToday ? ' title="今日产出已包含在当前余额中，不再重复累加"' : ''}>+${fmt(r.produced, 4)}</span>
            <span class="di-bal${r.balance < 0 ? ' neg' : ''}">${fmt(r.balance, 2)}</span>
          </div>
          <div class="di-body"><div class="cell-stack">${cellInner}</div></div>
        </div>`;
      })
      .join('');
  }

  /* ---------------- 渲染：汇总 ---------------- */
  function renderSummary(sim) {
    const s = sim.summary;
    const rows = sim.rows;
    const cardOut = s.spent;
    const cardNet = s.produced - cardOut;
    const coinNet = s.coinOut - s.coinIn;
    const items = [
      {
        k: '算力卡产出',
        v: '+' + fmt(s.produced, 2) + ' MEX',
        sub: '不含 M 币买卖',
        c: 'var(--cyan)',
      },
      {
        k: '算力卡消耗',
        v: '−' + fmt(cardOut, 2) + ' MEX',
        sub: '买卡投入',
        c: 'var(--amber)',
      },
      {
        k: '算力卡盈余',
        v: (cardNet >= 0 ? '+' : '−') + fmt(Math.abs(cardNet), 2) + ' MEX',
        sub: cardOut > 0 ? '回报率 ' + fmt((cardNet / cardOut) * 100, 1) + '%' : '产出减投入',
        c: cardNet >= 0 ? 'var(--green)' : 'var(--red)',
      },
      {
        k: 'M 币净额',
        v: (coinNet >= 0 ? '+' : '−') + fmt(Math.abs(coinNet), 2) + ' MEX',
        sub: '卖出 − 买入',
        c: coinNet >= 0 ? 'var(--violet)' : 'var(--red)',
      },
    ];
    $('#summary').innerHTML = items
      .map(
        (it) =>
          `<div class="sum-item"><div class="k">${it.k}</div><div class="v" style="color:${it.c}">${it.v}</div>${
            it.sub ? `<div class="sum-sub">${it.sub}</div>` : ''
          }</div>`
      )
      .join('');
  }

  /* ---------------- 渲染：存档列表 ---------------- */
  function fmtTime(ts) {
    if (!ts) return '刚创建';
    const d = new Date(ts);
    const now = new Date();
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  function updateProfileBtn() {
    const el = $('#profileName');
    if (el) el.textContent = activeProfile().name;
  }

  function renderProfiles() {
    const box = $('#profileList');
    if (!box) return;
    box.innerHTML = profiles.list
      .map((p) => {
        const isActive = p.id === profiles.activeId;
        const cards = (p.data.holdings || []).length;
        const coinsN = (p.data.coins || []).length;
        return `<div class="profile-item${isActive ? ' active' : ''}">
          <button class="profile-pick" type="button" data-switch="${p.id}">
            <span class="p-name">${esc(p.name)}${isActive ? '<em class="p-badge">当前</em>' : ''}</span>
            <span class="p-meta">${fmtTime(p.updatedAt)} · ${cards} 组卡 · ${coinsN} 笔 M 币</span>
          </button>
          <button class="icon-btn" type="button" data-rename="${p.id}" title="重命名" aria-label="重命名">✎</button>
          <button class="icon-btn" type="button" data-delete-profile="${p.id}" title="删除" aria-label="删除">✕</button>
        </div>`;
      })
      .join('');
  }

  /* ---------------- 渲染：规则速查表 ---------------- */
  function renderRulesTable() {
    const tbody = $('#rulesTable tbody');
    tbody.innerHTML = CARDS.map((c) => {
      const dailyOld = c.total / 35;
      const dailyNew = c.total / 40;
      return `<tr>
        <td>${esc(c.name)}</td>
        <td class="num">${fmt(c.price, 0)}</td>
        <td class="num">${fmt(c.total, 0)}</td>
        <td class="num" style="color:var(--cyan)">${fmt(dailyOld, 4)}</td>
        <td class="num" style="color:var(--violet)">${fmt(dailyNew, 4)}</td>
        <td class="num">${c.max}</td>
        <td class="num">${c.act}</td>
      </tr>`;
    }).join('');
  }

  /* ---------------- 主渲染 ---------------- */
  /* ---------------- 列表项点击 → 载入表单编辑 ---------------- */
  let editingManual = null;
  let editingCoin = null;

  function markEditing(attr, id) {
    document.querySelectorAll('[data-edit-manual],[data-edit-coin]').forEach((el) => {
      el.classList.remove('editing');
    });
    if (!attr || !id) return;
    const el = document.querySelector(`[${attr}="${id}"]`);
    if (el) el.classList.add('editing');
  }

  function syncEditForms() {
    const bs = $('#buySubmit');
    const bc = $('#buyCancel');
    if (bs) bs.textContent = editingManual ? '✓ 保存修改' : '＋ 添加购买事件';
    if (bc) bc.hidden = !editingManual;
    const cs = $('#coinSubmit');
    const cc = $('#coinCancel');
    if (cs) cs.textContent = editingCoin ? '✓ 保存修改' : '＋ 添加 M 币交易';
    if (cc) cc.hidden = !editingCoin;
  }

  function startEditManual(id) {
    const m = store.manual.find((x) => x.id === id);
    if (!m) return;
    editingManual = id;
    $('#buyCard').value = m.cardId;
    $('#buyQty').value = String(m.qty);
    $('#buyDate').value = m.date;
    markEditing('data-edit-manual', id);
    syncEditForms();
  }

  function endEditManual() {
    editingManual = null;
    $('#buyQty').value = '1';
    $('#buyDate').value = store.startDate;
    markEditing(null);
    syncEditForms();
  }

  function startEditCoin(id) {
    const c = (store.coins || []).find((x) => x.id === id);
    if (!c) return;
    editingCoin = id;
    $('#coinSide').value = c.side === 'sell' ? 'sell' : 'buy';
    $('#coinAmount').value = String(c.amount);
    $('#coinDate').value = c.date;
    $('#coinMexUsd').value = c.mexUsd ? String(c.mexUsd) : '';
    $('#coinUsdCny').value = c.usdCny ? String(c.usdCny) : '';
    markEditing('data-edit-coin', id);
    syncEditForms();
    if (typeof updateCoinPreview === 'function') updateCoinPreview();
  }

  function endEditCoin() {
    editingCoin = null;
    $('#coinAmount').value = '100';
    $('#coinDate').value = store.startDate;
    $('#coinMexUsd').value = '';
    $('#coinUsdCny').value = '';
    markEditing(null);
    syncEditForms();
    if (typeof updateCoinPreview === 'function') updateCoinPreview();
  }

  /* ---------------- 卡片折叠（默认全展开，状态记在浏览器里） ---------------- */
  const FOLD_KEY = 'mallex-fold';
  let foldState = {};
  try {
    foldState = JSON.parse(localStorage.getItem(FOLD_KEY)) || {};
  } catch (e) {
    foldState = {};
  }

  function applyFold() {
    document.querySelectorAll('[data-fold]').forEach((btn) => {
      const card = btn.closest('.card');
      if (!card) return;
      const collapsed = !!foldState[btn.dataset.fold];
      card.classList.toggle('collapsed', collapsed);
      // 按钮只是箭头图标，文案交给 aria
      btn.setAttribute('aria-label', collapsed ? '展开' : '收起');
      btn.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  function toggleFold(key) {
    foldState[key] = !foldState[key];
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(foldState));
    } catch (e) {
      /* 忽略隐私模式下的写入失败 */
    }
    applyFold();
  }

  // 表头吸顶时要避开固定顶栏
  function syncTopbarHeight() {
    const tb = document.querySelector('.topbar');
    if (!tb) return;
    const h = Math.round(tb.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--topbar-h', `${h}px`);
  }

  function render() {
    const sim = simulate();
    renderStats(sim);
    renderHoldings();
    renderToday(sim);
    renderManual();
    renderAuto();
    renderCoins();
    renderQuota(sim);
    renderTable(sim);
    renderSummary(sim);
    applyFold();
    syncTopbarHeight();

    const vt = $('#viewToggle');
    if (vt) {
      vt.textContent = store.view === 'events' ? '全部' : '仅事件';
      vt.setAttribute('aria-pressed', store.view === 'events' ? 'true' : 'false');
    }
    syncScrollHints();
    updateCoinPreview();
    save();
    requestAnimationFrame(syncScrollFab);
  }

  /* 横向滚动提示：内容超出容器时显示右侧渐隐 */
  function syncScrollHints() {
    let firstScrollable = false;
    document.querySelectorAll('.table-scroll').forEach((sc, i) => {
      const wrap = sc.querySelector('.table-wrap');
      if (!wrap) return;
      const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
      const scrollable = wrap.scrollWidth > wrap.clientWidth + 1;
      sc.classList.toggle('is-scrollable', scrollable);
      sc.classList.toggle('at-end', atEnd);
      if (i === 0) firstScrollable = scrollable && !atEnd;
    });
    const hint = document.getElementById('scrollHint');
    if (hint) hint.classList.toggle('show', firstScrollable);
  }
  window.addEventListener('resize', () => {
    syncScrollHints();
    syncTopbarHeight();
  });
  document.addEventListener(
    'scroll',
    (e) => {
      const wrap = e.target;
      if (wrap && wrap.classList && wrap.classList.contains('table-wrap')) {
        syncScrollHints();
      }
    },
    true
  );

  /* ---------------- 表单填充 ---------------- */
  function fillCardSelect(el) {
    el.innerHTML = CARDS.map(
      (c) =>
        `<option value="${c.id}">${c.name} · ${fmt(c.price, 0)} MEX · 额度 ${c.max}</option>`
    ).join('');
  }

  let horizonCustom = false;

  function syncHorizonInputs() {
    const isPreset = !horizonCustom && HORIZONS.includes(store.horizon);
    $('#horizonInput').value = isPreset ? String(store.horizon) : 'custom';
    const el = $('#horizonCustom');
    el.hidden = isPreset;
    el.value = isPreset ? '' : String(store.horizon);
  }

  function syncInputs() {
    horizonCustom = !HORIZONS.includes(store.horizon);
    $('#balanceInput').value = store.balance || '';
    $('#startInput').value = store.startDate;
    syncHorizonInputs();
    $('#holdDate').value = store.startDate;
    $('#buyDate').value = store.startDate;
    $('#autoFrom').value = store.startDate;
    $('#autoTo').value = addDays(store.startDate, store.horizon - 1);
    $('#coinMexUsd').value = store.rates.mexUsd || '';
    $('#coinUsdCny').value = store.rates.usdCny || '';
    syncCnyPerMex();
    $('#coinDate').value = store.startDate;
  }

  /* 1 MEX ≈ ¥X，显示在汇率说明里（跟着表单当前填的汇率走） */
  function syncCnyPerMex() {
    const el = $('#cnyNote');
    if (!el) return;
    const mexUsd = Number($('#coinMexUsd')?.value) || 0;
    const usdCny = Number($('#coinUsdCny')?.value) || 0;
    const v = mexUsd * usdCny;
    el.textContent = v > 0
      ? `1 MEX ≈ ¥${fmt(v, 2)} · 汇率只用于折算人民币`
      : '汇率只用于折算人民币，可留空。';
  }

  /* 2026-11-08 → 今天 · 2026/11/08 */
  function fmtDateLabel(d) {
    const isToday = d === todayStr();
    return `${isToday ? '今天 · ' : ''}${d.replace(/-/g, '/')}`;
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  /* M 币表单的实时换算：输入时刻就知道余额会变多少、折合多少人民币 */
  function updateCoinPreview() {
    const el = $('#coinPreview');
    if (!el) return;
    const side = $('#coinSide').value === 'sell' ? 'sell' : 'buy';
    const info = coinCalc({
      amount: parseFloat($('#coinAmount').value) || 0,
      mexUsd: parseFloat($('#coinMexUsd').value) || 0,
      usdCny: parseFloat($('#coinUsdCny').value) || 0,
    });
    let txt = '';
    let cls = 'calc-preview';
    if (info.amount <= 0) {
      txt = '填好数量后这里会实时显示余额变化与人民币折算';
    } else {
      const sign = side === 'sell' ? '−' : '+';
      const cny = info.cnyTotal > 0 ? `　≈ ¥${fmt(info.cnyTotal, 2)}` : '';
      txt = `${sign}${fmt(info.mexTotal, 2)} MEX${cny}`;
      cls += side === 'sell' ? ' ok out' : ' ok in';
    }
    el.className = cls;
    el.textContent = txt;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 基础设置
    $('#balanceInput').addEventListener('input', (e) => {
      store.balance = parseFloat(e.target.value) || 0;
      render();
    });
    $('#startInput').addEventListener('change', (e) => {
      const v = e.target.value;
      if (!v) return;
      store.startDate = v;
      syncInputs();
      render();
      toast(`起算日已改为 ${v.slice(5)}`);
    });
    $('#horizonInput').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === 'custom') {
        horizonCustom = true;
        // 切到自定义：以当前值为起点，保证输入框有内容
        store.horizon = Math.min(HORIZON_MAX, Math.max(HORIZON_MIN, store.horizon || 90));
      } else {
        horizonCustom = false;
        store.horizon = Number(v) || 90;
      }
      syncHorizonInputs();
      $('#autoTo').value = addDays(store.startDate, store.horizon - 1);
      render();
      if (v === 'custom') {
        const el = $('#horizonCustom');
        el.focus();
        el.select();
      }
    });
    $('#horizonCustom').addEventListener('input', (e) => {
      const v = Math.round(parseFloat(e.target.value) || 0);
      if (v > 0) {
        store.horizon = Math.min(HORIZON_MAX, Math.max(HORIZON_MIN, v));
        $('#autoTo').value = addDays(store.startDate, store.horizon - 1);
        render();
      }
    });

    // 添加算力卡
    $('#holdForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const cardId = $('#holdCard').value;
      const qty = Math.max(1, Math.min(99, parseInt($('#holdQty').value, 10) || 1));
      const date = $('#holdDate').value || store.startDate;
      const rule = $('#holdRule').value;
      if (!CARD_BY_ID[cardId]) return;
      const def = CARD_BY_ID[cardId];
      // 额度是「同时持有上限」：只统计今天仍占着额度的卡（到期次日才释放）
      const owned = resolveBase(store.holdings).filter(
        (i) => i.def.id === cardId && diffDays(i.start, store.startDate) <= i.days
      ).length;
      if (owned + qty > def.max) {
        const room = Math.max(0, def.max - owned);
        if (room === 0) return toast(`${def.name} 额度已用满（上限 ${def.max} 张）`);
        $('#holdQty').value = String(room);
        return toast(`额度只剩 ${room} 张，已改为 ×${room}`);
      }
      if (date < store.startDate) {
        // 起始日早于推算起点也允许（历史卡），仅提示
        toast('起始日期早于推算起点，该卡在起点时可能已到期');
      }
      store.holdings.push({ id: uid(), cardId, qty, date, rule });
      $('#holdQty').value = '1';
      render();
      toast(`已添加 ${def.name} ×${qty}`);
    });

    // 手动购买
    $('#buyForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const cardId = $('#buyCard').value;
      const qty = Math.max(1, Math.min(99, parseInt($('#buyQty').value, 10) || 1));
      const date = $('#buyDate').value || store.startDate;
      if (!CARD_BY_ID[cardId]) return;
      if (editingManual) {
        const m = store.manual.find((x) => x.id === editingManual);
        if (m) {
          m.cardId = cardId;
          m.qty = qty;
          m.date = date;
        }
        endEditManual();
        render();
        toast('已更新购买事件');
        return;
      }
      store.manual.push({ id: uid(), cardId, qty, date });
      $('#buyQty').value = '1';
      render();
      toast('已添加购买事件');
    });

    // 条件自动
    $('#autoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const cardId = $('#autoCard').value;
      const maxQty = Math.max(1, Math.min(99, parseInt($('#autoMax').value, 10) || 1));
      const from = $('#autoFrom').value || store.startDate;
      const to = $('#autoTo').value || addDays(store.startDate, store.horizon - 1);
      if (!CARD_BY_ID[cardId]) return;
      store.auto.push({ id: uid(), cardId, maxQty, from, to });
      render();
      toast('已添加自动购买规则');
    });

    // M 币汇率变化时记住为新默认值
    ['#coinMexUsd', '#coinUsdCny'].forEach((sel) => {
      $(sel)?.addEventListener('change', () => {
        store.rates.mexUsd = parseFloat($('#coinMexUsd').value) || 0;
        store.rates.usdCny = parseFloat($('#coinUsdCny').value) || 0;
        save();
      });
    });

    // M 币实时换算预览
    ['#coinAmount', '#coinMexUsd', '#coinUsdCny', '#coinSide'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('input', () => {
        syncCnyPerMex();
        updateCoinPreview();
      });
      el.addEventListener('change', () => {
        syncCnyPerMex();
        updateCoinPreview();
      });
    });

    // M 币买卖
    $('#coinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const side = $('#coinSide').value === 'sell' ? 'sell' : 'buy';
      const date = $('#coinDate').value || store.startDate;
      const amount = Math.max(0, parseFloat($('#coinAmount').value) || 0);
      if (amount <= 0) return toast('请填写 MEX 数量');
      const rec = {
        id: uid(),
        date,
        side,
        amount,
        mexUsd: Math.max(0, parseFloat($('#coinMexUsd').value) || 0),
        usdCny: Math.max(0, parseFloat($('#coinUsdCny').value) || 0),
      };
      if (editingCoin) {
        const c = store.coins.find((x) => x.id === editingCoin);
        if (c) {
          c.side = rec.side;
          c.amount = rec.amount;
          c.mexUsd = rec.mexUsd;
          c.usdCny = rec.usdCny;
          // 时间不改，保持原值
        }
        endEditCoin();
        render();
        toast('已更新 M 币交易');
        return;
      }
      store.coins.push(rec);
      $('#coinMexUsd').value = '';
      $('#coinUsdCny').value = '';
      render();
      toast(
        side === 'sell'
          ? `已添加卖出 ${coinAmountText(amount)} MEX`
          : `已添加买入 ${coinAmountText(amount)} MEX`
      );
    });

    // 取消编辑
    $('#buyCancel')?.addEventListener('click', () => {
      endEditManual();
      render();
    });
    $('#coinCancel')?.addEventListener('click', () => {
      endEditCoin();
      render();
    });

    // 删除（事件委托）
    document.addEventListener('click', (e) => {
      const fb = e.target.closest('[data-fold]');
      if (fb) {
        toggleFold(fb.dataset.fold);
        return;
      }
      // 点标题整行也能折叠（但避开右侧的操作按钮）
      const head = e.target.closest('.card-head');
      if (head && !e.target.closest('.head-actions') && !e.target.closest('button:not([data-fold])') && !e.target.closest('input,select')) {
        const b = head.querySelector('[data-fold]');
        if (b) {
          toggleFold(b.dataset.fold);
          return;
        }
      }
      const ex = e.target.closest('[data-expand]');
      if (ex) {
        expandState[ex.dataset.expand] = !expandState[ex.dataset.expand];
        render();
        return;
      }
      const em = e.target.closest('[data-edit-manual]');
      if (em && !e.target.closest('.x-btn')) {
        startEditManual(em.dataset.editManual);
        return;
      }
      const ec = e.target.closest('[data-edit-coin]');
      if (ec && !e.target.closest('.x-btn')) {
        startEditCoin(ec.dataset.editCoin);
        return;
      }
      const up = e.target.closest('[data-auto-up]');
      if (up) {
        moveAuto(up.dataset.autoUp, -1);
        return;
      }
      const dn = e.target.closest('[data-auto-down]');
      if (dn) {
        moveAuto(dn.dataset.autoDown, 1);
        return;
      }
      const t = e.target.closest('[data-del-hold],[data-del-manual],[data-del-auto],[data-del-coin]');
      if (!t) return;
      let msg = '';
      if (t.dataset.delHold) {
        store.holdings = store.holdings.filter((h) => h.id !== t.dataset.delHold);
        msg = '已删除算力卡';
      } else if (t.dataset.delManual) {
        store.manual = store.manual.filter((m) => m.id !== t.dataset.delManual);
        msg = '已删除购买事件';
      } else if (t.dataset.delAuto) {
        store.auto = store.auto.filter((r) => r.id !== t.dataset.delAuto);
        msg = '已删除自动规则';
      } else if (t.dataset.delCoin) {
        store.coins = store.coins.filter((c) => c.id !== t.dataset.delCoin);
        msg = '已删除 M 币交易';
      }
      if (msg) toast(msg);
      render();
    });

    // 分段切换
    $$('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.seg-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        $$('.seg-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + btn.dataset.seg));
      });
    });

    // 视图切换：全部 / 仅事件
    $('#viewToggle')?.addEventListener('click', () => {
      store.view = store.view === 'events' ? 'all' : 'events';
      render();
    });

    // 撤销 / 重做
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    });

    // 设置弹窗
    const settingsSheet = $('#settingsSheet');
    const openSettings = () => {
      $('#skipPastToggle').checked = !!store.skipPast;
      settingsSheet.hidden = false;
      document.body.classList.add('sheet-open');
      requestAnimationFrame(() => settingsSheet.classList.add('show'));
    };
    const closeSettings = () => {
      settingsSheet.classList.remove('show');
      document.body.classList.remove('sheet-open');
      setTimeout(() => {
        settingsSheet.hidden = true;
      }, 200);
    };
    $('#settingsBtn').addEventListener('click', openSettings);
    settingsSheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-settings]')) closeSettings();
    });
    $('#skipPastToggle').addEventListener('change', (e) => {
      store.skipPast = e.target.checked;
      render();
      toast(store.skipPast ? '已隐藏今天之前的数据' : '已显示全部区间');
    });

    // 重置当前存档
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('确定要清空当前存档的所有输入吗？此操作不可撤销。')) return;
      closeSettings();
      store = defaultStore();
      save();
      syncInputs();
      render();
      toast('已清空当前存档');
    });

    // M 币交易浮层：卡片常驻浮层内，只在打开时显示
    const coinSheet = $('#coinSheet');
    const openCoinSheet = () => {
      coinSheet.hidden = false;
      document.body.classList.add('sheet-open');
      requestAnimationFrame(() => coinSheet.classList.add('show'));
    };
    const closeCoinSheet = () => {
      coinSheet.classList.remove('show');
      document.body.classList.remove('sheet-open');
      setTimeout(() => {
        coinSheet.hidden = true;
      }, 200);
    };
    $('#coinFab').addEventListener('click', openCoinSheet);
    coinSheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-coin-sheet]')) closeCoinSheet();
    });

    // 回到今天：滚到「今日」那一行
    const todayFab = $('#todayFab');
    if (todayFab) {
      todayFab.addEventListener('click', () => {
        const head = $('.day-head');
        const card = head ? head.closest('.card') : null;
        if (card && card.classList.contains('collapsed')) toggleFold('days');
        const row = document.querySelector('#dayBody .day-item.today');
        if (row) {
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          row.animate
            ? row.animate(
                [{ backgroundColor: 'rgba(18,185,129,0.22)' }, { backgroundColor: 'rgba(18,185,129,0.06)' }],
                { duration: 900, easing: 'ease-out' }
              )
            : null;
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }

    // 滚动按钮：不在底部时朝下（直达底部），接近/已在底部时朝上（回到顶部）
    const scrollFab = $('#scrollFab');
    syncScrollFab = () => {
      if (!scrollFab) return;
      const doc = document.documentElement;
      const total = Math.max(1, doc.scrollHeight - window.innerHeight);
      const ratio = (window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight);
      const atBottom = window.scrollY >= total - 8 || ratio >= 0.95;
      scrollFab.classList.toggle('up', atBottom);
      scrollFab.setAttribute('aria-label', atBottom ? '回到顶部' : '直达底部');
      scrollFab.title = atBottom ? '回到顶部' : '直达底部';
    };
    if (scrollFab) {
      scrollFab.addEventListener('click', () => {
        if (scrollFab.classList.contains('up')) window.scrollTo({ top: 0, behavior: 'smooth' });
        else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      });
      window.addEventListener('scroll', syncScrollFab, { passive: true });
      window.addEventListener('resize', syncScrollFab);
      syncScrollFab();
    }

    // 存档面板
    const sheet = $('#profileSheet');
    const openSheet = () => {
      renderProfiles();
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('show'));
    };
    const closeSheet = () => {
      sheet.classList.remove('show');
      setTimeout(() => {
        sheet.hidden = true;
      }, 200);
    };
    $('#profileBtn').addEventListener('click', openSheet);
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-sheet]')) closeSheet();
      const sw = e.target.closest('[data-switch]');
      if (sw) {
        if (switchProfile(sw.dataset.switch)) closeSheet();
        return;
      }
      const ren = e.target.closest('[data-rename]');
      if (ren) {
        const p = profiles.list.find((x) => x.id === ren.dataset.rename);
        if (!p) return;
        const nm = prompt('重命名存档', p.name);
        if (nm !== null) renameProfile(p.id, nm);
        return;
      }
      const del = e.target.closest('[data-delete-profile]');
      if (del) {
        const p = profiles.list.find((x) => x.id === del.dataset.deleteProfile);
        if (!p) return;
        if (confirm(`删除存档「${p.name}」？其数据将一并移除。`)) deleteProfile(p.id);
      }
    });
    $('#newProfileBtn').addEventListener('click', () => {
      const nm = prompt('新存档名称（可留空）', `账号 ${profiles.list.length + 1}`);
      if (nm === null) return;
      createProfile(nm);
      closeSheet();
    });

    // 导出 / 导入纯文本（跨浏览器备份）
    $('#ioExportBtn').addEventListener('click', async () => {
      const txt = encodeStore(activeProfile().name, store);
      $('#ioArea').value = txt;
      $('#ioNote').textContent = '已导出并复制。把这串文本传到另一台设备，粘贴后点「导入」即可恢复。';
      let ok = false;
      try {
        await navigator.clipboard.writeText(txt);
        ok = true;
      } catch {
        $('#ioArea').select();
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
      }
      toast(ok ? '已导出并复制到剪贴板' : '已导出，请手动复制文本框内容');
    });
    $('#ioImportBtn').addEventListener('click', () => {
      const txt = $('#ioArea').value.trim();
      if (!txt) {
        $('#ioArea').focus();
        return toast('请先把导出的文本粘贴到框里');
      }
      let payload;
      try {
        payload = decodeStore(txt);
      } catch {
        return toast('这段文本无法识别，请检查是否完整');
      }
      const data = payload.data || payload;
      importProfile(data, payload.name || '导入账号');
      closeSheet();
    });

    // 导出 CSV
    $('#exportBtn').addEventListener('click', () => {
      const sim = simulate();
      const head = ['日期', '星期', '当日产出(MEX)', '当日余额(MEX)', '事件', '可购额度'];
      const lines = [head.join(',')];
      for (const r of sim.rows) {
        const ev = r.events.map((e) => e.text).join(' | ');
        const q = r.quota
          .filter((x) => x.left > 0 && x.afford)
          .map((x) => `${x.def.short}×${x.left}`)
          .join(' ');
        lines.push([r.date, r.weekday, r.produced.toFixed(6), r.balance.toFixed(6), `"${ev}"`, `"${q}"`].join(','));
      }
      const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MallEX算力卡推算_${todayStr()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已导出 CSV');
    });

    // 表格内交互：点「可购」标签 = 该日买入该卡 1 张；点买入事件 = 撤销 1 张
    const body = $('#dayBody');
    const onRowAction = (e) => {
      const buyBtn = e.target.closest('.qb[data-buy-card]');
      if (buyBtn) {
        addQuickBuy(buyBtn.dataset.buyDate, buyBtn.dataset.buyCard);
        return true;
      }
      const undoEl = e.target.closest('[data-undo-manual]');
      if (undoEl) {
        undoManualOne(undoEl.dataset.undoManual);
        return true;
      }
      return false;
    };
    body.addEventListener('click', onRowAction);
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (onRowAction(e)) e.preventDefault();
    });
  }

  /* 调整自动规则的顺序：排在前面的先花余额 */
  function moveAuto(id, dir) {
    const i = store.auto.findIndex((r) => r.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= store.auto.length) return;
    const tmp = store.auto[i];
    store.auto[i] = store.auto[j];
    store.auto[j] = tmp;
    render();
  }

  /* 在指定日期为指定卡买入 1 张（同卡同日合并为一条事件） */
  function addQuickBuy(date, cardId) {
    const def = CARD_BY_ID[cardId];
    if (!def || !date) return;
    const exist = store.manual.find((m) => m.date === date && m.cardId === cardId);
    if (exist) {
      const cur = Math.max(1, Number(exist.qty) || 1);
      if (cur >= 99) return toast('单条事件最多 99 张');
      exist.qty = cur + 1;
    } else {
      store.manual.push({ id: uid(), cardId, qty: 1, date });
    }
    render();
    toast(`${date.slice(5).replace('-', '/')} 买入 ${def.name} ×1`);
  }

  /* 撤销 1 张手动买入；数量归零则移除该条事件 */
  function undoManualOne(id) {
    const m = store.manual.find((x) => x.id === id);
    if (!m) return;
    const def = CARD_BY_ID[m.cardId];
    const q = (Number(m.qty) || 1) - 1;
    if (q <= 0) store.manual = store.manual.filter((x) => x.id !== id);
    else m.qty = q;
    render();
    toast(def ? `已撤销 1 张 ${def.name}` : '已撤销 1 张');
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    fillCardSelect($('#holdCard'));
    fillCardSelect($('#buyCard'));
    fillCardSelect($('#autoCard'));
    renderRulesTable();
    syncInputs();
    updateProfileBtn();
    renderProfiles();

    bind();
    render();
    pushHistory();

    if (firstRun) {
      setTimeout(() => toast('已填入示例数据，可在右上角「存档」里新建一份干净的'), 400);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
