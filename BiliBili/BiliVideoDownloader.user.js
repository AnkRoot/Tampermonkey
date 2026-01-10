// ==UserScript==
// @name         !.Bilibili Video Downloader (Ank)
// @description  B站视频/番剧/课程解析：支持dash/flv/mp4，字幕/弹幕下载，aria2 RPC/命令/Blob下载；仅使用账号可访问资源（不绕过权限），UI默认零侵入（Shadow DOM）。
// @version      0.0.1
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0
// @match        *://www.bilibili.com/video/av*
// @match        *://www.bilibili.com/video/BV*
// @match        *://www.bilibili.com/list/*
// @match        *://www.bilibili.com/festival/*
// @match        *://www.bilibili.com/bangumi/play/ep*
// @match        *://www.bilibili.com/bangumi/play/ss*
// @match        *://www.bilibili.com/cheese/play/ep*
// @match        *://www.bilibili.com/cheese/play/ss*
// @icon         https://static.hdslb.com/images/favicon.ico
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      api.bilibili.com
// @connect      *.bilivideo.com
// @connect      *.hdslb.com
// @connect      localhost
// @connect      127.0.0.1
// @connect      ::1
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/BiliBili/BiliVideoDownloader.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/BiliBili/BiliVideoDownloader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const APP = Object.freeze({
    id: 'ank-bili-downloader',
    name: 'AnkBiliDownloader',
    storeKey: 'ank:bili:downloader:config',
    version: '0.0.1'
  });

  const QUALITY_LABEL = Object.freeze({
    127: '8K',
    120: '4K',
    116: '1080P60',
    112: '1080P+',
    80: '1080P',
    74: '720P60',
    64: '720P',
    32: '480P',
    16: '360P'
  });

  const HOST_MAP = Object.freeze({
    '0': '不替换',
    local: (document.head?.innerHTML?.match(/up[\w-]+\.bilivideo\.com/)?.[0] || '').trim() || '本地CDN(未发现)',
    bd: 'upos-sz-mirrorbd.bilivideo.com',
    ks3: 'upos-sz-mirrorks3.bilivideo.com',
    ks3b: 'upos-sz-mirrorks3b.bilivideo.com',
    ks3c: 'upos-sz-mirrorks3c.bilivideo.com',
    ks32: 'upos-sz-mirrorks32.bilivideo.com',
    kodo: 'upos-sz-mirrorkodo.bilivideo.com',
    kodob: 'upos-sz-mirrorkodob.bilivideo.com',
    cos: 'upos-sz-mirrorcos.bilivideo.com',
    cosb: 'upos-sz-mirrorcosb.bilivideo.com',
    bos: 'upos-sz-mirrorbos.bilivideo.com',
    wcs: 'upos-sz-mirrorwcs.bilivideo.com',
    wcsb: 'upos-sz-mirrorwcsb.bilivideo.com',
    hw: 'upos-sz-mirrorhw.bilivideo.com',
    hwb: 'upos-sz-mirrorhwb.bilivideo.com',
    upbda2: 'upos-sz-upcdnbda2.bilivideo.com',
    upws: 'upos-sz-upcdnws.bilivideo.com',
    uptx: 'upos-sz-upcdntx.bilivideo.com',
    uphw: 'upos-sz-upcdnhw.bilivideo.com',
    js: 'upos-tf-all-js.bilivideo.com',
    hk: 'cn-hk-eq-bcache-01.bilivideo.com',
    akamai: 'upos-hz-mirrorakam.akamaized.net'
  });

  const FORMAT_LABEL = Object.freeze({
    dash: 'DASH(音视频分离)',
    mp4: 'MP4(可能分段)',
    flv: 'FLV(可能分段)'
  });

  const DEFAULT_CONFIG = Object.freeze({
    debug: false,
    uiEnabled: true,
    uiStartCollapsed: true,
    parse: {
      defaultQn: 80,
      format: 'dash',
      hostKey: '0',
      preferCodec: 'auto',
      preferAudio: 'best'
    },
    download: {
      method: 'copy',
      aria2cConnectionLevel: 'min',
      aria2cExtra: '',
      rpc: {
        domain: 'http://localhost',
        port: '6800',
        token: '',
        dir: ''
      }
    },
    autoQuality: {
      enabled: false,
      target: 'highest'
    },
    request: {
      timeoutMs: 8000,
      retries: 2,
      retryDelayBaseMs: 450
    }
  });

  class AppError extends Error {
    constructor(level, message, details = {}) {
      super(message);
      this.name = 'AppError';
      this.level = level;
      this.details = details;
    }
  }

  class Logger {
    #enabled;
    constructor(enabled) {
      this.#enabled = !!enabled;
    }
    debug(...args) {
      if (!this.#enabled) return;
      console.debug(`[${APP.name}]`, ...args);
    }
    info(...args) {
      console.info(`[${APP.name}]`, ...args);
    }
    warn(...args) {
      console.warn(`[${APP.name}]`, ...args);
    }
    error(...args) {
      console.error(`[${APP.name}]`, ...args);
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const waitFor = async (getter, timeoutMs = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const v = getter();
        if (v) return v;
      } catch {
        /* ignore */
      }
      await sleep(80);
    }
    return null;
  };

  const escapeHtml = (s) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  const safeMessage = (e) => {
    if (e instanceof AppError) return e.message;
    if (e instanceof Error) return e.message || '未知错误';
    return String(e || '未知错误');
  };

  const copyText = async (text) => {
    const t = String(text || '');
    if (!t) return false;
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(t, 'text');
        return true;
      }
    } catch {
      /* ignore */
    }
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      return false;
    }
  };

  const openUrl = (url) => {
    const u = String(url || '').trim();
    if (!u) return;
    if (typeof GM_openInTab === 'function') GM_openInTab(u, { active: true, insert: true, setParent: true });
    else window.open(u, '_blank', 'noopener,noreferrer');
  };

  const sanitizeFilename = (name) =>
    String(name || 'bilibili')
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'bilibili';

  const assTime = (sec) => {
    const t = Math.max(0, Number(sec) || 0);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const cs = Math.floor((t - Math.floor(t)) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const colorToAss = (dec) => {
    const n = Number(dec) >>> 0;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `&H00${String(b).padStart(2, '0')}${String(g).padStart(2, '0')}${String(r).padStart(2, '0')}&`;
  };

  const downloadTextFile = (content, filename, mime = 'text/plain') => {
    const blob = new Blob([String(content || '')], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  };

  const parseDanmakuXml = (xmlText) => {
    const text = String(xmlText || '');
    if (!text.includes('<d')) return [];
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    const ds = Array.from(dom.getElementsByTagName('d'));
    return ds
      .map((d) => {
        const p = String(d.getAttribute('p') || '');
        const parts = p.split(',');
        const time = Number(parts[0]) || 0;
        const mode = Number(parts[1]) || 1;
        const size = Number(parts[2]) || 25;
        const color = Number(parts[3]) || 16777215;
        const content = String(d.textContent || '').replaceAll('\n', ' ').trim();
        return content ? { time, mode, size, color, content } : null;
      })
      .filter(Boolean);
  };

  const danmakuToAss = (items, { title = 'Danmaku', playResX = 1920, playResY = 1080, baseFontSize = 52, scrollSeconds = 8, fixSeconds = 4 } = {}) => {
    const safeTitle = sanitizeFilename(title);
    const header = [
      '[Script Info]',
      `; Script generated by ${APP.name}`,
      `Title: ${safeTitle}`,
      'ScriptType: v4.00+',
      `PlayResX: ${playResX}`,
      `PlayResY: ${playResY}`,
      'Timer: 10.0000',
      'WrapStyle: 2',
      'ScaledBorderAndShadow: no',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Default,微软雅黑,${baseFontSize},&H66FFFFFF&,&H66FFFFFF&,&H66000000&,&H66000000&,0,0,0,0,100,100,0,0,1,1.2,0,2,0,0,0,0`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
    ].join('\n');

    const lines = [];
    for (const it of Array.isArray(items) ? items : []) {
      const start = assTime(it.time);
      const end = assTime(it.time + (it.mode === 4 || it.mode === 5 ? fixSeconds : scrollSeconds));
      const fontSize = Math.max(16, Math.min(120, Number(it.size) || 25));
      const color = colorToAss(it.color);
      const safeText = String(it.content || '').replaceAll('{', '｛').replaceAll('}', '｝');
      if (!safeText) continue;
      if (it.mode === 4 || it.mode === 5) {
        const an = it.mode === 4 ? 2 : 8;
        const y = it.mode === 4 ? playResY - 60 : 60;
        const x = Math.floor(playResX / 2);
        lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,{\\an${an}\\pos(${x},${y})\\fs${fontSize}\\c${color}}${safeText}`);
        continue;
      }
      const y = 60 + Math.floor(Math.random() * (playResY - 120));
      const x1 = playResX + 80;
      const x2 = -80;
      lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,{\\move(${x1},${y},${x2},${y})\\fs${fontSize}\\c${color}}${safeText}`);
    }
    return `${header}\n${lines.join('\n')}\n`;
  };

  class StorageService {
    #key;
    constructor(key) {
      this.#key = key;
    }
    getJson(fallback) {
      try {
        const raw = typeof GM_getValue === 'function' ? GM_getValue(this.#key, '') : '';
        if (!raw) return fallback;
        const v = JSON.parse(raw);
        return v && typeof v === 'object' ? v : fallback;
      } catch {
        return fallback;
      }
    }
    setJson(value) {
      const raw = JSON.stringify(value ?? {});
      if (typeof GM_setValue === 'function') GM_setValue(this.#key, raw);
    }
  }

  class ConfigService {
    #storage;
    #config;
    constructor(storage) {
      this.#storage = storage;
      this.#config = this.#merge(DEFAULT_CONFIG, this.#storage.getJson({}));
      this.#sanitize();
    }
    get() {
      return this.#config;
    }
    update(patch) {
      this.#config = this.#merge(this.#config, patch || {});
      this.#sanitize();
      this.#storage.setJson(this.#config);
      return this.#config;
    }
    reset() {
      this.#config = this.#merge(DEFAULT_CONFIG, {});
      this.#sanitize();
      this.#storage.setJson(this.#config);
      return this.#config;
    }
    #merge(base, patch) {
      const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
      for (const [k, v] of Object.entries(patch || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object' && base[k] && !Array.isArray(base[k])) out[k] = this.#merge(base[k], v);
        else out[k] = v;
      }
      return out;
    }
    #sanitize() {
      const cfg = this.#config;
      cfg.debug = !!cfg.debug;
      cfg.uiEnabled = cfg.uiEnabled !== false;
      cfg.uiStartCollapsed = cfg.uiStartCollapsed !== false;
      cfg.parse = cfg.parse && typeof cfg.parse === 'object' ? cfg.parse : { ...DEFAULT_CONFIG.parse };
      cfg.parse.defaultQn = Number.isFinite(+cfg.parse.defaultQn) ? +cfg.parse.defaultQn : DEFAULT_CONFIG.parse.defaultQn;
      cfg.parse.format = ['dash', 'mp4', 'flv'].includes(cfg.parse.format) ? cfg.parse.format : DEFAULT_CONFIG.parse.format;
      cfg.parse.hostKey = typeof cfg.parse.hostKey === 'string' ? cfg.parse.hostKey : DEFAULT_CONFIG.parse.hostKey;
      cfg.parse.preferCodec = ['auto', 'avc', 'hev'].includes(cfg.parse.preferCodec) ? cfg.parse.preferCodec : DEFAULT_CONFIG.parse.preferCodec;
      cfg.parse.preferAudio = ['best', 'first'].includes(cfg.parse.preferAudio) ? cfg.parse.preferAudio : DEFAULT_CONFIG.parse.preferAudio;
      cfg.download = cfg.download && typeof cfg.download === 'object' ? cfg.download : { ...DEFAULT_CONFIG.download };
      cfg.download.method = ['copy', 'aria', 'rpc', 'blob', 'browser'].includes(cfg.download.method) ? cfg.download.method : DEFAULT_CONFIG.download.method;
      cfg.download.aria2cConnectionLevel = ['min', 'mid', 'max'].includes(cfg.download.aria2cConnectionLevel) ? cfg.download.aria2cConnectionLevel : DEFAULT_CONFIG.download.aria2cConnectionLevel;
      cfg.download.aria2cExtra = String(cfg.download.aria2cExtra || '');
      cfg.download.rpc = cfg.download.rpc && typeof cfg.download.rpc === 'object' ? cfg.download.rpc : { ...DEFAULT_CONFIG.download.rpc };
      cfg.download.rpc.domain = String(cfg.download.rpc.domain || DEFAULT_CONFIG.download.rpc.domain);
      cfg.download.rpc.port = String(cfg.download.rpc.port || DEFAULT_CONFIG.download.rpc.port);
      cfg.download.rpc.token = String(cfg.download.rpc.token || '');
      cfg.download.rpc.dir = String(cfg.download.rpc.dir || '');
      cfg.autoQuality = cfg.autoQuality && typeof cfg.autoQuality === 'object' ? cfg.autoQuality : { ...DEFAULT_CONFIG.autoQuality };
      cfg.autoQuality.enabled = !!cfg.autoQuality.enabled;
      cfg.autoQuality.target = cfg.autoQuality.target === 'highest' ? 'highest' : Number.isFinite(+cfg.autoQuality.target) ? +cfg.autoQuality.target : DEFAULT_CONFIG.autoQuality.target;
      cfg.request = cfg.request && typeof cfg.request === 'object' ? cfg.request : { ...DEFAULT_CONFIG.request };
      cfg.request.timeoutMs = Math.max(1200, Number.isFinite(+cfg.request.timeoutMs) ? +cfg.request.timeoutMs : DEFAULT_CONFIG.request.timeoutMs);
      cfg.request.retries = Math.min(5, Math.max(0, Number.isFinite(+cfg.request.retries) ? +cfg.request.retries : DEFAULT_CONFIG.request.retries));
      cfg.request.retryDelayBaseMs = Math.min(5000, Math.max(80, Number.isFinite(+cfg.request.retryDelayBaseMs) ? +cfg.request.retryDelayBaseMs : DEFAULT_CONFIG.request.retryDelayBaseMs));
    }
  }

  class GMHttp {
    #cfg;
    #log;
    constructor(cfg, log) {
      this.#cfg = cfg;
      this.#log = log;
    }
    async getJsonWithFallback(urls, options = {}) {
      const list = (urls || []).filter(Boolean);
      if (!list.length) throw new AppError('fatal', '请求地址为空');
      let lastErr;
      for (const url of list) {
        try {
          return await this.getJson(url, options);
        } catch (e) {
          lastErr = e;
          this.#log.debug('fallback url failed:', url, e);
        }
      }
      throw lastErr || new AppError('fatal', '所有请求均失败');
    }
    async getJson(url, options = {}) {
      const cfg = this.#cfg.request;
      const timeoutMs = Number.isFinite(+options.timeoutMs) ? +options.timeoutMs : cfg.timeoutMs;
      const retries = Number.isFinite(+options.retries) ? +options.retries : cfg.retries;
      const retryDelayBaseMs = Number.isFinite(+options.retryDelayBaseMs) ? +options.retryDelayBaseMs : cfg.retryDelayBaseMs;
      const headers = options.headers && typeof options.headers === 'object' ? options.headers : {};
      const attemptOnce = () =>
        new Promise((resolve, reject) => {
          if (typeof GM_xmlhttpRequest !== 'function') return reject(new AppError('fatal', '缺少 GM_xmlhttpRequest 授权/能力'));
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            headers,
            timeout: timeoutMs,
            responseType: 'text',
            anonymous: false,
            withCredentials: true,
            onload: (res) => {
              const ok = res.status >= 200 && res.status < 300;
              if (!ok) return reject(new AppError('recoverable', `HTTP ${res.status}`, { status: res.status, url }));
              try {
                const json = JSON.parse(res.responseText || '{}');
                resolve(json);
              } catch {
                reject(new AppError('recoverable', 'JSON 解析失败', { url }));
              }
            },
            ontimeout: () => reject(new AppError('recoverable', '请求超时', { url, timeoutMs })),
            onerror: () => reject(new AppError('recoverable', '网络错误', { url }))
          });
        });

      let lastErr;
      for (let i = 0; i <= retries; i++) {
        try {
          if (i > 0) await sleep(retryDelayBaseMs * i + Math.floor(Math.random() * 120));
          return await attemptOnce();
        } catch (e) {
          lastErr = e;
          const level = e instanceof AppError ? e.level : 'recoverable';
          if (level === 'fatal') break;
        }
      }
      throw lastErr || new AppError('fatal', '请求失败', { url });
    }

    async getText(url, options = {}) {
      const res = await this.request({ method: 'GET', url, responseType: 'text', ...options });
      return String(res.responseText || '');
    }

    async postJson(url, data, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      const res = await this.request({ method: 'POST', url, data: JSON.stringify(data ?? {}), headers, responseType: 'text', ...options });
      try {
        return JSON.parse(res.responseText || '{}');
      } catch {
        throw new AppError('recoverable', 'JSON 解析失败', { url });
      }
    }

    async getBlob(url, options = {}) {
      const res = await this.request({ method: 'GET', url, responseType: 'blob', ...options });
      return res.response;
    }

    async request(options) {
      const cfg = this.#cfg.request;
      const method = String(options.method || 'GET').toUpperCase();
      const url = String(options.url || '');
      if (!url) throw new AppError('fatal', '请求地址为空');
      const timeoutMs = Number.isFinite(+options.timeoutMs) ? +options.timeoutMs : cfg.timeoutMs;
      const retries = Number.isFinite(+options.retries) ? +options.retries : cfg.retries;
      const retryDelayBaseMs = Number.isFinite(+options.retryDelayBaseMs) ? +options.retryDelayBaseMs : cfg.retryDelayBaseMs;
      const headers = options.headers && typeof options.headers === 'object' ? options.headers : {};
      const data = options.data;
      const responseType = options.responseType || 'text';
      const attemptOnce = () =>
        new Promise((resolve, reject) => {
          if (typeof GM_xmlhttpRequest !== 'function') return reject(new AppError('fatal', '缺少 GM_xmlhttpRequest 授权/能力'));
          GM_xmlhttpRequest({
            method,
            url,
            headers,
            data,
            timeout: timeoutMs,
            responseType,
            anonymous: false,
            withCredentials: true,
            onload: (res) => {
              const ok = res.status >= 200 && res.status < 300;
              if (!ok) return reject(new AppError('recoverable', `HTTP ${res.status}`, { status: res.status, url }));
              resolve(res);
            },
            ontimeout: () => reject(new AppError('recoverable', '请求超时', { url, timeoutMs })),
            onerror: () => reject(new AppError('recoverable', '网络错误', { url }))
          });
        });
      let lastErr;
      for (let i = 0; i <= retries; i++) {
        try {
          if (i > 0) await sleep(retryDelayBaseMs * i + Math.floor(Math.random() * 120));
          return await attemptOnce();
        } catch (e) {
          lastErr = e;
          const level = e instanceof AppError ? e.level : 'recoverable';
          if (level === 'fatal') break;
        }
      }
      throw lastErr || new AppError('fatal', '请求失败', { url });
    }
  }

  class BiliContext {
    #log;
    constructor(log) {
      this.#log = log;
    }
    detect() {
      const path = location.pathname || '';
      if (/^\/video\/(av\d+|BV\w+)/.test(path)) return { kind: 'video' };
      if (/^\/bangumi\/play\/(ep\d+|ss\d+)/.test(path)) return { kind: 'bangumi' };
      if (/^\/cheese\/play\/(ep\d+|ss\d+)/.test(path)) return { kind: 'cheese' };
      if (/^\/list\//.test(path) || /^\/festival\//.test(path)) return { kind: 'video' };
      return { kind: 'unknown' };
    }
    #getTitleFromState() {
      try {
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const state = pageWindow.__INITIAL_STATE__;
        if (state?.videoData?.title) return String(state.videoData.title).trim();
        if (state?.mediaListInfo?.title) return String(state.mediaListInfo.title).trim();
        if (state?.title) return String(state.title).trim();
      } catch {
        /* ignore */
      }
      return '';
    }
    async getVideoInfo(http) {
      const p = Math.max(1, parseInt(new URLSearchParams(location.search).get('p') || '1', 10) || 1);
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const state = await waitFor(() => pageWindow.__INITIAL_STATE__, 1200);
      const videoData = state?.videoData;
      if (videoData?.aid && videoData?.bvid && Array.isArray(videoData.pages) && videoData.pages.length) {
        const page = videoData.pages[p - 1] || videoData.pages[0];
        const cid = page?.cid;
        if (!cid) throw new AppError('fatal', '未识别到 cid（分P信息缺失）');
        const title = String(videoData.title || this.#getTitleFromState() || document.title || 'bilibili').trim();
        const part = String(page?.part || '').trim();
        const pages = videoData.pages.map((pg, idx) => ({ p: idx + 1, cid: pg?.cid, part: String(pg?.part || '').trim() })).filter((x) => x?.cid);
        return { kind: 'video', aid: videoData.aid, bvid: videoData.bvid, cid, p, title, part, pages, referrer: location.href };
      }
      if (!http) throw new AppError('fatal', '页面信息不可用，且缺少网络能力（http）');
      return await this.#getVideoInfoFromApi(http, p);
    }
    async #getVideoInfoFromApi(http, p) {
      const path = location.pathname || '';
      const bvidMatch = path.match(/\/video\/(BV\w+)/);
      const avidMatch = path.match(/\/video\/av(\d+)/);
      const query = bvidMatch ? `bvid=${encodeURIComponent(bvidMatch[1])}` : avidMatch ? `aid=${encodeURIComponent(avidMatch[1])}` : '';
      if (!query) throw new AppError('fatal', '未识别到 BV/AV（URL解析失败）');
      const url = `https://api.bilibili.com/x/web-interface/view?${query}`;
      const res = await http.getJson(url, { retries: 1 });
      if (res?.code !== 0 || !res?.data) throw new AppError('recoverable', `view接口失败：${res?.message || res?.code || 'unknown'}`);
      const data = res.data;
      const pages = Array.isArray(data.pages) ? data.pages : [];
      const page = pages[p - 1] || pages[0];
      const cid = page?.cid;
      if (!data?.aid || !data?.bvid || !cid) throw new AppError('fatal', 'view接口数据不完整（缺少 aid/bvid/cid）');
      const title = String(data.title || document.title || 'bilibili').trim();
      const part = String(page?.part || '').trim();
      this.#log.debug('video info from view api');
      const fullPages = pages.map((pg, idx) => ({ p: idx + 1, cid: pg?.cid, part: String(pg?.part || '').trim() })).filter((x) => x?.cid);
      return { kind: 'video', aid: data.aid, bvid: data.bvid, cid, p, title, part, pages: fullPages, referrer: location.href };
    }
    async getBangumiInfo(http) {
      const path = location.pathname || '';
      const epMatch = path.match(/\/bangumi\/play\/ep(\d+)/);
      const ssMatch = path.match(/\/bangumi\/play\/ss(\d+)/);
      const epid = epMatch ? parseInt(epMatch[1], 10) : 0;
      const sid = ssMatch ? parseInt(ssMatch[1], 10) : 0;
      if (!epid && !sid) throw new AppError('fatal', '未识别到番剧 ep_id/season_id');

      const url = `https://api.bilibili.com/pgc/view/web/ep/list?season_id=${sid || ''}&ep_id=${epid || ''}`;
      const res = await http.getJson(url, { retries: 1 });
      const rawList = res?.result?.episodes || res?.data?.episodes || [];
      const episodes = (Array.isArray(rawList) ? rawList : []).map((e) => ({ id: e?.id, aid: e?.aid, bvid: e?.bvid || '', cid: e?.cid, title: e?.title, long_title: e?.long_title, badge: e?.badge, badge_type: e?.badge_type })).filter((e) => e?.id && e?.aid && e?.cid);
      const seasonTitle = String(res?.result?.season_title || res?.result?.title || '').trim();
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const stateEpid = pageWindow.__INITIAL_STATE__?.epInfo?.id || pageWindow.__INITIAL_STATE__?.epInfo?.ep_id || 0;
      const targetEpid = epid || Number(stateEpid) || 0;
      const hit = episodes.find((e) => (targetEpid ? e.id === targetEpid : true)) || episodes[0];
      if (!hit?.cid || !hit?.aid) throw new AppError('fatal', '番剧信息解析失败（缺少 cid/aid）');
      const title = [seasonTitle, hit.long_title || hit.title].filter(Boolean).join(' ');
      return {
        kind: 'bangumi',
        aid: hit.aid,
        bvid: hit.bvid || '',
        cid: hit.cid,
        epid: hit.id,
        sid: sid || res?.result?.season_id || res?.result?.season?.season_id || 0,
        seasonTitle: seasonTitle || '',
        episodes,
        title: title.trim() || 'bilibili-bangumi',
        referrer: location.href
      };
    }

    async getCheeseInfo(http) {
      const path = location.pathname || '';
      const epMatch = path.match(/\/cheese\/play\/ep(\d+)/);
      const ssMatch = path.match(/\/cheese\/play\/ss(\d+)/);
      const epid = epMatch ? parseInt(epMatch[1], 10) : 0;
      const sid = ssMatch ? parseInt(ssMatch[1], 10) : 0;
      if (!epid && !sid) throw new AppError('fatal', '未识别到课程 ep_id/season_id');
      const url = `https://api.bilibili.com/pugv/view/web/season?season_id=${sid || ''}&ep_id=${epid || ''}`;
      const res = await http.getJson(url, { retries: 1 });
      const data = res?.data || res?.result;
      const rawEpisodes = data?.episodes || [];
      const episodes = (Array.isArray(rawEpisodes) ? rawEpisodes : []).map((e) => ({ id: e?.id, aid: e?.aid, bvid: e?.bvid || '', cid: e?.cid, title: e?.title })).filter((e) => e?.id && e?.aid && e?.cid);
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const stateEpid = pageWindow.__INITIAL_STATE__?.epInfo?.id || pageWindow.__INITIAL_STATE__?.epInfo?.ep_id || 0;
      const targetEpid = epid || Number(stateEpid) || 0;
      const hit = episodes.find((e) => (targetEpid ? e.id === targetEpid : true)) || episodes[0];
      if (!hit?.cid || !hit?.aid) throw new AppError('fatal', '课程信息解析失败（缺少 cid/aid）');
      const seasonTitle = String(data?.title || data?.season_title || '').trim();
      const title = [seasonTitle, hit.title].filter(Boolean).join(' ');
      return {
        kind: 'cheese',
        aid: hit.aid,
        bvid: hit.bvid || '',
        cid: hit.cid,
        epid: hit.id,
        sid: sid || data?.season_id || 0,
        seasonTitle: seasonTitle || '',
        episodes,
        title: title.trim() || 'bilibili-cheese',
        referrer: location.href
      };
    }
  }

  class BiliApi {
    #http;
    #log;
    constructor(http, log) {
      this.#http = http;
      this.#log = log;
    }
    getPlayinfoFromPage() {
      try {
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const pi = pageWindow.__playinfo__;
        const data = pi?.data || pi;
        return data && typeof data === 'object' ? data : null;
      } catch {
        return null;
      }
    }
    #buildPlayurlUrl({ endpoint, aid, bvid, cid, epid, qn, format }) {
      const isMp4 = format === 'mp4';
      const isFlv = format === 'flv';
      const isDash = format === 'dash';
      const fnver = isMp4 && endpoint.includes('/pugv/') ? 1 : 0;
      const fnval = isDash ? 4048 : isFlv ? 4049 : endpoint.includes('/pugv/') ? 80 : 0;
      const type = isDash ? 'dash' : isFlv ? 'flv' : 'mp4';
      const qs = new URLSearchParams();
      qs.set('avid', String(aid || 0));
      if (bvid) qs.set('bvid', String(bvid));
      qs.set('cid', String(cid || 0));
      qs.set('qn', String(qn || 80));
      qs.set('fnver', String(fnver));
      qs.set('fnval', String(fnval));
      qs.set('fourk', '1');
      qs.set('otype', 'json');
      if (epid) qs.set('ep_id', String(epid));
      if (!endpoint.includes('/x/player/')) qs.set('type', type);
      if (isMp4 && !endpoint.includes('/pugv/')) {
        qs.set('type', 'mp4');
        qs.set('platform', 'html5');
        qs.set('high_quality', '1');
      }
      return `${endpoint}?${qs.toString()}`;
    }

    async playurl({ kind, aid, bvid, cid, epid, qn, format }) {
      const endpoint =
        kind === 'bangumi'
          ? 'https://api.bilibili.com/pgc/player/web/playurl'
          : kind === 'cheese'
            ? 'https://api.bilibili.com/pugv/player/web/playurl'
            : 'https://api.bilibili.com/x/player/playurl';
      const url = this.#buildPlayurlUrl({ endpoint, aid, bvid, cid, epid, qn, format });
      return this.#http.getJsonWithFallback([url], {});
    }

    async playurlBangumiV2({ sid, qn, format }) {
      const endpoint = 'https://api.bilibili.com/pgc/player/web/v2/playurl';
      const qs = new URLSearchParams();
      qs.set('support_multi_audio', 'true');
      qs.set('qn', String(qn || 80));
      qs.set('fnver', '0');
      qs.set('fnval', format === 'dash' ? '4048' : format === 'flv' ? '4049' : '0');
      qs.set('fourk', '1');
      qs.set('gaia_source', '');
      qs.set('from_client', 'BROWSER');
      qs.set('is_main_page', 'true');
      qs.set('need_fragment', 'true');
      qs.set('season_id', String(sid || 0));
      qs.set('isGaiaAvoided', 'false');
      qs.set('voice_balance', '1');
      qs.set('drm_tech_type', '2');
      return this.#http.getJsonWithFallback([`${endpoint}?${qs.toString()}`], {});
    }

    normalizePlayurl(res) {
      const data = res?.data || res?.result;
      if (!data) throw new AppError('recoverable', '接口返回空数据');
      if (res?.code && res.code !== 0) throw new AppError('recoverable', `接口错误：${res.message || res.code}`, { code: res.code, message: res.message });
      return data;
    }
    replaceCdn(url, hostKey) {
      const key = String(hostKey || '0');
      if (key === '0') return url;
      const mapping = HOST_MAP[key];
      if (!mapping || typeof mapping !== 'string' || mapping.includes('不替换') || mapping.includes('未发现')) return url;
      try {
        const u = new URL(url);
        u.host = mapping;
        return u.toString();
      } catch {
        const parts = String(url || '').split('/');
        if (parts.length > 2) parts[2] = mapping;
        return parts.join('/');
      }
    }

    pickDash(data, { qn, preferCodec = 'auto', preferAudio = 'best', hostKey = '0' }) {
      const dash = data?.dash;
      if (!dash) throw new AppError('recoverable', '未返回 DASH（可能需要登录/大会员/或接口限制）');
      const videos = Array.isArray(dash.video) ? dash.video : [];
      const audios = Array.isArray(dash.audio) ? dash.audio : [];
      if (!videos.length) throw new AppError('recoverable', '未返回视频流');
      if (!audios.length) this.#log.warn('未返回音频流（可能为仅视频）');

      const normUrl = (x) => x?.baseUrl || x?.base_url || '';
      const normBackup = (x) => (Array.isArray(x?.backupUrl) ? x.backupUrl : x?.backup_url) || [];
      const codecScore = (codecs, prefer) => {
        const c = String(codecs || '');
        if (prefer === 'hev') return c.includes('hev') ? 2 : 0;
        if (prefer === 'avc') return c.includes('avc') ? 2 : 0;
        return c.includes('hev') ? 1 : 1;
      };

      const q = Number(qn) || Number(data?.quality) || 80;
      const candidates = videos.filter((v) => Number(v.id) <= q).length ? videos.filter((v) => Number(v.id) <= q) : videos;
      const pickedVideo = [...candidates].sort((a, b) => (Number(b.id) - Number(a.id)) || (codecScore(b.codecs, preferCodec) - codecScore(a.codecs, preferCodec)))[0];
      const pickedAudio =
        preferAudio === 'first'
          ? audios[0]
          : [...audios].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0] || null;

      const acceptQuality = Array.isArray(data?.accept_quality) ? data.accept_quality : [];
      const acceptDesc = Array.isArray(data?.accept_description) ? data.accept_description : [];

      return {
        quality: data?.quality,
        acceptQuality,
        acceptDesc,
        videoList: videos.map((v) => ({
          id: v.id,
          codecs: v.codecs,
          width: v.width,
          height: v.height,
          baseUrl: this.replaceCdn(normUrl(v), hostKey),
          backupUrl: normBackup(v).map((u) => this.replaceCdn(u, hostKey))
        })),
        audioList: audios.map((a) => ({
          id: a.id,
          codecs: a.codecs,
          bandwidth: a.bandwidth,
          baseUrl: this.replaceCdn(normUrl(a), hostKey),
          backupUrl: normBackup(a).map((u) => this.replaceCdn(u, hostKey))
        })),
        picked: {
          video: pickedVideo
            ? {
              id: pickedVideo.id,
              codecs: pickedVideo.codecs,
              width: pickedVideo.width,
              height: pickedVideo.height,
              baseUrl: this.replaceCdn(normUrl(pickedVideo), hostKey),
              backupUrl: normBackup(pickedVideo).map((u) => this.replaceCdn(u, hostKey))
            }
            : null,
          audio: pickedAudio
            ? {
              id: pickedAudio.id,
              codecs: pickedAudio.codecs,
              bandwidth: pickedAudio.bandwidth,
              baseUrl: this.replaceCdn(normUrl(pickedAudio), hostKey),
              backupUrl: normBackup(pickedAudio).map((u) => this.replaceCdn(u, hostKey))
            }
            : null
        }
      };
    }

    pickDurl(data, { hostKey = '0' }) {
      const list = Array.isArray(data?.durl) ? data.durl : [];
      if (!list.length) throw new AppError('recoverable', '未返回 durl（可能需要更换格式/登录态/权限不足）');
      const urls = list.map((x) => this.replaceCdn(x?.url || '', hostKey)).filter(Boolean);
      const backup = list.map((x) => (x?.backup_url?.[0] ? this.replaceCdn(x.backup_url[0], hostKey) : '')).filter(Boolean);
      return { urls, backup };
    }

    async getSubtitleVtt({ aid, cid, epid }) {
      const url = `https://api.bilibili.com/x/player/v2?aid=${encodeURIComponent(String(aid || 0))}&cid=${encodeURIComponent(String(cid || 0))}&ep_id=${encodeURIComponent(String(epid || 0))}`;
      const res = await this.#http.getJson(url, { retries: 1 });
      if (res?.code !== 0) throw new AppError('recoverable', `字幕接口失败：${res?.message || res?.code || 'unknown'}`);
      const subtitleUrl = res?.data?.subtitle?.subtitles?.[0]?.subtitle_url;
      if (!subtitleUrl) return null;
      const subUrl = String(subtitleUrl || '').startsWith('//') ? `https:${subtitleUrl}` : String(subtitleUrl || '');
      const sub = await this.#http.getJson(subUrl, { retries: 1 });
      const body = Array.isArray(sub?.body) ? sub.body : [];
      if (!body.length) return null;
      let vtt = 'WEBVTT\n\n';
      for (const item of body) {
        const from = Number(item?.from) || 0;
        const to = Number(item?.to) || 0;
        const text = String(item?.content || '').trim();
        if (!text) continue;
        vtt += `${vttTime(from)} --> ${vttTime(to)}\n${text}\n\n`;
      }
      return vtt;
    }

    async getDanmakuXml(cid) {
      const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(String(cid || 0))}`;
      return await this.#http.getText(url, { retries: 1 });
    }
  }

  const vttTime = (sec) => {
    const t = Math.max(0, Number(sec) || 0);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t - Math.floor(t)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  class DownloadManager {
    #cfgRef;
    #http;
    constructor(cfgRef, http) {
      this.#cfgRef = cfgRef;
      this.#http = http;
    }
    buildAria2cHeader(referrer) {
      return `--header "User-Agent: ${navigator.userAgent}" --header "Referer: ${referrer}"`;
    }
    buildAria2cConnectionParams(level) {
      const map = { min: [1, 5], mid: [16, 8], max: [32, 16] };
      const [urlMax, serverMax] = map[level] || map.min;
      return `--max-concurrent-downloads ${urlMax} --max-connection-per-server ${serverMax}`;
    }
    buildCommands({ title, referrer, format, dashPicked, durlUrls, aria2cLevel, aria2cExtra }) {
      const name = sanitizeFilename(title);
      const header = this.buildAria2cHeader(referrer);
      const conn = this.buildAria2cConnectionParams(aria2cLevel);
      const extra = String(aria2cExtra || '').trim();
      const tail = [header, conn, extra].filter(Boolean).join(' ');
      if (format === 'dash' && dashPicked?.video?.baseUrl) {
        const vOut = `${name}.video.m4s`;
        const aOut = dashPicked.audio?.baseUrl ? `${name}.audio.m4s` : '';
        const aria2Video = `aria2c "${dashPicked.video.baseUrl}" --out "${vOut}" ${tail}`;
        const aria2Audio = dashPicked.audio?.baseUrl ? `aria2c "${dashPicked.audio.baseUrl}" --out "${aOut}" ${tail}` : '';
        const ffmpeg = dashPicked.audio?.baseUrl ? `ffmpeg -i "${vOut}" -i "${aOut}" -c copy "${name}.mp4"` : `ffmpeg -i "${vOut}" -c copy "${name}.mp4"`;
        return { aria2: [aria2Video, aria2Audio].filter(Boolean).join('\n'), ffmpeg };
      }
      const urls = Array.isArray(durlUrls) ? durlUrls.filter(Boolean) : [];
      const ext = format === 'flv' ? 'flv' : 'mp4';
      if (urls.length === 1) {
        const out = `${name}.${ext}`;
        const aria2 = `aria2c "${urls[0]}" --out "${out}" ${tail}`;
        const ffmpeg = `ffmpeg -i "${out}" -c copy "${name}.mp4"`;
        return { aria2, ffmpeg };
      }
      const cmds = urls.map((u, i) => `aria2c "${u}" --out "${name}.part${String(i + 1).padStart(3, '0')}.${ext}" ${tail}`).join('\n');
      const hint = `# 多分段请用 ffmpeg concat 合并：\n# 1) 生成 list.txt: file 'xxx.part001.${ext}' ...\n# 2) ffmpeg -f concat -safe 0 -i list.txt -c copy "${name}.mp4"`;
      return { aria2: cmds, ffmpeg: hint };
    }
    async sendAria2Rpc(tasks) {
      const rpc = this.#cfgRef().download.rpc;
      const domain = String(rpc.domain || '').replace(/\/+$/, '');
      const port = String(rpc.port || '');
      if (!domain || !port) throw new AppError('fatal', 'RPC配置缺失（domain/port）');
      const endpoint = `${domain}:${port}/jsonrpc`;
      const token = String(rpc.token || '');
      const dir = String(rpc.dir || '').trim();
      const payload = (tasks || []).map((t) => ({
        id: btoa(`AnkBili_${Date.now()}_${Math.random()}`),
        jsonrpc: '2.0',
        method: 'aria2.addUri',
        params: [
          ...(token ? [`token:${token}`] : []),
          [String(t.url)],
          {
            out: String(t.out || ''),
            ...(dir || t.dir ? { dir: String(t.dir || dir) } : {}),
            header: [`User-Agent: ${navigator.userAgent}`, `Referer: ${String(t.referrer || location.href)}`]
          }
        ]
      }));
      const res = await this.#http.postJson(endpoint, payload, { retries: 1, timeoutMs: 8000 });
      return res;
    }
    async downloadBlob(url, filename) {
      const blob = await this.#http.getBlob(url, { retries: 1, timeoutMs: 30000 });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    }
  }

  class UI {
    #cfgRef;
    #rootEl;
    #shadow;
    #state;
    constructor(cfgRef) {
      this.#cfgRef = cfgRef;
      const cfg = this.#cfgRef();
      this.#rootEl = null;
      this.#shadow = null;
      this.#state = {
        open: !cfg.uiStartCollapsed,
        busy: false,
        kind: 'unknown',
        title: '',
        qn: cfg.parse.defaultQn,
        format: cfg.parse.format,
        hostKey: cfg.parse.hostKey,
        preferCodec: cfg.parse.preferCodec,
        preferAudio: cfg.parse.preferAudio,
        downloadMethod: cfg.download.method,
        rpcDomain: cfg.download.rpc.domain,
        rpcPort: cfg.download.rpc.port,
        rpcToken: cfg.download.rpc.token,
        rpcDir: cfg.download.rpc.dir,
        aria2cLevel: cfg.download.aria2cConnectionLevel,
        aria2cExtra: cfg.download.aria2cExtra,
        accept: [],
        out: { video: '', audio: '', cmd: '', subtitle: '', danmaku: '', danmakuAss: '' },
        msg: ''
      };
    }
    mount() {
      const cfg = this.#cfgRef();
      if (!cfg.uiEnabled) return;
      if (document.getElementById(APP.id)) return;
      const host = document.createElement('div');
      host.id = APP.id;
      host.style.position = 'fixed';
      host.style.right = '16px';
      host.style.bottom = '16px';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'auto';
      document.documentElement.appendChild(host);
      this.#rootEl = host;
      const mode = cfg.debug ? 'open' : 'closed';
      this.#shadow = host.attachShadow({ mode });
      this.#render();
    }
    setBusy(busy) {
      this.#state.busy = !!busy;
      this.#render();
    }
    setMessage(msg) {
      this.#state.msg = String(msg || '').trim();
      this.#render();
    }
    setContext({ kind, title, qn, format }) {
      this.#state.kind = kind || 'unknown';
      this.#state.title = String(title || '').trim();
      if (Number.isFinite(+qn)) this.#state.qn = +qn;
      if (format) this.#state.format = String(format);
      this.#render();
    }
    setResult({ accept, out }) {
      this.#state.accept = Array.isArray(accept) ? accept : [];
      this.#state.out = out ? { ...this.#state.out, ...out } : this.#state.out;
      this.#render();
    }
    getQn() {
      return this.#state.qn;
    }
    getForm() {
      return {
        qn: this.#state.qn,
        format: this.#state.format,
        hostKey: this.#state.hostKey,
        preferCodec: this.#state.preferCodec,
        preferAudio: this.#state.preferAudio,
        downloadMethod: this.#state.downloadMethod,
        rpc: { domain: this.#state.rpcDomain, port: this.#state.rpcPort, token: this.#state.rpcToken, dir: this.#state.rpcDir },
        aria2c: { level: this.#state.aria2cLevel, extra: this.#state.aria2cExtra }
      };
    }
    getOut() {
      return { ...this.#state.out };
    }
    getOutText(key) {
      return String(this.#state.out?.[key] || '');
    }
    setOut(patch) {
      this.#state.out = { ...this.#state.out, ...(patch || {}) };
      this.#render();
    }
    getAcceptQuality() {
      return Array.isArray(this.#state.accept) ? [...this.#state.accept] : [];
    }
    on(event, handler) {
      if (!this.#shadow) return;
      this.#shadow.addEventListener(event, (e) => handler(e));
    }
    #toggle() {
      this.#state.open = !this.#state.open;
      this.#render();
    }
    #render() {
      if (!this.#shadow) return;
      const s = this.#state;
      const acceptOptions = s.accept.length
        ? s.accept.map((q) => `<option value="${q}" ${String(q) === String(s.qn) ? 'selected' : ''}>${q} ${QUALITY_LABEL[q] ? `(${QUALITY_LABEL[q]})` : ''}</option>`).join('')
        : `<option value="${s.qn}">${s.qn} ${QUALITY_LABEL[s.qn] ? `(${QUALITY_LABEL[s.qn]})` : ''}</option>`;

      const disabled = s.busy ? 'disabled' : '';
      const msg = s.msg ? `<div class="msg">${escapeHtml(s.msg)}</div>` : '';
      const formatOptions = Object.entries(FORMAT_LABEL)
        .map(([k, v]) => `<option value="${k}" ${k === s.format ? 'selected' : ''}>${escapeHtml(v)}</option>`)
        .join('');
      const hostOptions = Object.entries(HOST_MAP)
        .map(([k, v]) => `<option value="${k}" ${k === s.hostKey ? 'selected' : ''}>${escapeHtml(`${k} - ${v}`)}</option>`)
        .join('');
      const methodOptions = [
        ['copy', '仅复制(命令/链接)'],
        ['aria', '生成aria2/ffmpeg命令'],
        ['rpc', '发送到aria2 RPC'],
        ['blob', 'Blob下载(浏览器保存)'],
        ['browser', '浏览器打开链接']
      ]
        .map(([k, v]) => `<option value="${k}" ${k === s.downloadMethod ? 'selected' : ''}>${escapeHtml(v)}</option>`)
        .join('');

      this.#shadow.innerHTML = `
        <style>
          :host{all:initial}
          .btn{all:unset;cursor:pointer;user-select:none}
          .fab{width:44px;height:44px;border-radius:999px;background:#00a1d6;color:#fff;display:grid;place-items:center;box-shadow:0 10px 22px rgba(0,0,0,.18);font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei";letter-spacing:.5px}
          .panel{width:min(360px,calc(100vw - 24px));max-height:min(80vh,760px);background:#111827;color:#e5e7eb;border:1px solid rgba(255,255,255,.08);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;font:12px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei"}
          .row{display:flex;gap:8px;align-items:center}
          .head{padding:10px 12px;background:rgba(255,255,255,.04);display:flex;justify-content:space-between;align-items:center}
          .title{font-weight:700;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .body{padding:10px 12px;display:flex;flex-direction:column;gap:10px;overflow:auto}
          .label{opacity:.85}
          select,textarea{width:100%;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:8px 10px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
          textarea{min-height:52px;resize:vertical}
          .mini{padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.08)}
          .actions{display:flex;gap:8px;flex-wrap:wrap}
          .pbtn{all:unset;cursor:pointer;padding:8px 10px;border-radius:10px;background:#00a1d6;color:#fff;font-weight:700}
          .sbtn{all:unset;cursor:pointer;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.10);color:#e5e7eb}
          .pbtn:disabled,.sbtn:disabled{opacity:.5;cursor:not-allowed}
          .msg{padding:8px 10px;border-radius:10px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.25);color:#fde68a;word-break:break-word}
          .hint{opacity:.7}
          .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
          .field{display:flex;flex-direction:column;gap:6px}
          .field input{width:100%;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:8px 10px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
        </style>
        <div>
          ${s.open ? `
            <div class="panel">
              <div class="head">
                <div class="title" title="${escapeHtml(s.title || '')}">B站下载（Ank）</div>
                <button class="btn sbtn" data-act="toggle">收起</button>
              </div>
              <div class="body">
                ${msg}
                <div class="grid">
                  <div class="field">
                    <div class="label">格式</div>
                    <select data-bind="format" ${disabled}>${formatOptions}</select>
                  </div>
                  <div class="field">
                    <div class="label">清晰度</div>
                    <select data-bind="qn" ${disabled}>${acceptOptions}</select>
                  </div>
                </div>
                <div class="grid">
                  <div class="field">
                    <div class="label">CDN</div>
                    <select data-bind="hostKey" ${disabled}>${hostOptions}</select>
                  </div>
                  <div class="field">
                    <div class="label">下载方式</div>
                    <select data-bind="downloadMethod" ${disabled}>${methodOptions}</select>
                  </div>
                </div>
                <div class="grid">
                  <div class="field">
                    <div class="label">视频编码偏好</div>
                    <select data-bind="preferCodec" ${disabled}>
                      <option value="auto" ${s.preferCodec === 'auto' ? 'selected' : ''}>自动</option>
                      <option value="avc" ${s.preferCodec === 'avc' ? 'selected' : ''}>H.264(avc)</option>
                      <option value="hev" ${s.preferCodec === 'hev' ? 'selected' : ''}>H.265(hev)</option>
                    </select>
                  </div>
                  <div class="field">
                    <div class="label">音频偏好</div>
                    <select data-bind="preferAudio" ${disabled}>
                      <option value="best" ${s.preferAudio === 'best' ? 'selected' : ''}>最高码率</option>
                      <option value="first" ${s.preferAudio === 'first' ? 'selected' : ''}>第一个</option>
                    </select>
                  </div>
                </div>
                <div class="actions">
                  <button class="pbtn" data-act="fetch" ${disabled}>解析/刷新</button>
                  <button class="sbtn" data-act="subtitle" ${disabled}>字幕</button>
                  <button class="sbtn" data-act="danmaku" ${disabled}>弹幕</button>
                  <button class="sbtn" data-act="batch_rpc" ${disabled}>批量RPC</button>
                  <button class="sbtn" data-act="copy_all" ${disabled}>复制全部</button>
                  <button class="sbtn" data-act="toggle">最小化</button>
                </div>
                <div class="mini">
                  <div class="label">视频URL</div>
                  <textarea readonly data-out="video">${escapeHtml(s.out.video || '')}</textarea>
                  <div class="actions">
                    <button class="sbtn" data-act="copy_video" ${disabled}>复制视频</button>
                    <button class="sbtn" data-act="open_video" ${disabled}>打开</button>
                  </div>
                </div>
                <div class="mini">
                  <div class="label">音频URL</div>
                  <textarea readonly data-out="audio">${escapeHtml(s.out.audio || '')}</textarea>
                  <div class="actions">
                    <button class="sbtn" data-act="copy_audio" ${disabled}>复制音频</button>
                    <button class="sbtn" data-act="open_audio" ${disabled}>打开</button>
                  </div>
                </div>
                <div class="mini">
                  <div class="label">命令</div>
                  <textarea readonly data-out="cmd">${escapeHtml(s.out.cmd || '')}</textarea>
                  <div class="actions">
                    <button class="sbtn" data-act="copy_cmd" ${disabled}>复制命令</button>
                    <button class="sbtn" data-act="rpc_send" ${disabled}>RPC发送</button>
                    <button class="sbtn" data-act="blob_video" ${disabled}>Blob视频</button>
                    <button class="sbtn" data-act="blob_audio" ${disabled}>Blob音频</button>
                  </div>
                </div>
                <div class="mini">
                  <div class="label">字幕(VTT)</div>
                  <textarea readonly data-out="subtitle">${escapeHtml(s.out.subtitle || '')}</textarea>
                  <div class="actions">
                    <button class="sbtn" data-act="copy_subtitle" ${disabled}>复制字幕</button>
                    <button class="sbtn" data-act="download_subtitle" ${disabled}>下载字幕</button>
                  </div>
                </div>
                <div class="mini">
                  <div class="label">弹幕(XML)</div>
                  <textarea readonly data-out="danmaku">${escapeHtml(s.out.danmaku || '')}</textarea>
                  <div class="actions">
                    <button class="sbtn" data-act="copy_danmaku" ${disabled}>复制弹幕</button>
                    <button class="sbtn" data-act="download_danmaku_xml" ${disabled}>下载XML</button>
                    <button class="sbtn" data-act="convert_danmaku_ass" ${disabled}>转换ASS</button>
                  </div>
                </div>
                <div class="mini">
                  <div class="label">弹幕(ASS)</div>
                  <textarea readonly data-out="danmakuAss">${escapeHtml(s.out.danmakuAss || '')}</textarea>
                  <div class="actions">
                    <button class="sbtn" data-act="copy_danmaku_ass" ${disabled}>复制ASS</button>
                    <button class="sbtn" data-act="download_danmaku_ass" ${disabled}>下载ASS</button>
                  </div>
                </div>
                <div class="mini">
                  <div class="label">RPC配置</div>
                  <div class="grid">
                    <div class="field"><div class="label">Domain</div><input data-bind="rpcDomain" placeholder="http://localhost" value="${escapeHtml(s.rpcDomain || '')}" /></div>
                    <div class="field"><div class="label">Port</div><input data-bind="rpcPort" placeholder="6800" value="${escapeHtml(s.rpcPort || '')}" /></div>
                  </div>
                  <div class="grid">
                    <div class="field"><div class="label">Token</div><input data-bind="rpcToken" placeholder="可为空" value="${escapeHtml(s.rpcToken || '')}" /></div>
                    <div class="field"><div class="label">Dir</div><input data-bind="rpcDir" placeholder="可为空" value="${escapeHtml(s.rpcDir || '')}" /></div>
                  </div>
                  <div class="grid">
                    <div class="field">
                      <div class="label">aria2连接级别</div>
                      <select data-bind="aria2cLevel" ${disabled}>
                        <option value="min" ${s.aria2cLevel === 'min' ? 'selected' : ''}>min</option>
                        <option value="mid" ${s.aria2cLevel === 'mid' ? 'selected' : ''}>mid</option>
                        <option value="max" ${s.aria2cLevel === 'max' ? 'selected' : ''}>max</option>
                      </select>
                    </div>
                    <div class="field"><div class="label">aria2附加参数</div><input data-bind="aria2cExtra" placeholder="--split 16 ..." value="${escapeHtml(s.aria2cExtra || '')}" /></div>
                  </div>
                  <div class="actions">
                    <button class="sbtn" data-act="save_cfg" ${disabled}>保存配置</button>
                  </div>
                </div>
              </div>
            </div>
          ` : `<button class="btn fab" data-act="toggle" title="打开下载面板">DL</button>`}
        </div>
      `;

      const bindSet = (key, parser) => {
        const el = this.#shadow.querySelector(`[data-bind="${key}"]`);
        if (!el) return;
        el.onchange = el.oninput = (e) => {
          const v = parser ? parser(e.target.value) : e.target.value;
          this.#state[key] = v;
        };
      };
      bindSet('qn', (v) => (Number.isFinite(+v) ? +v : this.#state.qn));
      bindSet('format', (v) => String(v || 'dash'));
      bindSet('hostKey', (v) => String(v || '0'));
      bindSet('preferCodec', (v) => String(v || 'auto'));
      bindSet('preferAudio', (v) => String(v || 'best'));
      bindSet('downloadMethod', (v) => String(v || 'copy'));
      bindSet('rpcDomain', (v) => String(v || ''));
      bindSet('rpcPort', (v) => String(v || ''));
      bindSet('rpcToken', (v) => String(v || ''));
      bindSet('rpcDir', (v) => String(v || ''));
      bindSet('aria2cLevel', (v) => String(v || 'min'));
      bindSet('aria2cExtra', (v) => String(v || ''));

      const handler = (act) => {
        if (act === 'toggle') this.#toggle();
        this.#shadow.dispatchEvent(new CustomEvent('ank-action', { bubbles: true, composed: true, detail: { act } }));
      };
      this.#shadow.querySelectorAll('[data-act]').forEach((el) => {
        el.onclick = () => handler(el.getAttribute('data-act'));
      });
    }
  }

  const main = async () => {
    const storage = new StorageService(APP.storeKey);
    const config = new ConfigService(storage);
    const log = new Logger(config.get().debug);
    const http = new GMHttp(config.get(), log);
    const ctx = new BiliContext(log);
    const api = new BiliApi(http, log);
    const dm = new DownloadManager(() => config.get(), http);
    const ui = new UI(() => config.get());

    ui.mount();
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand(`切换UI（当前：${config.get().uiEnabled ? '开' : '关'}）`, () => {
        config.update({ uiEnabled: !config.get().uiEnabled });
        location.reload();
      });
      GM_registerMenuCommand(`切换调试（当前：${config.get().debug ? '开' : '关'}）`, () => {
        config.update({ debug: !config.get().debug });
        location.reload();
      });
      GM_registerMenuCommand('重置配置（AnkBiliDownloader）', () => {
        config.reset();
        location.reload();
      });
    }

    const detected = ctx.detect();
    ui.setContext({ kind: detected.kind, title: document.title, qn: config.get().parse.defaultQn, format: config.get().parse.format });

    const tryAutoQuality = async () => {
      const aq = config.get().autoQuality;
      if (!aq?.enabled) return;
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const player = await waitFor(() => pageWindow.player, 5000);
      if (!player?.getSupportedQualityList || !player?.requestQuality) return;
      const list = player.getSupportedQualityList() || [];
      const target = aq.target === 'highest' ? Math.max(...list) : Number(aq.target) || 0;
      if (!target || !list.includes(target)) return;
      const now = player.getQuality?.().nowQ;
      if (Number(now) === Number(target)) return;
      player.requestQuality(target);
      log.debug('auto quality applied:', target);
    };

    const fetchOnce = async () => {
      ui.setBusy(true);
      ui.setMessage('');
      try {
        const kind = ctx.detect().kind;
        const form = ui.getForm();
        config.update({
          parse: { defaultQn: form.qn, format: form.format, hostKey: form.hostKey, preferCodec: form.preferCodec, preferAudio: form.preferAudio },
          download: { method: form.downloadMethod, aria2cConnectionLevel: form.aria2c.level, aria2cExtra: form.aria2c.extra, rpc: form.rpc }
        });
        const qn = form.qn || config.get().parse.defaultQn;
        const format = form.format || config.get().parse.format;
        const hostKey = form.hostKey || config.get().parse.hostKey;
        if (kind === 'video') {
          const info = await ctx.getVideoInfo(http);
          ui.setContext({ kind, title: info.part ? `${info.title} / ${info.part}` : info.title, qn, format });
          let data;
          try {
            const res = await api.playurl({ kind, aid: info.aid, bvid: info.bvid, cid: info.cid, qn, format });
            data = api.normalizePlayurl(res);
          } catch (e) {
            const pi = api.getPlayinfoFromPage();
            if (!pi) throw e;
            log.warn('playurl接口失败，改用页面 __playinfo__ 回退');
            data = pi;
          }
          if (format === 'dash' && data?.dash) {
            const picked = api.pickDash(data, { qn, preferCodec: form.preferCodec, preferAudio: form.preferAudio, hostKey });
            const cmd = dm.buildCommands({ title: info.part ? `${info.title} - ${info.part}` : info.title, referrer: info.referrer, format, dashPicked: picked.picked, aria2cLevel: form.aria2c.level, aria2cExtra: form.aria2c.extra });
            ui.setResult({ accept: picked.acceptQuality, out: { video: [picked.picked.video?.baseUrl, picked.picked.video?.backupUrl?.[0]].filter(Boolean).join('\n'), audio: [picked.picked.audio?.baseUrl, picked.picked.audio?.backupUrl?.[0]].filter(Boolean).join('\n'), cmd: [cmd.aria2, cmd.ffmpeg].filter(Boolean).join('\n\n'), subtitle: '', danmaku: '', danmakuAss: '' } });
          } else {
            const durl = api.pickDurl(data, { hostKey });
            const cmd = dm.buildCommands({ title: info.part ? `${info.title} - ${info.part}` : info.title, referrer: info.referrer, format, durlUrls: durl.urls, aria2cLevel: form.aria2c.level, aria2cExtra: form.aria2c.extra });
            ui.setResult({ accept: Array.isArray(data?.accept_quality) ? data.accept_quality : [], out: { video: durl.urls.join('\n'), audio: '', cmd: [cmd.aria2, cmd.ffmpeg].filter(Boolean).join('\n\n'), subtitle: '', danmaku: '', danmakuAss: '' } });
          }
          await tryAutoQuality();
          return;
        }
        if (kind === 'bangumi') {
          const info = await ctx.getBangumiInfo(http);
          ui.setContext({ kind, title: info.title, qn, format });
          let data;
          try {
            const res = await api.playurl({ kind, aid: info.aid, bvid: info.bvid, cid: info.cid, epid: info.epid, qn, format });
            data = api.normalizePlayurl(res);
          } catch (e) {
            if (!info.sid) throw e;
            log.warn('bangumi playurl失败，尝试v2接口');
            const res2 = await api.playurlBangumiV2({ sid: info.sid, qn, format });
            data = api.normalizePlayurl(res2);
          }
          if (format === 'dash' && data?.dash) {
            const picked = api.pickDash(data, { qn, preferCodec: form.preferCodec, preferAudio: form.preferAudio, hostKey });
            const cmd = dm.buildCommands({ title: info.title, referrer: info.referrer, format, dashPicked: picked.picked, aria2cLevel: form.aria2c.level, aria2cExtra: form.aria2c.extra });
            ui.setResult({ accept: picked.acceptQuality, out: { video: [picked.picked.video?.baseUrl, picked.picked.video?.backupUrl?.[0]].filter(Boolean).join('\n'), audio: [picked.picked.audio?.baseUrl, picked.picked.audio?.backupUrl?.[0]].filter(Boolean).join('\n'), cmd: [cmd.aria2, cmd.ffmpeg].filter(Boolean).join('\n\n'), subtitle: '', danmaku: '', danmakuAss: '' } });
          } else {
            const durl = api.pickDurl(data, { hostKey });
            const cmd = dm.buildCommands({ title: info.title, referrer: info.referrer, format, durlUrls: durl.urls, aria2cLevel: form.aria2c.level, aria2cExtra: form.aria2c.extra });
            ui.setResult({ accept: Array.isArray(data?.accept_quality) ? data.accept_quality : [], out: { video: durl.urls.join('\n'), audio: '', cmd: [cmd.aria2, cmd.ffmpeg].filter(Boolean).join('\n\n'), subtitle: '', danmaku: '', danmakuAss: '' } });
          }
          await tryAutoQuality();
          return;
        }
        if (kind === 'cheese') {
          const info = await ctx.getCheeseInfo(http);
          ui.setContext({ kind, title: info.title, qn, format });
          const res = await api.playurl({ kind, aid: info.aid, bvid: info.bvid, cid: info.cid, epid: info.epid, qn, format });
          const data = api.normalizePlayurl(res);
          if (format === 'dash' && data?.dash) {
            const picked = api.pickDash(data, { qn, preferCodec: form.preferCodec, preferAudio: form.preferAudio, hostKey });
            const cmd = dm.buildCommands({ title: info.title, referrer: info.referrer, format, dashPicked: picked.picked, aria2cLevel: form.aria2c.level, aria2cExtra: form.aria2c.extra });
            ui.setResult({ accept: picked.acceptQuality, out: { video: [picked.picked.video?.baseUrl, picked.picked.video?.backupUrl?.[0]].filter(Boolean).join('\n'), audio: [picked.picked.audio?.baseUrl, picked.picked.audio?.backupUrl?.[0]].filter(Boolean).join('\n'), cmd: [cmd.aria2, cmd.ffmpeg].filter(Boolean).join('\n\n'), subtitle: '', danmaku: '', danmakuAss: '' } });
          } else {
            const durl = api.pickDurl(data, { hostKey });
            const cmd = dm.buildCommands({ title: info.title, referrer: info.referrer, format, durlUrls: durl.urls, aria2cLevel: form.aria2c.level, aria2cExtra: form.aria2c.extra });
            ui.setResult({ accept: Array.isArray(data?.accept_quality) ? data.accept_quality : [], out: { video: durl.urls.join('\n'), audio: '', cmd: [cmd.aria2, cmd.ffmpeg].filter(Boolean).join('\n\n'), subtitle: '', danmaku: '', danmakuAss: '' } });
          }
          await tryAutoQuality();
          return;
        }
        throw new AppError('recoverable', '当前页面暂不支持（video / bangumi / cheese）');
      } catch (e) {
        ui.setMessage(safeMessage(e));
        log.error(e);
      } finally {
        ui.setBusy(false);
      }
    };

    ui.on('ank-action', async (e) => {
      const act = e?.detail?.act;
      if (!act) return;
      if (act === 'fetch') return void fetchOnce();
      if (act === 'save_cfg') {
        const f = ui.getForm();
        config.update({ parse: { defaultQn: f.qn, format: f.format, hostKey: f.hostKey, preferCodec: f.preferCodec, preferAudio: f.preferAudio }, download: { method: f.downloadMethod, aria2cConnectionLevel: f.aria2c.level, aria2cExtra: f.aria2c.extra, rpc: f.rpc } });
        ui.setMessage('配置已保存');
        return;
      }
      if (act === 'copy_subtitle') return void copyText(ui.getOutText('subtitle'));
      if (act === 'download_subtitle') {
        const vtt = ui.getOutText('subtitle');
        if (!vtt) return void ui.setMessage('没有字幕内容（先点“字幕”）');
        return void downloadTextFile(vtt, `${sanitizeFilename(document.title)}.vtt`, 'text/vtt');
      }
      if (act === 'copy_danmaku') return void copyText(ui.getOutText('danmaku'));
      if (act === 'download_danmaku_xml') {
        const xml = ui.getOutText('danmaku');
        if (!xml) return void ui.setMessage('没有弹幕内容（先点“弹幕”）');
        return void downloadTextFile(xml, `${sanitizeFilename(document.title)}.xml`, 'text/xml');
      }
      if (act === 'convert_danmaku_ass') {
        ui.setBusy(true);
        ui.setMessage('');
        try {
          const xml = ui.getOutText('danmaku');
          if (!xml) throw new AppError('recoverable', '没有弹幕XML（先点“弹幕”）');
          const items = parseDanmakuXml(xml);
          if (!items.length) throw new AppError('recoverable', '弹幕解析为空');
          const ass = danmakuToAss(items, { title: document.title });
          ui.setOut({ danmakuAss: ass });
          await copyText(ass);
          ui.setMessage(`ASS已生成并复制（${items.length}条）`);
        } catch (err) {
          ui.setMessage(safeMessage(err));
          log.error(err);
        } finally {
          ui.setBusy(false);
        }
        return;
      }
      if (act === 'copy_danmaku_ass') return void copyText(ui.getOutText('danmakuAss'));
      if (act === 'download_danmaku_ass') {
        const ass = ui.getOutText('danmakuAss');
        if (!ass) return void ui.setMessage('没有ASS内容（先点“转换ASS”）');
        return void downloadTextFile(ass, `${sanitizeFilename(document.title)}.ass`, 'text/plain');
      }
      if (act === 'batch_rpc') {
        ui.setBusy(true);
        ui.setMessage('');
        try {
          const kind = ctx.detect().kind;
          const f = ui.getForm();
          config.update({ download: { ...config.get().download, rpc: f.rpc } });
          const qn = f.qn || config.get().parse.defaultQn;
          const format = f.format || config.get().parse.format;
          const hostKey = f.hostKey || config.get().parse.hostKey;
          const tasks = [];
          const errs = [];
          const addOne = async ({ itemKind, aid, bvid, cid, epid, title, referrer }) => {
            const name = sanitizeFilename(title);
            const res = await api.playurl({ kind: itemKind, aid, bvid, cid, epid, qn, format });
            const data = api.normalizePlayurl(res);
            if (format === 'dash' && data?.dash) {
              const picked = api.pickDash(data, { qn, preferCodec: f.preferCodec, preferAudio: f.preferAudio, hostKey });
              const v = picked.picked.video?.baseUrl;
              const a = picked.picked.audio?.baseUrl;
              if (v) tasks.push({ url: v, out: `${name}.video.m4s`, referrer });
              if (a) tasks.push({ url: a, out: `${name}.audio.m4s`, referrer });
            } else {
              const durl = api.pickDurl(data, { hostKey });
              const ext = format === 'flv' ? 'flv' : 'mp4';
              durl.urls.forEach((u, i) => tasks.push({ url: u, out: durl.urls.length === 1 ? `${name}.${ext}` : `${name}.part${String(i + 1).padStart(3, '0')}.${ext}`, referrer }));
            }
            await sleep(200);
          };

          if (kind === 'video') {
            const info = await ctx.getVideoInfo(http);
            const pages = Array.isArray(info.pages) ? info.pages : [];
            if (pages.length <= 1) throw new AppError('recoverable', '当前视频没有分P（无需批量）');
            for (const pg of pages) {
              try {
                await addOne({ itemKind: 'video', aid: info.aid, bvid: info.bvid, cid: pg.cid, epid: 0, title: `${info.title} P${pg.p} ${pg.part || ''}`.trim(), referrer: info.referrer });
              } catch (e) {
                errs.push(`P${pg.p}: ${safeMessage(e)}`);
              }
            }
          } else if (kind === 'bangumi') {
            const info = await ctx.getBangumiInfo(http);
            const eps = Array.isArray(info.episodes) ? info.episodes : [];
            if (eps.length <= 1) throw new AppError('recoverable', '当前番剧仅1集（无需批量）');
            const pad = String(eps.length).length;
            for (let i = 0; i < eps.length; i++) {
              const ep = eps[i];
              try {
                const epNum = `EP${String(i + 1).padStart(pad, '0')}`;
                const title = `${info.seasonTitle || info.title} ${epNum} ${ep.long_title || ep.title || ''}`.replaceAll('undefined', '').replaceAll('  ', ' ').trim();
                await addOne({ itemKind: 'bangumi', aid: ep.aid, bvid: ep.bvid || '', cid: ep.cid, epid: ep.id, title, referrer: info.referrer });
              } catch (e) {
                errs.push(`EP${i + 1}: ${safeMessage(e)}`);
              }
            }
          } else if (kind === 'cheese') {
            const info = await ctx.getCheeseInfo(http);
            const eps = Array.isArray(info.episodes) ? info.episodes : [];
            if (eps.length <= 1) throw new AppError('recoverable', '当前课程仅1集（无需批量）');
            const pad = String(eps.length).length;
            for (let i = 0; i < eps.length; i++) {
              const ep = eps[i];
              try {
                const epNum = `EP${String(i + 1).padStart(pad, '0')}`;
                const title = `${info.seasonTitle || info.title} ${epNum} ${ep.title || ''}`.replaceAll('undefined', '').replaceAll('  ', ' ').trim();
                await addOne({ itemKind: 'cheese', aid: ep.aid, bvid: ep.bvid || '', cid: ep.cid, epid: ep.id, title, referrer: info.referrer });
              } catch (e) {
                errs.push(`EP${i + 1}: ${safeMessage(e)}`);
              }
            }
          } else throw new AppError('recoverable', '当前页面不支持批量RPC（video分P/bangumi/cheese）');

          if (!tasks.length) throw new AppError('recoverable', `未生成任务${errs.length ? `，失败：${errs.slice(0, 3).join(' / ')}` : ''}`);
          for (let i = 0; i < tasks.length; i += 50) await dm.sendAria2Rpc(tasks.slice(i, i + 50));
          ui.setMessage(`批量RPC已发送：${tasks.length}条${errs.length ? `（失败${errs.length}条）` : ''}`);
        } catch (err) {
          ui.setMessage(safeMessage(err));
          log.error(err);
        } finally {
          ui.setBusy(false);
        }
        return;
      }
      if (act === 'subtitle') {
        ui.setBusy(true);
        ui.setMessage('');
        try {
          const kind = ctx.detect().kind;
          const f = ui.getForm();
          const qn = f.qn || config.get().parse.defaultQn;
          const format = f.format || config.get().parse.format;
          let info;
          if (kind === 'video') info = await ctx.getVideoInfo(http);
          else if (kind === 'bangumi') info = await ctx.getBangumiInfo(http);
          else if (kind === 'cheese') info = await ctx.getCheeseInfo(http);
          else throw new AppError('recoverable', '当前页面无字幕入口');
          const vtt = await api.getSubtitleVtt({ aid: info.aid, cid: info.cid, epid: info.epid || 0 });
          if (!vtt) throw new AppError('recoverable', '未发现字幕');
          ui.setOut({ subtitle: vtt });
          await copyText(vtt);
          ui.setMessage('字幕VTT已复制，可直接保存为 .vtt');
          ui.setContext({ kind, title: info.title || document.title, qn, format });
        } catch (err) {
          ui.setMessage(safeMessage(err));
          log.error(err);
        } finally {
          ui.setBusy(false);
        }
        return;
      }
      if (act === 'danmaku') {
        ui.setBusy(true);
        ui.setMessage('');
        try {
          const kind = ctx.detect().kind;
          let info;
          if (kind === 'video') info = await ctx.getVideoInfo(http);
          else if (kind === 'bangumi') info = await ctx.getBangumiInfo(http);
          else if (kind === 'cheese') info = await ctx.getCheeseInfo(http);
          else throw new AppError('recoverable', '当前页面无弹幕入口');
          const xml = await api.getDanmakuXml(info.cid);
          if (!xml || !xml.includes('<d')) throw new AppError('recoverable', '未发现弹幕');
          ui.setOut({ danmaku: xml });
          await copyText(xml);
          ui.setMessage('弹幕XML已复制，可直接保存为 .xml（或后续转换ASS）');
        } catch (err) {
          ui.setMessage(safeMessage(err));
          log.error(err);
        } finally {
          ui.setBusy(false);
        }
        return;
      }

      const outVideo = () => ui.getOutText('video').trim();
      const outAudio = () => ui.getOutText('audio').trim();
      const outCmd = () => ui.getOutText('cmd').trim();
      if (act === 'copy_all') return void copyText([outVideo(), outAudio(), outCmd()].filter(Boolean).join('\n\n'));
      if (act === 'copy_video') return void copyText(outVideo());
      if (act === 'copy_audio') return void copyText(outAudio());
      if (act === 'copy_cmd') return void copyText(outCmd());
      if (act === 'open_video') return void openUrl(outVideo().split('\n')[0] || '');
      if (act === 'open_audio') return void openUrl(outAudio().split('\n')[0] || '');
      if (act === 'rpc_send') {
        ui.setBusy(true);
        ui.setMessage('');
        try {
          const f = ui.getForm();
          config.update({ download: { ...config.get().download, rpc: f.rpc } });
          const v = outVideo().split('\n')[0] || '';
          const a = outAudio().split('\n')[0] || '';
          const title = sanitizeFilename(document.title);
          const tasks = [];
          if (v) tasks.push({ url: v, out: `${title}.video.m4s`, referrer: location.href });
          if (a) tasks.push({ url: a, out: `${title}.audio.m4s`, referrer: location.href });
          if (!tasks.length) throw new AppError('recoverable', '当前没有可发送的URL（先解析）');
          await dm.sendAria2Rpc(tasks);
          ui.setMessage('RPC已发送（请检查aria2/Motrix）');
        } catch (err) {
          ui.setMessage(safeMessage(err));
          log.error(err);
        } finally {
          ui.setBusy(false);
        }
        return;
      }
      if (act === 'blob_video') {
        ui.setBusy(true);
        ui.setMessage('');
        try {
          const v = outVideo().split('\n')[0] || '';
          if (!v) throw new AppError('recoverable', '没有视频URL（先解析）');
          await dm.downloadBlob(v, `${sanitizeFilename(document.title)}.video`);
          ui.setMessage('已触发Blob下载（浏览器保存）');
        } catch (err) {
          ui.setMessage(safeMessage(err));
          log.error(err);
        } finally {
          ui.setBusy(false);
        }
        return;
      }
      if (act === 'blob_audio') {
        ui.setBusy(true);
        ui.setMessage('');
        try {
          const a = outAudio().split('\n')[0] || '';
          if (!a) throw new AppError('recoverable', '没有音频URL（先解析DASH）');
          await dm.downloadBlob(a, `${sanitizeFilename(document.title)}.audio`);
          ui.setMessage('已触发Blob下载（浏览器保存）');
        } catch (err) {
          ui.setMessage(safeMessage(err));
          log.error(err);
        } finally {
          ui.setBusy(false);
        }
        return;
      }
    });
  };

  main().catch((e) => console.error(`[${APP.name}] fatal:`, e));
})();
