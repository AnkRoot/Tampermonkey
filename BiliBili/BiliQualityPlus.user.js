// ==UserScript==
// @name         !.BiliQualityPlus - 画质增强 & 解锁
// @namespace    https://010314.xyz/
// @version      0.0.2
// @description  1. 解锁大会员画质试用（4K/8K/杜比）并自动续期；2. 自动切换视频/直播为最高画质（支持主/备画质）；3. 智能解码切换；4. Hi-Res/杜比音效自动开启；5. 独立的设置面板。
// @author       ank
// @license      AGPL-3.0
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @match        https://www.bilibili.com/bangumi/*
// @match        https://www.bilibili.com/festival/*
// @match        https://www.bilibili.com/watchlater/*
// @match        https://www.bilibili.com/medialist/*
// @match        https://www.bilibili.com/watchroom/*
// @match        https://www.bilibili.com/blackboard/*
// @match        https://live.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// @connect      api.bilibili.com
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/BiliBili/BiliQualityPlus.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/BiliBili/BiliQualityPlus.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- 常量定义 ---
  const CONSTANTS = {
    Q_MAP: { '8K': 127, 'Dolby': 126, 'HDR': 125, '4K': 120, '1080P60': 116, '1080P+': 112, '1080P': 80, '720P': 64, '480P': 32, '360P': 16 },
    TEXT_MAP: { '8K': ['8K', '8k'], '4K': ['4K', '4k'], '1080P+': ['高码率', '60帧', '1080P60', '1080+'], '1080P': ['1080P', '1080p', '高清'], '720P': ['720P', '720p'], '480P': ['480P', '480p'], '360P': ['360P', '360p'], 'HEVC': ['HEVC', 'H.265'], 'AVC': ['AVC', 'H.264'], 'AV1': ['AV1'] },
    VIP_QUALITIES: [127, 126, 125, 120, 116, 112], // 1080P+ 及以上为VIP画质
    QUALITY_ORDER: [127, 126, 125, 120, 116, 112, 80, 64, 32, 16] // 从高到低排序
  };

  const PERSISTED_KEYS = ['bilibili_player_codec_prefer_type', 'b_miniplayer', 'recommend_auto_play', 'bpx_player_profile'];

  class ConfigManager {
    #defaults = {
      primaryQuality: 'max',
      backupQuality: '1080P',
      liveQuality: 'max',
      codecPriority: 'HEVC',
      decodeSettingEnabled: true,
      liveCodecPriority: 'default',
      unlockTrial: true,
      unlockUA: true,
      unlockMarker: true,
      unlockHDR: true,
      preserveTouchPoints: true,
      disableHDROption: false,
      enableHiRes: true,
      enableDolby: true,
      allowDowngrade: true,
      doubleCheck: true,
      qualityDoubleCheck: true,
      liveQualityDoubleCheck: true,
      maxChecks: 10,
      idleIntervalMs: 2000,
      afterChangeDelayMs: 4000,
      waitOnQualitySwitch: false,
      useBackupQuality: true, // 新增：是否启用备用画质回退
      useHighestQualityFallback: true,
      persistPlayerSettings: true,
      injectQualityButton: false,
      takeOverQualityControl: false,
      showButton: true,
      consoleLog: false,
      // --- 开发者设置 ---
      vipStatusOverride: 'auto', // auto | normal | vip（仅影响脚本识别，不绕过权限）
      noLoginMode: false,
      allowFreeVipQualities: false,
      // --- Session Cache ---
      isLogin: false,
      isVip: false,
      vipStatusChecked: false,
      activePanelTab: 'primary' // 'primary' or 'backup'
    };

    get(key) { return GM_getValue(key, this.#defaults[key]); }
    set(key, val) { GM_setValue(key, val); }
    getAll() {
      const cfg = {};
      for (let k in this.#defaults) cfg[k] = this.get(k);
      return cfg;
    }
    // Session-only settings
    getSession(key) { return this.#defaults[key]; }
    setSession(key, val) { this.#defaults[key] = val; }
  }
  const config = new ConfigManager();

  class Logger {
    static log(...args) { if (config.get('consoleLog')) console.log(`%c[BiliQuality+]`, 'color:#00a1d6', ...args); }
    static warn(...args) { console.warn(`[BiliQuality+]`, ...args); }
  }

  class HookManager {
    #origSetTimeout = unsafeWindow.setTimeout;
    #origDefineProperty = Object.defineProperty;

    init() {
      this.initStorageHooks();
      if (config.get('unlockTrial')) {
        const self = this;
        unsafeWindow.setTimeout = function (func, delay, ...args) {
          if (delay === 30000) return self.#origSetTimeout.call(this, func, 3e8, ...args);
          return self.#origSetTimeout.call(this, func, delay, ...args);
        };
        Object.defineProperty = function (obj, prop, descriptor) {
          if (prop === 'isViewToday' || prop === 'isVideoAble') {
            descriptor = { get: () => true, enumerable: false, configurable: true };
          }
          return self.#origDefineProperty.call(this, obj, prop, descriptor);
        };
      }
      if (config.get('unlockUA')) {
        try {
          Object.defineProperty(navigator, 'userAgent', { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15", configurable: true });
          Object.defineProperty(navigator, 'platform', { value: "MacIntel", configurable: true });
          if (!config.get('preserveTouchPoints')) {
            const detectPointerType = () => {
              try {
                const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
                const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
                const anyHover = window.matchMedia('(any-hover: hover)').matches;
                const supportsTouch = ('ontouchstart' in window) || (Number(navigator.maxTouchPoints) || 0) > 0;
                return { isMouseDevice: hasFinePointer && anyHover, isTouchDevice: hasCoarsePointer && supportsTouch };
              } catch { return { isMouseDevice: true, isTouchDevice: false }; }
            };
            const pointer = detectPointerType();
            Logger.log('Pointer Detect:', pointer);
            if (pointer.isMouseDevice && !pointer.isTouchDevice) {
              try { Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true }); Logger.log('maxTouchPoints set to 0'); }
              catch (e) { Logger.warn('maxTouchPoints spoof failed', e); }
            }
          }
        } catch (e) { Logger.warn('UA Spoof failed', e); }
      }
      try {
        const baseKey = 'bilibili_player_force_DolbyAtmos&8K';
        const hdrKey = `${baseKey}&HDR`;
        localStorage.removeItem(baseKey);
        localStorage.removeItem(hdrKey);
        localStorage.removeItem('bilibili_player_force_hdr');
        if (config.get('unlockMarker')) {
          localStorage.setItem(baseKey, '1');
          if (config.get('unlockHDR')) localStorage.setItem(hdrKey, '1');
        }
        if (config.get('unlockHDR')) localStorage.setItem('bilibili_player_force_hdr', '1');
      } catch (e) { }
    }

    initStorageHooks() {
      if (!config.get('persistPlayerSettings')) return;
      const origSetItem = Storage.prototype.setItem;
      PERSISTED_KEYS.forEach(key => {
        const value = GM_getValue(key);
        if (value !== undefined && value !== null) {
          try { origSetItem.call(localStorage, key, value); Logger.log(`Storage Restored: ${key}`); }
          catch (e) { Logger.warn(`Storage Restore Failed for ${key}:`, e); }
        }
      });
      Storage.prototype.setItem = function (key, value) {
        if (key === 'bpx_player_profile') {
          try {
            const profile = JSON.parse(value);
            if (!profile.audioEffect) profile.audioEffect = {};
            value = JSON.stringify(profile);
          } catch (e) { }
        }
        origSetItem.call(this, key, value);
        if (PERSISTED_KEYS.includes(key)) {
          setTimeout(() => { GM_setValue(key, value); Logger.log(`Storage Persisted: ${key}`); }, 100);
        }
      };
    }
  }

  class Utils {
    static hasCookie(name) { try { return new RegExp(`(?:^|;\\s*)${name}=`).test(document.cookie || ''); } catch { return false; } }
    static isLoggedIn() {
      try { if (unsafeWindow.__INITIAL_STATE__?.loginInfo?.isLogin === true) return true; } catch { }
      if (Utils.hasCookie('DedeUserID') || Utils.hasCookie('SESSDATA') || Utils.hasCookie('bili_jct')) return true;
      const hasAvatar = !!document.querySelector('.header-avatar-wrap,.v-popover-wrap.header-avatar-wrap,.mini-header__avatar');
      const hasLogin = !!document.querySelector('.header-login-entry,.go-login-btn,.mini-header__login,.right-entry__outside-go-login');
      if (hasAvatar && !hasLogin) return true;
      if (hasLogin && !hasAvatar) return false;
      return false;
    }
    static isVip() { return !!document.querySelector('.bili-avatar-icon.bili-avatar-right-icon.bili-avatar-icon-big-vip,.vip-icon--big'); }
    static waitFor(selector, timeout = 5000) {
      return new Promise(resolve => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
          const el = document.querySelector(selector);
          if (el) { obs.disconnect(); resolve(el); }
        });
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
      });
    }
    static click(el) {
      if (!el) return;
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    static textMatch(text, keywords) {
      if (!text || !keywords) return false;
      return keywords.some(k => text.includes(k));
    }
  }

  class VideoHandler {
    getPlayer() {
      const player = unsafeWindow.player;
      if (!player) return null;
      try { if (typeof player.isInitialized === 'function' && !player.isInitialized()) return null; } catch { return null; }
      return player;
    }

    async checkVipStatus() {
      const checked = config.getSession('vipStatusChecked');
      const noLoginMode = !!config.get('noLoginMode');
      const vipStatusOverride = String(config.get('vipStatusOverride') || 'auto');
      if (!checked && !noLoginMode) await Utils.waitFor('.header-avatar-wrap,.v-popover-wrap.header-avatar-wrap,.header-login-entry,.go-login-btn,.mini-header__login', 5000);
      let isLogin = noLoginMode ? false : Utils.isLoggedIn();
      let isVip = (!isLogin || noLoginMode) ? false : Utils.isVip();
      if (!noLoginMode && vipStatusOverride !== 'auto') {
        if (vipStatusOverride === 'vip') { isLogin = true; isVip = true; }
        else if (vipStatusOverride === 'normal') { isLogin = true; isVip = false; }
      }
      const changed = !checked || isLogin !== config.getSession('isLogin') || isVip !== config.getSession('isVip');
      if (!changed) return;
      config.setSession('isLogin', isLogin);
      config.setSession('isVip', isVip);
      config.setSession('vipStatusChecked', true);
      Logger.log('User Status Check:', isLogin ? (isVip ? 'VIP' : 'Normal') : 'Guest');
    }

    async switchQuality() {
      await this.checkVipStatus();
      const player = this.getPlayer();
      if (!player || typeof player.getSupportedQualityList !== 'function' || typeof player.requestQuality !== 'function') return false;

      let currentQ = 0;
      try { currentQ = Number(player.getQuality?.()?.nowQ) || 0; } catch { currentQ = 0; }
      let rawList = [];
      try { rawList = player.getSupportedQualityList() || []; } catch { return false; }
      const availableListRaw = Array.isArray(rawList) ? rawList.map(q => Number(q?.qn ?? q)).filter(q => Number.isFinite(q) && q > 0) : [];
      const availableList = config.get('disableHDROption') ? availableListRaw.filter(q => ![CONSTANTS.Q_MAP.Dolby, CONSTANTS.Q_MAP.HDR].includes(q)) : availableListRaw;
      if (!availableList.length) return false;

      const primarySetting = config.get('primaryQuality');
      const backupSetting = config.get('backupQuality');
      const isVip = config.getSession('isVip');
      const isLogin = config.getSession('isLogin');
      const noLoginMode = !!config.get('noLoginMode') || !isLogin;
      const allowFreeVipQualities = !!config.get('allowFreeVipQualities');
      const freeVipSet = (!isVip && allowFreeVipQualities && !noLoginMode) ? this.#getFreeVipQualitySet() : new Set();
      const isVipBlocked = (q) => CONSTANTS.VIP_QUALITIES.includes(q) && !isVip && !freeVipSet.has(q);
      const candidateList = noLoginMode ? availableList.filter(q => q <= CONSTANTS.Q_MAP['1080P']) : availableList;

      Logger.log('Video Quality Check:', { current: currentQ, available: candidateList, primary: primarySetting, backup: backupSetting, isVip, isLogin, noLoginMode, allowFreeVipQualities, freeVip: [...freeVipSet] });

      const findTargetQ = (setting) => {
        if (setting === 'max') return candidateList.filter(q => !isVipBlocked(q)).reduce((m, q) => Math.max(m, q), 0);
        const wantQ = CONSTANTS.Q_MAP[setting] || 0;
        if (candidateList.includes(wantQ)) return wantQ;
        return 0;
      };

      let targetQ = findTargetQ(primarySetting);

      // 如果首选画质是VIP画质但用户不是VIP，则启用回退逻辑
      if (isVipBlocked(targetQ)) {
        Logger.log(`Primary quality ${targetQ} is VIP-only. Fallback initiated.`);
        if (config.get('useBackupQuality')) {
          targetQ = findTargetQ(backupSetting);
        } else {
          targetQ = findTargetQ('max'); // 回退到非VIP的最高画质
        }
      }

      // 如果经过主备流程后仍然没找到（比如备用也是VIP画质），则最后回退到可用的最高画质
      if (targetQ === 0 || isVipBlocked(targetQ)) targetQ = config.get('useHighestQualityFallback') ? findTargetQ('max') : 0;

      if (!Number.isFinite(targetQ) || targetQ <= 0) return false;

      if (targetQ !== currentQ) {
        if (targetQ > currentQ || (targetQ < currentQ && config.get('allowDowngrade'))) {
          Logger.log(`Switching Video: ${currentQ} -> ${targetQ}`);
          try {
            const wasPlaying = !player.mediaElement().paused;
            player.requestQuality(targetQ);
            if (config.get('waitOnQualitySwitch') && wasPlaying) {
              player.mediaElement().pause();
              this.#waitForQualityToast(player, wasPlaying);
            }
          } catch (e) { Logger.warn('Switching Video failed', e); return false; }
          return true;
        }
      }
      return false;
    }

    #getFreeVipQualitySet() {
      const set = new Set();
      try {
        const TRIAL_KEYWORDS = ['试用', '限免', '免费', '试看', '体验'];
        const isFree = (text) => TRIAL_KEYWORDS.some(k => String(text || '').includes(k));
        const guessQn = (item, text) => {
          const attrs = ['data-qn', 'data-value', 'data-quality', 'data-id', 'data-def'];
          for (const key of attrs) {
            const val = Number(item?.getAttribute?.(key));
            if (Number.isFinite(val) && val > 0) return val;
          }
          const t = String(text || '');
          if (t.includes('8K') || /8k/i.test(t)) return CONSTANTS.Q_MAP['8K'];
          if (t.includes('4K') || /4k/i.test(t)) return CONSTANTS.Q_MAP['4K'];
          if (t.includes('杜比视界') || /dolby/i.test(t)) return CONSTANTS.Q_MAP.Dolby;
          if (t.includes('HDR')) return CONSTANTS.Q_MAP.HDR;
          if ((t.includes('60帧') || /60fps/i.test(t) || /p60/i.test(t)) && t.includes('1080')) return CONSTANTS.Q_MAP['1080P60'];
          if (t.includes('高码率') || t.includes('1080+') || t.includes('1080P+')) return CONSTANTS.Q_MAP['1080P+'];
          if (t.includes('1080')) return CONSTANTS.Q_MAP['1080P'];
          if (t.includes('720')) return CONSTANTS.Q_MAP['720P'];
          if (t.includes('480')) return CONSTANTS.Q_MAP['480P'];
          if (t.includes('360')) return CONSTANTS.Q_MAP['360P'];
          return 0;
        };
        const items = Array.from(document.querySelectorAll('.bpx-player-ctrl-quality-menu-item')).filter(Boolean);
        for (const item of items) {
          const badge = item.querySelector('.bpx-player-ctrl-quality-badge-bigvip');
          if (!badge) continue;
          const text = (item.textContent || '').trim();
          const badgeText = (badge.textContent || '').trim();
          if (!isFree(text) && !isFree(badgeText)) continue;
          const qn = guessQn(item, text);
          if (qn > 0) set.add(qn);
        }
      } catch { return set; }
      return set;
    }

    #waitForQualityToast(player, wasPlaying) {
      const timer = setInterval(() => {
        const toasts = Array.from(document.querySelectorAll('.bpx-player-toast-text'));
        if (toasts.some(toast => toast.textContent.includes('试用中') || toast.textContent.includes('成功'))) {
          if (wasPlaying) { try { player.mediaElement().play(); } catch (e) { } }
          clearInterval(timer);
        }
      }, 100);
      setTimeout(() => clearInterval(timer), 5000);
    }

    switchCodec() {
      if (!config.get('decodeSettingEnabled')) return false;
      const priority = config.get('codecPriority');
      if (priority === 'default') return false;
      const keywords = CONSTANTS.TEXT_MAP[priority];
      if (!keywords) return false;
      const items = document.querySelectorAll('.bui-radio-item');
      for (let item of items) {
        if (Utils.textMatch(item.textContent || '', keywords)) {
          if (!item.classList.contains('bui-radio-checked') && !item.querySelector('input:checked')) {
            Logger.log(`Switching Codec to ${priority}`);
            Utils.click(item);
            return true;
          }
        }
      }
      return false;
    }

    switchAudio() {
      let changed = false;
      if (config.get('enableHiRes')) {
        const btn = document.querySelector('.bpx-player-ctrl-flac');
        if (btn && !btn.classList.contains('bpx-state-active')) {
          Logger.log('Enabling Hi-Res');
          Utils.click(btn);
          changed = true;
        }
      }
      if (config.get('enableDolby')) {
        const btn = document.querySelector('.bpx-player-ctrl-dolby');
        if (btn && !btn.classList.contains('bpx-state-active')) {
          Logger.log('Enabling Dolby');
          Utils.click(btn);
          changed = true;
        }
      }
      return changed;
    }

    tryClickTrial() {
      const trialBtn = document.querySelector('.bpx-player-toast-confirm-login');
      if (trialBtn) {
        Logger.log('Clicking Trial Button');
        Utils.click(trialBtn);
        return true;
      }
      return false;
    }
  }

  class LiveHandler {
    getPlayer() { return unsafeWindow.livePlayer; }
    switchQuality() {
      const player = this.getPlayer();
      if (!player || typeof player.getPlayerInfo !== 'function' || typeof player.switchQuality !== 'function') return false;
      let info = {};
      try { info = player.getPlayerInfo() || {}; } catch { return false; }
      const candidates = Array.isArray(info.qualityCandidates) ? info.qualityCandidates : [];
      if (!candidates.length) return false;
      const currentQN = Number(info.quality) || 0;
      const targetSetting = config.get('liveQuality');
      Logger.log('Live Quality Check:', { current: currentQN, candidates: candidates, target: targetSetting });
      let targetCandidate = null;
      const best = [...candidates].sort((a, b) => (Number(b?.qn) || 0) - (Number(a?.qn) || 0))[0] || null;
      if (targetSetting === 'max') {
        targetCandidate = best;
      } else {
        targetCandidate = candidates.find(c => String(c?.desc || '').includes(targetSetting)) || best;
      }
      const qn = Number(targetCandidate?.qn);
      if (!Number.isFinite(qn) || qn <= 0) return false;
      if (qn !== currentQN) {
        Logger.log(`Switching Live: ${currentQN} -> ${qn} (${targetCandidate?.desc || ''})`);
        try { player.switchQuality(qn); } catch (e) { Logger.warn('Switching Live failed', e); return false; }
        return true;
      }
      return false;
    }
	    switchCodec() {
	      if (!config.get('decodeSettingEnabled')) return false;
	      const priority = config.get('liveCodecPriority');
	      if (!priority || priority === 'default') return false;
	      const keywords = CONSTANTS.TEXT_MAP[priority];
	      if (!keywords) return false;

      const containers = [
        document.querySelector('.YccudlUCmLKcUTg_yzKN'),
        document.querySelector('[class*="decode"] ul'),
        document.querySelector('[class*="Decode"] ul'),
      ].filter(Boolean);
	      for (const container of containers) {
	        const items = Array.from(container.querySelectorAll('li')).filter(Boolean);
	        for (const item of items) {
	          const text = (item.textContent || '').trim();
	          if (!text || !Utils.textMatch(text, keywords)) continue;
	          const selectedClasses = ['active', 'selected', 'on', 'is-active', 'fG2r2piYghHTQKQZF8bl'];
	          if (selectedClasses.some(cls => item.classList.contains(cls)) || item.getAttribute('aria-selected') === 'true') return false;
	          Logger.log(`Switching Live Codec to ${priority}`);
	          Utils.click(item);
	          return true;
	        }
	      }
      return false;
    }
    switchAudio() { return false; }
    tryClickTrial() { return false; }
  }

  class RetryGuard {
    #handler = null;
    #timer = null;
    #checkCount = 0;
    #maxChecks = 10;
    #interval = 2000;
    #taskId = 0;
    #isLive = false;
    constructor(isLive) { this.#isLive = !!isLive; this.#handler = isLive ? new LiveHandler() : new VideoHandler(); }
    start(taskId) {
      this.#taskId = taskId;
      this.#checkCount = 0;
      const has = (key) => typeof GM_getValue(key, undefined) !== 'undefined';
      const enabled = this.#isLive ? (has('liveQualityDoubleCheck') ? config.get('liveQualityDoubleCheck') : config.get('doubleCheck')) : (has('qualityDoubleCheck') ? config.get('qualityDoubleCheck') : config.get('doubleCheck'));
      this.#maxChecks = enabled ? Math.max(1, Number(config.get('maxChecks')) || 10) : 2;
      this.#interval = Math.max(200, Number(config.get('idleIntervalMs')) || 2000);
      this.loop();
    }
    async loop() {
      if (this.#taskId !== App.currentTaskId) {
        Logger.log(`Task ${this.#taskId} cancelled.`);
        return;
      }
      clearTimeout(this.#timer);
      if (config.get('unlockTrial')) this.#handler.tryClickTrial();
      const qChanged = await this.#handler.switchQuality();
      const cChanged = this.#handler.switchCodec();
      const aChanged = this.#handler.switchAudio();
      if (this.#checkCount < this.#maxChecks) {
        this.#checkCount++;
        let nextDelay = (qChanged || cChanged || aChanged) ? Math.max(200, Number(config.get('afterChangeDelayMs')) || 4000) : this.#interval;
        this.#timer = setTimeout(() => this.loop(), nextDelay);
      } else {
        Logger.log('RetryGuard finished.');
      }
    }
  }

  class UIManager {
    #shadowRoot = null;
    #host = null;
    init() {
      this.registerMenu();
      if (config.get('showButton')) this.renderFloatingButton();
      this.applyPageTweaks();
    }
    registerMenu() { if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('⚙️ 打开设置面板', () => this.togglePanel()); }
    applyPageTweaks() {
      if (document.readyState === 'loading' || !document.body) return void document.addEventListener('DOMContentLoaded', () => this.applyPageTweaks(), { once: true });
      if (config.get('takeOverQualityControl') && location.host !== 'live.bilibili.com') {
        const styleId = 'biliqualityplus-takeover-style';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = '.bpx-player-ctrl-quality,.bpx-player-ctrl-btn.bpx-player-ctrl-quality{display:none!important}';
          (document.head || document.documentElement).appendChild(style);
        }
      }
      if (config.get('injectQualityButton') && location.host !== 'live.bilibili.com') this.#injectSettingsButton();
    }
    async #injectSettingsButton() {
      if (document.querySelector('.biliqualityplus-injected-btn')) return;
      const container = await Utils.waitFor('.bpx-player-control-wrap', 8000);
      if (!container || document.querySelector('.biliqualityplus-injected-btn')) return;
      const btn = document.createElement('div');
      btn.className = 'biliqualityplus-injected-btn';
      btn.textContent = '⚙️';
      btn.title = 'BiliQualityPlus 设置';
      btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-left:8px;border-radius:4px;background:rgba(0,161,214,0.15);color:#00a1d6;cursor:pointer;user-select:none;font-size:16px;line-height:1';
      btn.onclick = () => this.togglePanel();
      container.appendChild(btn);
    }
    renderFloatingButton({ hideTrigger = false } = {}) {
      if (!document.body || this.#shadowRoot) return;
      this.#host = document.createElement('div');
      this.#host.style.cssText = 'position: fixed; top: 40%; left: 0; z-index: 100000;';
      document.body.appendChild(this.#host);
      this.#shadowRoot = this.#host.attachShadow({ mode: 'closed' });
      const style = `
        .trigger{width:30px;height:30px;background:rgba(0,161,214,0.8);color:white;border-radius:0 4px 4px 0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;transition:0.3s}
        .trigger:hover{width:40px;background:rgba(0,161,214,1)}
        .panel{position:absolute;left:40px;top:-150px;width:320px;background:rgba(255,255,255,0.98);border:1px solid #e7e7e7;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:15px;display:none;color:#333;font-family:sans-serif;font-size:13px}
        .panel.show{display:block}
        h3{margin:0 0 10px;color:#00A1D6;border-bottom:1px solid #eee;padding-bottom:5px}
        .row{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
        select,input{padding:2px 4px;border:1px solid #ccc;border-radius:4px}
        .btn{width:100%;padding:6px;background:#00A1D6;color:white;border:none;border-radius:4px;cursor:pointer;margin-top:10px}
        .tabs{display:flex;margin-bottom:10px}.tab{flex:1;padding:6px;text-align:center;cursor:pointer;border-radius:4px;background:#f0f0f0}.tab.active{background:#00a1d6;color:white}
        .tab-content{display:none}.tab-content.active{display:block}
        .vip-status{padding:5px;text-align:center;border-radius:4px;margin-bottom:10px;font-weight:bold}
        .vip-status.yes{background:#fce4ec;color:#f50057}.vip-status.no{background:#f0f0f0;color:#666}
        details{margin-top:8px}summary{cursor:pointer;color:#00A1D6;font-weight:bold;outline:none}
      `;
      const qualityOptions = Object.keys(CONSTANTS.Q_MAP).map(q => `<option value="${q}">${q}</option>`).join('');
      this.#shadowRoot.innerHTML = `<style>${style}</style>
        <div class="trigger" id="btn">⚙️</div>
        <div class="panel" id="panel">
	            <h3>BiliQualityPlus v0.0.2</h3>
            <div class="vip-status" id="vip-status">账号状态检测中...</div>
            <div class="tabs">
                <div class="tab active" data-tab="primary">首选画质</div>
                <div class="tab" data-tab="backup">备用画质</div>
            </div>
            <div id="content-primary" class="tab-content active">
                <div class="row"><span>视频画质</span><select id="primaryQuality"><option value="max">最高画质</option>${qualityOptions}</select></div>
            </div>
            <div id="content-backup" class="tab-content">
                <div class="row"><span>备用画质</span><select id="backupQuality">${qualityOptions}</select></div>
                <div class="row"><label><input type="checkbox" id="useBackupQuality"> VIP画质不可用时启用</label></div>
            </div>
            <hr style="border:0;border-top:1px solid #eee;margin:8px 0">
            <div class="row"><span>直播画质</span><select id="liveQuality"><option value="max">最高</option><option value="原画">原画</option><option value="蓝光">蓝光</option><option value="超清">超清</option></select></div>
            <div class="row"><label><input type="checkbox" id="decodeSettingEnabled">启用解码设置</label></div>
            <div class="row"><span>视频解码</span><select id="codecPriority"><option value="HEVC">HEVC</option><option value="AVC">AVC</option><option value="AV1">AV1</option><option value="default">默认</option></select></div>
            <div class="row"><span>直播解码</span><select id="liveCodecPriority"><option value="HEVC">HEVC</option><option value="AVC">AVC</option><option value="AV1">AV1</option><option value="default">默认</option></select></div>
            <div class="row"><label><input type="checkbox" id="enableHiRes">启用Hi-Res</label></div>
            <div class="row"><label><input type="checkbox" id="enableDolby">启用杜比</label></div>
            <details>
              <summary>高级设置</summary>
              <div class="row"><label><input type="checkbox" id="useHighestQualityFallback">备选缺失回退最高</label></div>
              <div class="row"><label><input type="checkbox" id="qualityDoubleCheck">视频画质二次验证</label></div>
              <div class="row"><label><input type="checkbox" id="liveQualityDoubleCheck">直播画质二次验证</label></div>
              <div class="row"><span>最大检查轮次</span><input type="number" id="maxChecks" min="1" max="50" step="1" style="width:90px"></div>
              <div class="row"><span>空闲检查间隔(ms)</span><input type="number" id="idleIntervalMs" min="200" max="20000" step="100" style="width:90px"></div>
              <div class="row"><span>切换后等待(ms)</span><input type="number" id="afterChangeDelayMs" min="200" max="20000" step="100" style="width:90px"></div>
              <div class="row"><label><input type="checkbox" id="injectQualityButton">注入设置按钮</label></div>
              <div class="row"><label><input type="checkbox" id="takeOverQualityControl">隐藏原生清晰度按钮</label></div>
            </details>
            <details>
              <summary>开发者设置</summary>
              <div class="row"><span>模拟会员状态</span><select id="vipStatusOverride"><option value="auto">默认</option><option value="normal">普通</option><option value="vip">会员</option></select></div>
              <div class="row"><label><input type="checkbox" id="noLoginMode">未登录模式(最高1080P)</label></div>
              <div class="row"><label><input type="checkbox" id="allowFreeVipQualities">非会员允许限免画质</label></div>
            </details>
            <hr style="border:0;border-top:1px solid #eee;margin:8px 0">
	            <div class="row"><label><input type="checkbox" id="unlockTrial">解锁试用(刷新)</label></div>
	            <details>
	              <summary>解锁/兼容</summary>
	              <div class="row"><label><input type="checkbox" id="unlockUA">UA伪装(刷新)</label></div>
	              <div class="row"><label><input type="checkbox" id="preserveTouchPoints">保留触控点(触屏不失效)</label></div>
	              <div class="row"><label><input type="checkbox" id="unlockMarker">写入杜比/8K标记(刷新)</label></div>
	              <div class="row"><label><input type="checkbox" id="unlockHDR">写入HDR标记(刷新)</label></div>
	              <div class="row"><label><input type="checkbox" id="disableHDROption">过滤HDR/杜比视界画质</label></div>
	            </details>
	            <div class="row"><label><input type="checkbox" id="allowDowngrade">允许画质降级</label></div>
	            <div class="row"><label><input type="checkbox" id="waitOnQualitySwitch">等待切换完成</label></div>
	            <div class="row"><label><input type="checkbox" id="persistPlayerSettings">持久化播放器设置</label></div>
	            <div class="row"><label><input type="checkbox" id="showButton">显示悬浮球</label></div>
	            <button class="btn" id="save">保存并刷新页面</button>
        </div>
      `;
      this.#bindEvents();
      if (hideTrigger) this.#shadowRoot.getElementById('btn').style.display = 'none';
    }

    #bindEvents() {
      const $ = (id) => this.#shadowRoot.getElementById(id);
      const panel = $('panel');
      $('btn').onclick = () => panel.classList.toggle('show');

      // Tabs
      this.#shadowRoot.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
          this.#shadowRoot.querySelector('.tab.active').classList.remove('active');
          this.#shadowRoot.querySelector('.tab-content.active').classList.remove('active');
          tab.classList.add('active');
          $(`content-${tab.dataset.tab}`).classList.add('active');
          config.set('activePanelTab', tab.dataset.tab);
        };
      });

      // Load Values
      $('primaryQuality').value = config.get('primaryQuality');
      $('backupQuality').value = config.get('backupQuality');
      $('useBackupQuality').checked = config.get('useBackupQuality');
      $('liveQuality').value = config.get('liveQuality');
      $('decodeSettingEnabled').checked = config.get('decodeSettingEnabled');
      $('codecPriority').value = config.get('codecPriority');
	      $('liveCodecPriority').value = config.get('liveCodecPriority');
	      $('enableHiRes').checked = config.get('enableHiRes');
	      $('enableDolby').checked = config.get('enableDolby');
	      $('unlockTrial').checked = config.get('unlockTrial');
	      $('unlockUA').checked = config.get('unlockUA');
	      $('preserveTouchPoints').checked = config.get('preserveTouchPoints');
	      $('unlockMarker').checked = config.get('unlockMarker');
	      $('unlockHDR').checked = config.get('unlockHDR');
	      $('disableHDROption').checked = config.get('disableHDROption');
	      $('allowDowngrade').checked = config.get('allowDowngrade');
	      $('waitOnQualitySwitch').checked = config.get('waitOnQualitySwitch');
	      $('persistPlayerSettings').checked = config.get('persistPlayerSettings');
      const has = (key) => typeof GM_getValue(key, undefined) !== 'undefined';
      const legacyDoubleCheck = config.get('doubleCheck');
      $('qualityDoubleCheck').checked = has('qualityDoubleCheck') ? config.get('qualityDoubleCheck') : legacyDoubleCheck;
      $('liveQualityDoubleCheck').checked = has('liveQualityDoubleCheck') ? config.get('liveQualityDoubleCheck') : legacyDoubleCheck;
      $('maxChecks').value = String(config.get('maxChecks'));
      $('idleIntervalMs').value = String(config.get('idleIntervalMs'));
      $('afterChangeDelayMs').value = String(config.get('afterChangeDelayMs'));
      $('useHighestQualityFallback').checked = config.get('useHighestQualityFallback');
      $('injectQualityButton').checked = config.get('injectQualityButton');
      $('takeOverQualityControl').checked = config.get('takeOverQualityControl');
      $('vipStatusOverride').value = String(config.get('vipStatusOverride') || 'auto');
      $('noLoginMode').checked = config.get('noLoginMode');
      $('allowFreeVipQualities').checked = config.get('allowFreeVipQualities');
      $('showButton').checked = config.get('showButton');
      this.#shadowRoot.querySelector(`.tab[data-tab="${config.get('activePanelTab')}"]`)?.click();

      // VIP Status Display
      const statusEl = $('vip-status');
      if (config.getSession('vipStatusChecked')) {
        const isLogin = config.getSession('isLogin');
        const isVip = config.getSession('isVip');
        const override = String(config.get('vipStatusOverride') || 'auto');
        const prefix = config.get('noLoginMode') ? '(模式) ' : (override !== 'auto' ? '(模拟) ' : '');
        statusEl.textContent = `${prefix}${!isLogin ? '未登录' : (isVip ? '大会员用户' : '普通用户')}`;
        statusEl.className = `vip-status ${isLogin && isVip ? 'yes' : 'no'}`;
      } else {
        statusEl.textContent = '账号状态检测中...';
        statusEl.className = 'vip-status no';
      }

      // Save
      $('save').onclick = () => {
        config.set('primaryQuality', $('primaryQuality').value);
        config.set('backupQuality', $('backupQuality').value);
        config.set('useBackupQuality', $('useBackupQuality').checked);
        config.set('liveQuality', $('liveQuality').value);
        config.set('decodeSettingEnabled', $('decodeSettingEnabled').checked);
        config.set('codecPriority', $('codecPriority').value);
	        config.set('liveCodecPriority', $('liveCodecPriority').value);
	        config.set('enableHiRes', $('enableHiRes').checked);
	        config.set('enableDolby', $('enableDolby').checked);
	        config.set('unlockTrial', $('unlockTrial').checked);
	        config.set('unlockUA', $('unlockUA').checked);
	        config.set('preserveTouchPoints', $('preserveTouchPoints').checked);
	        config.set('unlockMarker', $('unlockMarker').checked);
	        config.set('unlockHDR', $('unlockHDR').checked);
	        config.set('disableHDROption', $('disableHDROption').checked);
	        config.set('allowDowngrade', $('allowDowngrade').checked);
	        config.set('waitOnQualitySwitch', $('waitOnQualitySwitch').checked);
	        config.set('persistPlayerSettings', $('persistPlayerSettings').checked);
	        config.set('qualityDoubleCheck', $('qualityDoubleCheck').checked);
        config.set('liveQualityDoubleCheck', $('liveQualityDoubleCheck').checked);
        config.set('vipStatusOverride', $('vipStatusOverride').value);
        config.set('noLoginMode', $('noLoginMode').checked);
        config.set('allowFreeVipQualities', $('allowFreeVipQualities').checked);
        config.set('maxChecks', Math.max(1, Number($('maxChecks').value) || 10));
        config.set('idleIntervalMs', Math.max(200, Number($('idleIntervalMs').value) || 2000));
        config.set('afterChangeDelayMs', Math.max(200, Number($('afterChangeDelayMs').value) || 4000));
        config.set('useHighestQualityFallback', $('useHighestQualityFallback').checked);
        config.set('injectQualityButton', $('injectQualityButton').checked);
        config.set('takeOverQualityControl', $('takeOverQualityControl').checked);
        config.set('showButton', $('showButton').checked);
        location.reload();
      };
    }

    togglePanel() {
      if (document.readyState === 'loading' || !document.body) return void document.addEventListener('DOMContentLoaded', () => this.togglePanel(), { once: true });
      if (!this.#shadowRoot) this.renderFloatingButton({ hideTrigger: !config.get('showButton') });
      const panel = this.#shadowRoot?.getElementById('panel');
      if (panel) panel.classList.toggle('show');
      this.#bindEvents(); // Re-bind to update VIP status display
    }
  }

  class App {
    static currentTaskId = 0;
    static lastUrl = '';

    static run() {
      new HookManager().init();
      const ui = new UIManager();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ui.init());
      } else {
        ui.init();
      }

      const trigger = () => {
        const newUrl = location.href;
        if (newUrl === this.lastUrl) return;
        this.lastUrl = newUrl;
        this.currentTaskId++;
        Logger.log(`URL Change Detected. Starting Task #${this.currentTaskId}`);
        const isLive = location.host === 'live.bilibili.com';
        const guard = new RetryGuard(isLive);
        guard.start(this.currentTaskId);
        ui.applyPageTweaks();
      };

      // Initial run
      setTimeout(trigger, 500);

      // Listen for SPA changes
      const fire = () => setTimeout(trigger, 500);
      const patch = (obj, key) => {
        const raw = obj[key];
        if (typeof raw !== 'function') return;
        obj[key] = function (...args) { const r = raw.apply(this, args); fire(); return r; };
      };
      patch(history, 'pushState');
      patch(history, 'replaceState');
      window.addEventListener('popstate', fire, { passive: true });
    }
  }

  App.run();
})();
