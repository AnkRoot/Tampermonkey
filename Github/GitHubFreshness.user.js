// ==UserScript==
// @name         !.GitHub Freshness
// @description  🚀 以红/绿/黄+默认(不修改)四档标注新鲜度，仅改变时间文本颜色，不使用背景
// @version      0.2.0
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

  class GitHubFreshness {
    static #CONFIG = {
      TIME_LEVELS: {
        ACTIVE: 60,
        INACTIVE: 180,
        DEFAULT: 365,
      },
      COLORS: {
        ACTIVE: 'var(--fgColor-success, var(--color-success-fg, #2da44e))',
        INACTIVE: 'var(--fgColor-attention, var(--color-attention-fg, #9a6700))',
        STALE: 'var(--fgColor-danger, var(--color-danger-fg, #cf222e))',
      },
      STYLE_ID: 'github-freshness-styles',
      TIME_SELECTOR: 'relative-time[datetime], time-ago[datetime]',
      PROCESSED_ATTR: 'data-gfh-processed',
    };

    #processElement(element) {
      if (element.hasAttribute(GitHubFreshness.#CONFIG.PROCESSED_ATTR)) {
        return;
      }

      const datetime = element.getAttribute('datetime');
      if (datetime) {
        const level = this.#classifyDate(datetime);
        this.#applyHighlight(element, level);
        element.setAttribute(GitHubFreshness.#CONFIG.PROCESSED_ATTR, 'true');
      }
    }

    #classifyDate(dateString) {
      try {
        const diffDays = (Date.now() - new Date(dateString).getTime()) / 86400000;
        const { TIME_LEVELS } = GitHubFreshness.#CONFIG;
        if (diffDays <= TIME_LEVELS.ACTIVE) return 'ACTIVE';
        if (diffDays <= TIME_LEVELS.INACTIVE) return 'INACTIVE';
        if (diffDays <= TIME_LEVELS.DEFAULT) return 'DEFAULT';
        return 'STALE';
      } catch {
        return 'DEFAULT'; // Fail silently on parsing errors
      }
    }

    #applyHighlight(element, level) {
      if (!element || level === 'DEFAULT') {
        return; // Do not modify elements for the default level
      }
      const className = `gfh-${level.toLowerCase()}`;
      element.classList.add(className);
    }

    #processAllVisible() {
      const selector = `${GitHubFreshness.#CONFIG.TIME_SELECTOR}:not([${GitHubFreshness.#CONFIG.PROCESSED_ATTR}])`;
      document.querySelectorAll(selector).forEach(el => this.#processElement(el));
    }

    #setupObservers() {
      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            if (node.matches(GitHubFreshness.#CONFIG.TIME_SELECTOR)) {
              this.#processElement(node);
            }
            node.querySelectorAll(GitHubFreshness.#CONFIG.TIME_SELECTOR)
              .forEach(el => this.#processElement(el));
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      document.addEventListener('pjax:end', () => {
        setTimeout(() => this.#processAllVisible(), 300);
      });
    }

    #injectCSS() {
      if (document.getElementById(GitHubFreshness.#CONFIG.STYLE_ID)) return;

      const styles = Object.entries(GitHubFreshness.#CONFIG.COLORS)
        .map(([level, color]) => `
          .gfh-${level.toLowerCase()} {
            color: ${color} !important;
          }
        `)
        .join('');

      const styleElement = document.createElement('style');
      styleElement.id = GitHubFreshness.#CONFIG.STYLE_ID;
      styleElement.textContent = styles;
      document.head.appendChild(styleElement);
    }

    init() {
      this.#injectCSS();
      this.#processAllVisible(); // Initial run
      this.#setupObservers();   // Then observe for changes
    }

    static run() {
      const instance = new GitHubFreshness();
      instance.init();
    }
  }

  GitHubFreshness.run();

})();