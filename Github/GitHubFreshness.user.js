// ==UserScript==
// @name         !.GitHub Freshness
// @description  🚀 以红/绿/黄+默认(不修改)四档标注新鲜度，仅改变时间文本颜色，不使用背景
// @version      0.1.2
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0-or-later
// @match        https://github.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubFreshness.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubFreshness.user.js
// ==/UserScript==

(function () {
  'use strict';
  // WHY
  // - 仅给时间文本着色，不使用任何背景/边框，避免破坏 GitHub 布局与左右留白。
  // - 默认档(181–365天)不修改样式，保持页面原味，减少视觉噪音。
  // - 使用 GitHub Primer 的语义色变量，自动适配深/浅主题并与站点风格一致。
  // - 同时支持 relative-time 与 time-ago（Stars 页），确保一致性。

  const CONFIG = {
    // 分级阈值(天)：<=60 绿；<=180 黄；<=365 默认(不改)；>365 红
    TIME_LEVELS: {
      ACTIVE: 60,
      INACTIVE: 180,
      DEFAULT: 365,
    },
    // 仅改变文本颜色；使用 Primer 语义变量，回退到旧变量保证兼容
    COLORS: {
      ACTIVE: { color: 'var(--fgColor-success, var(--color-success-fg, #2da44e))' },
      INACTIVE: { color: 'var(--fgColor-attention, var(--color-attention-fg, #9a6700))' },
      STALE: { color: 'var(--fgColor-danger, var(--color-danger-fg, #cf222e))' }
    }
  };

  const STYLE_ID = 'github-freshness-styles';
  // 同时覆盖 Stars 页的 time-ago 与常见的 relative-time
  const TIME_SELECTOR = 'relative-time[datetime], time-ago[datetime]';

  class GitHubFreshness {
    constructor(config) {
      this.config = config;
    }

    run() {
      this._injectCSS();
      this._setupDynamicContentObserver();
      this.processVisiblePage();
    }

    processVisiblePage() {
      const timeElements = document.querySelectorAll(`${TIME_SELECTOR}:not([data-gfh-processed])`);
      timeElements.forEach(el => this._processElement(el));
    }

    _processElement(element) {
      if (element.dataset.gfhProcessed) return;
      const datetime = element.getAttribute('datetime');
      if (datetime) {
        const level = this._classifyDate(datetime);
        this._applyHighlight(element, level);
        element.dataset.gfhProcessed = 'true';
      }
    }

    _setupDynamicContentObserver() {
      const dynamicObserver = new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches && node.matches(`${TIME_SELECTOR}:not([data-gfh-processed])`)) {
              this._processElement(node);
            }
            if (node.querySelectorAll) {
              node.querySelectorAll(`${TIME_SELECTOR}:not([data-gfh-processed])`).forEach(el => this._processElement(el));
            }
          }
        }
      });
      dynamicObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('pjax:end', () => {
        setTimeout(() => this.processVisiblePage(), 300);
      });
    }

    _injectCSS() {
      if (document.getElementById(STYLE_ID)) return;

      const styles = Object.entries(this.config.COLORS)
        .map(([level, cfg]) => {
          const cls = `gfh-${level.toLowerCase()}`;
          return `/* ${level} */
          .${cls}-text {
            color: ${cfg.color} !important;
            }`;
        })
        .join('');

      const styleElement = document.createElement('style');
      styleElement.id = STYLE_ID;
      styleElement.textContent = styles;
      document.head.appendChild(styleElement);
    }

    _applyHighlight(element, level) {
      if (!element || !level) return;
      // DEFAULT 档位不做任何修改，保持 GitHub 原生样式
      if (level === 'DEFAULT') return;

      const className = `gfh-${level.toLowerCase()}`;
      element.classList.add(`${className}-text`);
    }

    _classifyDate(dateString) {
      try {
        const diffDays = (Date.now() - new Date(dateString).getTime()) / 86400000;
        const { TIME_LEVELS } = this.config;
        if (diffDays <= TIME_LEVELS.ACTIVE) return 'ACTIVE';
        if (diffDays <= TIME_LEVELS.INACTIVE) return 'INACTIVE';
        if (diffDays <= TIME_LEVELS.DEFAULT) return 'DEFAULT';
        return 'STALE';
      } catch {
        // 解析失败时不干预页面样式
        return 'DEFAULT';
      }
    }
  }

  const freshnessChecker = new GitHubFreshness(CONFIG);
  freshnessChecker.run();

})();
