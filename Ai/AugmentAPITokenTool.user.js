// ==UserScript==
// @name         !.Ai Augment Tool
// @description  Augment 全自动自动注册 + 凭证管理工具   -- TODO: 1.自动邮箱；2.自动人机验证
// @version      2.0.0
// @author       ank
// @namespace    http://010314.xyz/
// @match        *://*/*
// @match        https://augmentcode.com/*
// @match        https://*.augmentcode.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @connect      portal.withorb.com
// @connect      augmentcode.com
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Ai/AugmentAPITokenTool.user.js
// ==/UserScript==
(() => {
  'use strict';

  const CFG = {
    clientID: 'v',
    authURL: 'https://auth.augmentcode.com/authorize',
    orbAPI: 'https://portal.withorb.com/api/v1',
    pricingUnit: 'jWTJo9ptbapMWkvg'
  };

  // Utils
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const json = s => { try { return JSON.parse(s); } catch { return null; } };
  const copy = t => GM_setClipboard ? GM_setClipboard(t) : navigator.clipboard?.writeText(t);
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); };
  const sha256 = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const fmtDate = iso => {
    try {
      const d = new Date(iso); if (!iso || isNaN(d)) return ''; const pad = n => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    } catch { return ''; }
  };

  const http = (url, opt = {}) => new Promise((ok, fail) => {
    GM_xmlhttpRequest({
      method: opt.method || 'GET', url, headers: opt.headers || {},
      data: opt.data ? JSON.stringify(opt.data) : undefined, timeout: 10000,
      onload: r => r.status < 300 ? ok(json(r.responseText) || r.responseText) : fail(r.status),
      onerror: () => fail('网络错误'), ontimeout: () => fail('超时')
    });
  });

  // Data
  const store = {
    get: () => json(GM_getValue('creds', '[]')) || [],
    set: list => GM_setValue('creds', JSON.stringify(list)),
    add: item => { const list = store.get(); list.push({ id: Date.now(), ...item }); store.set(list); },
    del: id => store.set(store.get().filter(x => x.id !== id)),
    update: (id, patch) => { const list = store.get(); const i = list.findIndex(x => x.id === id); if (i > -1) list[i] = { ...list[i], ...patch }; store.set(list); }
  };

  // OAuth
  const oauth = {
    async start() {
      const email = prompt('请输入邮箱（用于后续配对）:');
      if (!email || !email.includes('@')) return ui.toast('邮箱格式错误');

      const verifier = rand(64), challenge = b64url(await sha256(verifier)), state = rand(16);
      GM_setValue('oauth', JSON.stringify({ verifier, challenge, state, email }));
      const params = new URLSearchParams({ response_type: 'code', client_id: CFG.clientID, code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'login' });
      window.open(`${CFG.authURL}?${params}`);
    },
    async token(tenant, code) {
      const { verifier } = json(GM_getValue('oauth', '{}')) || {};
      if (!verifier) throw '认证状态丢失';
      const url = tenant.endsWith('/') ? `${tenant}token` : `${tenant}/token`;
      const res = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: { grant_type: 'authorization_code', client_id: CFG.clientID, code_verifier: verifier, redirect_uri: '', code } });
      return res.access_token || (() => { throw '获取令牌失败' })();
    }
  };

  // Balance API
  const balance = {
    async info(token) {
      const sub = await http(`${CFG.orbAPI}/subscriptions_from_link?token=${token}`);
      const subItem = sub.data?.[0];
      const customer = subItem?.customer;
      if (!customer) throw '订阅信息错误';
      const bal = await http(`${CFG.orbAPI}/customers/${customer.id}/ledger_summary?pricing_unit_id=${CFG.pricingUnit}&token=${token}`);
      let included;
      try {
        const pi = (subItem.price_intervals || []).find(x => x.allocation && x.allocation.pricing_unit?.id === CFG.pricingUnit);
        included = pi?.allocation?.amount;
      } catch { }
      return { email: customer.email, balance: bal.credits_balance, endDate: subItem.end_date, included };
    },
    async check(cred) {
      if (!cred.subToken) return 'NO_TOKEN';
      try {
        const info = await this.info(cred.subToken);
        const expired = info.endDate && Date.now() > new Date(info.endDate);
        // 持久化可见信息，供 UI 展示
        store.update(cred.id, { lastBalance: info.balance, lastEndDate: info.endDate, lastIncluded: info.included });
        return expired ? 'EXPIRED' : info.balance <= 0 ? 'NO_BALANCE' : 'ACTIVE';
      } catch { return 'ERROR'; }
    }
  };

  // UI
  GM_addStyle(`
    #aug-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(2px);z-index:9998}
    #aug{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;width:min(720px,95vw);max-height:85vh;background:#fff;border:none;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    #aug-head{display:flex;align-items:center;padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;background:#fff;border-top-left-radius:16px;border-top-right-radius:16px;position:sticky;top:0;z-index:1}
    #aug-title{margin:0 0 0 8px;font-weight:600;font-size:18px;color:#0f172a}
    #aug-close{margin-left:auto;cursor:pointer;padding:8px;border-radius:8px;color:#64748b;font-size:16px;transition:all 0.15s}#aug-close:hover{background:#f1f5f9;color:#0f172a}
    #aug-body{overflow:auto;padding:8px 24px 24px;max-height:calc(85vh - 80px);background:#f8fafc}
    .header-stats{display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px 20px;background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%);border-radius:12px;border:1px solid #e2e8f0}
    .stat-item{display:flex;align-items:center;gap:8px;color:#475569;font-size:14px}
    .stat-value{font-weight:600;color:#0f172a}
    .group{margin-bottom:24px}
    .group-title{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px 12px;background:#fff;border-radius:8px;border:1px solid #e2e8f0;font-weight:600;color:#374151}
    .group-count{font-weight:400;color:#6b7280;font-size:13px}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:8px 0;transition:all 0.2s;position:relative}
    .card:hover{border-color:#cbd5e1;box-shadow:0 4px 12px -4px rgba(0,0,0,.1)}
    .card.st-ok{border-left:4px solid #16a34a}
    .card.st-warn{border-left:4px solid #f59e0b}
    .card.st-bad{border-left:4px solid #ef4444}
    .card.st-muted{border-left:4px solid #94a3b8}
    .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
    .card-title{font-weight:600;font-size:15px;color:#0f172a;margin:0;cursor:pointer}
    .card-title:hover{color:#3b82f6}
    .status{padding:3px 8px;border-radius:12px;font-size:11px;font-weight:500;text-transform:uppercase}
    .ok{background:#dcfce7;color:#166534}.bad{background:#fee2e2;color:#991b1b}.warn{background:#fef3c7;color:#92400e}.muted{background:#f1f5f9;color:#64748b}
    .info-row{display:flex;align-items:center;gap:12px;margin-bottom:8px;font-size:13px;color:#6b7280}
    .info-item{display:flex;align-items:center;gap:4px;cursor:pointer;padding:2px 4px;border-radius:4px;transition:background 0.15s}
    .info-item:hover{background:#f3f4f6}
    .info-value{color:#374151;font-weight:500}
    .progress{height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin:8px 0}
    .progress-bar{height:100%;background:linear-gradient(90deg,#10b981,#3b82f6);transition:width 0.3s ease}
    .clickable{cursor:pointer;padding:4px 6px;border-radius:4px;transition:all 0.15s;font-family:ui-monospace,monospace;font-size:12px;background:#f8fafc;border:1px solid #f1f5f9}
    .clickable:hover{background:#f1f5f9;border-color:#e2e8f0}
    .actions{display:flex;gap:6px;justify-content:flex-end;margin-top:12px;padding-top:8px;border-top:1px solid #f1f5f9}
    .btn{padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;transition:all 0.15s}
    .btn-primary{background:#3b82f6;color:#fff}.btn-primary:hover{background:#2563eb}
    .btn-secondary{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}.btn-secondary:hover{background:#e2e8f0}
    .btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
    .btn-ghost{background:transparent;color:#6b7280;border:1px solid #d1d5db}.btn-ghost:hover{background:#f9fafb;color:#374151}
    .empty-state{text-align:center;padding:40px 20px;color:#64748b}
    .copy-flash{background:#dbeafe !important;border-color:#93c5fd !important}
  `);

  const ui = {
    show(html) {
      const old = $('#aug'); if (old) old.remove(); const oldov = $('#aug-overlay'); if (oldov) oldov.remove();
      const ov = document.createElement('div'); ov.id = 'aug-overlay';
      const el = document.createElement('div'); el.id = 'aug';
      el.innerHTML = `
        <div id="aug-head">🔑<h3 id="aug-title">凭证管理</h3><span id="aug-close">✕</span></div>
        <div id="aug-body">${html}</div>`;
      document.body.appendChild(ov); ov.appendChild(el);
      const close = () => { try { el.remove(); } catch { } try { ov.remove(); } catch { } document.removeEventListener('keydown', onKey); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      $('#aug-close').onclick = close;
      ov.addEventListener('click', close);
      el.addEventListener('click', e => e.stopPropagation());
      return el;
    },
    toast(msg, ms = 2000) { const el = this.show(`<div style=\"text-align:center;padding:20px\">${msg}</div>`); setTimeout(() => el.remove(), ms); return el; },
    card(cred, status) {
      const st = status || cred.status || 'UNKNOWN';
      const badge = { ACTIVE: 'ok', EXPIRED: 'bad', NO_BALANCE: 'bad', ERROR: 'warn', NO_TOKEN: 'muted' }[st] || 'muted';
      const stateClass = { ACTIVE: 'st-ok', EXPIRED: 'st-bad', NO_BALANCE: 'st-bad', ERROR: 'st-warn', NO_TOKEN: 'st-muted', UNKNOWN: 'st-muted' }[st] || 'st-muted';
      const text = { ACTIVE: '正常', EXPIRED: '已过期', NO_BALANCE: '余额不足', ERROR: '检测失败', NO_TOKEN: '无令牌' }[st] || '未知';
      const subURL = cred.subToken ? `https://portal.withorb.com/view?token=${cred.subToken}` : '';
      const used = (cred.lastIncluded && cred.lastBalance != null) ? Math.max(0, Number(cred.lastIncluded) - Number(cred.lastBalance)) : null;
      const pct = (cred.lastIncluded && cred.lastBalance != null) ? Math.min(100, Math.max(0, Math.round((Number(cred.lastBalance) / Number(cred.lastIncluded)) * 100))) : null;

      const metrics = (cred.lastBalance || cred.lastEndDate || cred.lastIncluded) ?
        `<div class=\"info-row\">
          <div class=\"info-item\" title=\"复制余额\" data-copy="${cred.lastBalance ?? ''}">💬 <span class=\"info-value\">${cred.lastBalance ?? '?'}</span>${cred.lastIncluded ? ` / ${cred.lastIncluded}` : ''}${used != null ? ` · 已用: ${used}` : ''}</div>
          ${cred.lastEndDate ? `<div class=\"info-item\" title=\"复制到期时间\" data-copy=\"${fmtDate(cred.lastEndDate)} UTC\">⏳ <span class=\"info-value\">${fmtDate(cred.lastEndDate)} UTC</span></div>` : ''}
        </div>
        ${pct != null ? `<div class=\"progress\"><div class=\"progress-bar\" style=\"width:${pct}%\"></div></div>` : ''}` : '';

      return `<div class=\"card ${stateClass}\">
        <div class=\"card-header\">
          <h4 class=\"card-title\" title=\"点击复制该凭证\" data-copy-cred=\"${cred.id}\">${cred.email || `ID: ${cred.id}`}</h4>
          <span class=\"status ${badge}\">${text}</span>
        </div>
        ${metrics}
        <div class=\"clickable\" data-copy=\"${cred.tenant}\" title=\"点击复制租户URL\">🔗 ${cred.tenant}</div>
        <div class=\"clickable\" data-copy=\"${cred.token}\" title=\"点击复制访问令牌\">🔑 ${cred.token}</div>
        ${subURL ? `<div class=\"clickable\" data-copy=\"${subURL}\" title=\"点击复制订阅URL\">📊 ${subURL}</div>` : ''}
        <div class=\"actions\">
          <button class=\"btn btn-secondary\" data-check=\"${cred.id}\">检测</button>
          ${subURL ? `<a class=\"btn btn-secondary\" href=\"${subURL}\" target=\"_blank\">订阅</a>` : ''}
          <button class=\"btn btn-danger\" data-del=\"${cred.id}\">删除</button>
        </div>
      </div>`;
    },
    list(creds, statuses = {}) {
      const total = creds.length;
      const active = creds.filter(c => (statuses[c.id] || c.status) === 'ACTIVE').length;
      const abnormal = creds.filter(c => ['EXPIRED', 'NO_BALANCE', 'ERROR'].includes(statuses[c.id] || c.status)).length;
      const noToken = creds.filter(c => (statuses[c.id] || c.status) === 'NO_TOKEN').length;

      const header = `
        <div class=\"header-stats\">
          <div class=\"stat-item\">🔑 <span>凭证管理</span> <span style=\"color:#94a3b8\">共 <span class=\"stat-value\">${total}</span> 个</span></div>
          <div class=\"stat-item\">✅ 正常 <span class=\"stat-value\">${active}</span></div>
          <div class=\"stat-item\">🔒 异常 <span class=\"stat-value\">${abnormal}</span></div>
          <div class=\"stat-item\">⚠️ 无令牌 <span class=\"stat-value\">${noToken}</span></div>
          <button class=\"btn btn-primary\" id=\"batch\" style=\"margin-left:auto\">批量检测</button>
          <button class=\"btn btn-ghost\" id=\"copyAll\">一键复制全部</button>
        </div>`;

      const groupBy = (pred) => creds.filter(pred).map(c => this.card(c, statuses[c.id])).join('') || '<div class=\"empty-state\">无</div>';
      const okHtml = groupBy(c => (statuses[c.id] || c.status) === 'ACTIVE');
      const badHtml = groupBy(c => ['EXPIRED', 'NO_BALANCE', 'ERROR'].includes(statuses[c.id] || c.status));
      const emptyHtml = groupBy(c => (statuses[c.id] || c.status) === 'NO_TOKEN');

      const body = `
        <div class=\"group\"><div class=\"group-title\">✅ 正常 <span class=\"group-count\">${active}</span></div>${okHtml}</div>
        <div class=\"group\"><div class=\"group-title\">🔒 异常 <span class=\"group-count\">${abnormal}</span></div>${badHtml}</div>
        <div class=\"group\"><div class=\"group-title\">⚠️ 无令牌 <span class=\"group-count\">${noToken}</span></div>${emptyHtml}</div>`;

      const el = this.show(header + body);

      // 点击复制（单项）
      el.querySelectorAll('[data-copy]').forEach(x => x.onclick = () => { copy(x.dataset.copy); x.classList.add('copy-flash'); setTimeout(() => x.classList.remove('copy-flash'), 400); });
      // 点击标题复制整条凭证（JSON）
      el.querySelectorAll('[data-copy-cred]').forEach(h => h.onclick = () => {
        const id = +h.getAttribute('data-copy-cred');
        const cred = creds.find(c => c.id === id);
        copy(JSON.stringify(cred, null, 2));
        h.classList.add('copy-flash'); setTimeout(() => h.classList.remove('copy-flash'), 400);
      });
      // 复制所有凭证
      $('#copyAll').onclick = () => { copy(JSON.stringify(creds, null, 2)); };

      el.querySelectorAll('[data-del]').forEach(x => x.onclick = () => confirm('确定删除？') && (store.del(+x.dataset.del), actions.manage()));
      el.querySelectorAll('[data-check]').forEach(x => x.onclick = () => actions.check(+x.dataset.check));
      $('#batch').onclick = actions.batch;
    }
  };

  // Actions
  const actions = {
    auth: () => oauth.start(),
    async manage() {
      const creds = store.get();
      if (!creds.length) return ui.toast('暂无凭证');
      const toastEl = ui.toast('加载中...', 200000);
      const statuses = {};
      await Promise.all(creds.map(async c => { statuses[c.id] = await balance.check(c); }));
      // 读取更新后的凭证（包含 lastBalance/lastEndDate/lastIncluded）
      const updatedCreds = store.get();
      toastEl?.remove?.();
      ui.list(updatedCreds, statuses);
    },
    async check(id) {
      const cred = store.get().find(x => x.id === id);
      if (!cred) return;
      const toastEl = ui.toast('检测中...', 10000);
      const status = await balance.check(cred);
      store.update(id, { status });
      toastEl?.remove?.();
      actions.manage();
    },
    async batch() {
      const creds = store.get();
      const toastEl = ui.toast('批量检测中...', 200000);

      await Promise.allSettled(creds.map(async c => {
        const status = await balance.check(c);
        store.update(c.id, { status });
        return status;
      }));
      toastEl?.remove?.();
      actions.manage()
    }
  };

  // Page handlers
  const pages = {
    async loginIdentifier() {
      const { email } = json(GM_getValue('oauth', '{}')) || {};
      if (!email) return; // 未预设邮箱则不处理
      // 等待 #username 出现
      let input;
      for (let i = 0; i < 40; i++) {
        input = document.querySelector('#username');
        if (input) break;
        await sleep(500);
      }
      if (!input) return;
      // 赋值并触发事件
      input.value = email;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // 禁用编辑但保留提交值（使用 readOnly 而非 disabled）
      input.readOnly = true;
      input.setAttribute('aria-readonly', 'true');
    },

    async terms() {
      const { email } = json(GM_getValue('oauth', '{}')) || {};
      if (!email) return ui.toast('未找到预设邮箱');

      let code, tenant;
      for (const script of document.scripts) {
        const text = script.textContent;
        if (text.includes('code:') && text.includes('tenant_url:')) {
          code = text.match(/code:\s*["']([^"']+)["']/)?.[1];
          tenant = text.match(/tenant_url:\s*["']([^"']+)["']/)?.[1];
          if (code && tenant) break;
        }
      }
      if (!code || !tenant) return ui.toast('未找到授权信息');

      ui.toast('获取令牌中...');
      try {
        const token = await oauth.token(tenant, code);
        store.add({ tenant, token, email });
        GM_setValue('oauth', '');
        ui.toast('成功！跳转补充信息...');
        setTimeout(() => location.href = 'https://app.augmentcode.com/account/subscription', 1000);
      } catch (e) {
        ui.toast(`失败: ${e}`);
      }
    },

    async subscription() {
      ui.toast('获取用户信息...');

      let loginiEmail, subToken;
      for (let i = 0; i < 10; i++) {
        loginiEmail = $('.base-header-email')?.textContent?.trim();
        const link = $('a.rt-Text.rt-Link.rt-underline-auto[target="_blank"]');
        if (link?.href) {
          try { subToken = new URL(link.href).searchParams.get('token'); } catch { }
        }
        if (loginiEmail && subToken) break;
        await sleep(500);
      }
      if (!loginiEmail && !subToken) return ui.toast('未获取到登录邮箱或订阅令牌');

      const creds = store.get();

      // 查找邮箱匹配的凭证（优先已有subToken的，再找待配对的）
      const matching = creds.find(c => c.email === loginiEmail);
      if (matching && !matching.subToken) {
        store.update(matching.id, { subToken });
        return ui.toast(`✅ 凭证已完成: ${loginiEmail}`);
      }

      const pending = creds.filter(c => c.email && !c.subToken).sort((a, b) => b.id - a.id)[0];
      if (pending) return ui.toast(`❌ 邮箱不匹配: 预期 ${pending.email}, 实际登入 ${loginiEmail}，请登入 ${pending.email} 获取令牌`);

      ui.toast('⚠️ 未找到待配对的凭证，请先获取令牌');
      // actions.auth();
    }
  };

  // Init
  GM_registerMenuCommand('🚀 获取令牌', actions.auth);
  GM_registerMenuCommand('🔑 管理凭证', actions.manage);

  if (location.href.includes('login.augmentcode.com/u/login/identifier')) setTimeout(pages.loginIdentifier, 500);
  if (location.pathname.includes('terms-accept')) setTimeout(pages.terms, 1000);
  if (location.href.includes('app.augmentcode.com/account/subscription')) setTimeout(pages.subscription, 1000);

})();

