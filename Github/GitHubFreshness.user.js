// ==UserScript==
// @name         !.GitHub Freshness
// @description  🚀 用最直观的3色系统 (活跃/不活跃/归档) 显示仓库新鲜度，告别颜色混乱。
// @version      0.0.5
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

  // --- 极简配置 ---
  const CONFIG = {
    // 3级时间阈值 (天)
    TIME_LEVELS: {
      ACTIVE: 90,     // 90天内 -> 活跃
      INACTIVE: 365,  // 90天至1年 -> 不活跃
      // > 1年 -> 归档
    },
    // 3级颜色系统 (颜色取自GitHub原生UI，确保视觉和谐)
    COLORS: {
      ACTIVE: { color: '#2da44e', bg: 'rgba(234, 248, 237, 0.5)' }, // 绿色
      INACTIVE: { color: '#bf8700', bg: 'rgba(252, 248, 227, 0.5)' }, // 黄色
      ARCHIVED: { color: '#57606a', bg: 'rgba(246, 248, 250, 0.5)' }, // 灰色
    },
    DEBUG: false,
  };

  class GitHubFreshness {
    constructor(config) {
      this.config = config;
      this.observer = new IntersectionObserver(this._handleIntersection.bind(this), {
        root: null,
        rootMargin: '0px 0px 500px 0px'
      });
      this._log('Initialized');
    }

    run() {
      this._injectCSS();
      this._setupDynamicContentObserver();
      this.processVisiblePage();
    }

    processVisiblePage() {
      const timeElements = document.querySelectorAll('relative-time[datetime]:not([data-gfh-processed])');
      this._log(`Found ${timeElements.length} unprocessed elements.`);
      timeElements.forEach(el => this.observer.observe(el));
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

    _handleIntersection(entries, observer) {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const element = entry.target;
          this._processElement(element);
          observer.unobserve(element);
        }
      });
    }

    _setupDynamicContentObserver() {
      const dynamicObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const newElements = node.querySelectorAll('relative-time[datetime]:not([data-gfh-processed])');
              newElements.forEach(el => this.observer.observe(el));
              if (node.matches('relative-time[datetime]:not([data-gfh-processed])')) {
                this.observer.observe(node);
              }
            }
          }
        }
      });
      dynamicObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('pjax:end', () => {
        this._log('pjax:end detected, re-processing page.');
        setTimeout(() => this.processVisiblePage(), 300);
      });
    }

    _injectCSS() {
      const styleId = 'github-freshness-styles';
      if (document.getElementById(styleId)) return;

      const styles = Object.entries(this.config.COLORS).map(([level, config]) => {
        const className = `gfh-${level.toLowerCase()}`;
        return `
          .gfh-container.${className}-bg {
            background-color: ${config.bg} !important;
            border-left: 3px solid ${config.color} !important;
          }
          .${className}-text {
            color: ${config.color} !important;
            font-weight: 500 !important;
          }
        `;
      }).join('');

      const styleElement = document.createElement('style');
      styleElement.id = styleId;
      styleElement.textContent = styles;
      document.head.appendChild(styleElement);
      this._log('CSS styles injected.');
    }

    _applyHighlight(element, level) {
      if (!element || !level) return;
      const className = `gfh-${level.toLowerCase()}`;
      element.classList.add(`${className}-text`);

      const container = element.closest(`
        .Box-row, tr, li, article, .js-issue-row,
        div[role="listitem"], [data-testid*="list-item"], [data-testid*="tree-row"]
      `);

      if (container) {
        container.classList.add('gfh-container', `${className}-bg`);
      }
    }

    _classifyDate(dateString) {
      try {
        const diffDays = (new Date() - new Date(dateString)) / (1000 * 60 * 60 * 24);
        const { TIME_LEVELS } = this.config;
        if (diffDays <= TIME_LEVELS.ACTIVE) return 'ACTIVE';
        if (diffDays <= TIME_LEVELS.INACTIVE) return 'INACTIVE';
        return 'ARCHIVED';
      } catch { return 'ARCHIVED'; }
    }

    _log(...args) {
      if (this.config.DEBUG) console.log('[GitHub Freshness]', ...args);
    }
  }

  // --- 脚本入口 ---
  const freshnessChecker = new GitHubFreshness(CONFIG);
  freshnessChecker.run();

})();