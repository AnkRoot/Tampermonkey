// ==UserScript==
// @name         !.GitHub Toolbar Boost
// @description  顶部 Trending 入口，仓库工具栏加入 Github.dev / DeepWiki / ZreadAi 按钮。
// @version      0.0.1
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0
// @match        https://github.com/*
// @icon         https://github.githubassets.com/favicons/favicon.svg
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubToolbarBoost.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubToolbarBoost.user.js
// ==/UserScript==

(function () {
  'use strict';

  class Config {
    static PREFIX = 'gh-boost-';

    static SELECTORS = {
      REPO_ACTIONS: [
        'ul.pagehead-actions',
        '.pagehead-actions',
        '.file-navigation .d-flex',
        'nav[aria-label="Repository"] .d-flex'
      ],
      HEADER_ACTIONS: '.AppHeader-actions',
      HEADER_REF: ['notification-indicator', '.AppHeader-user', '.AppHeader-globalBar-end']
    };

    static ICONS = {
      trending: `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-graph"><path d="M1.5 1.75V13.5h13.75a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75V1.75a.75.75 0 0 1 1.5 0Zm14.28 2.53-5.25 5.25a.75.75 0 0 1-1.06 0L7 7.06 4.28 9.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.25-3.25a.75.75 0 0 1 1.06 0L10 7.94l4.72-4.72a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"></path></svg>`,
      githubDev: `<img class="octicon" width="16" height="16" src="https://github.com/favicons/favicon-codespaces.svg" />`,
      zreadAi: `<svg aria-hidden="true" viewBox="0 0 32 32" width="16" height="16" class="octicon"><path d="M9.919 3.2h-5.44c-.7 0-1.28.57-1.28 1.28v5.44c0 .7.57 1.28 1.28 1.28h5.44c.7 0 1.28-.57 1.28-1.28V4.48c0-.7-.57-1.28-1.28-1.28zm0 17.6h-5.44c-.7 0-1.28.57-1.28 1.28v5.44c0 .7.57 1.28 1.28 1.28h5.44c.7 0 1.28-.57 1.28-1.28v-5.44c0-.7-.57-1.28-1.28-1.28zm17.6-17.6h-5.44c-.7 0-1.28.57-1.28 1.28v5.44c0 .7.57 1.28 1.28 1.28h5.44c.7 0 1.28-.57 1.28-1.28V4.48c0-.7-.57-1.28-1.28-1.28zM8 24L24 8L8 24z" fill="currentColor"></path><path d="M8 24L24 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`,
      deepWiki: `<svg class="octicon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`
    };
  }

  class Core {
    static generateUrls() {
      const pathInfo = window.location.pathname + window.location.search + window.location.hash;
      return {
        trending: '/trending',
        githubDev: `https://github.dev${pathInfo}`,
        zreadAi: `https://zread.ai${pathInfo}`,
        deepWiki: `https://deepwiki.com${pathInfo}`
      };
    }

    static queryAny(selectors, base = document) {
      if (typeof selectors === 'string') return base.querySelector(selectors);
      for (const sel of selectors) {
        const el = base.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    static debounce(fn, delay = 100) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    }
  }

  class Renderer {
    static run() {
      const urls = Core.generateUrls();

      this.#injectHeaderButton(urls.trending);

      const repoContainer = Core.queryAny(Config.SELECTORS.REPO_ACTIONS);
      if (repoContainer) {
        this.#injectRepoButton(repoContainer, 'deepWiki', 'DeepWiki', Config.ICONS.deepWiki, urls.deepWiki);
        this.#injectRepoButton(repoContainer, 'zreadAi', 'ZreadAi', Config.ICONS.zreadAi, urls.zreadAi);
        this.#injectRepoButton(repoContainer, 'githubDev', 'Github.dev', Config.ICONS.githubDev, urls.githubDev);
      }
    }

    static #injectHeaderButton(url) {
      const id = `${Config.PREFIX}trending`;
      if (document.getElementById(id)) return;

      const container = document.querySelector(Config.SELECTORS.HEADER_ACTIONS);
      if (!container) return;

      const btn = document.createElement('a');
      btn.id = id;
      btn.href = url;
      btn.className = 'Button Button--iconOnly Button--secondary Button--medium AppHeader-button color-fg-muted';
      btn.setAttribute('aria-label', 'Trending');
      btn.innerHTML = Config.ICONS.trending;

      const ref = Core.queryAny(Config.SELECTORS.HEADER_REF, container);
      if (ref) {
        container.insertBefore(btn, ref);
      } else {
        container.appendChild(btn);
      }
    }

    static #injectRepoButton(container, key, label, iconHtml, url) {
      const id = `${Config.PREFIX}${key}`;
      if (document.getElementById(id)) return;

      const li = document.createElement('li');
      li.id = id;
      li.className = 'd-flex';
      li.style.marginRight = '8px';

      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.className = 'btn btn-sm';
      a.innerHTML = `<span style="margin-right:4px;display:inline-flex;vertical-align:text-bottom;">${iconHtml}</span>${label}`;

      li.appendChild(a);

      if (container.firstChild) {
        container.insertBefore(li, container.firstChild);
      } else {
        container.appendChild(li);
      }
    }
  }

  class App {
    static init() {
      Renderer.run();

      const events = ['turbo:load', 'turbo:render', 'pjax:end'];
      const debouncedRun = Core.debounce(() => Renderer.run());

      events.forEach(evt => document.addEventListener(evt, debouncedRun));

      let lastUrl = location.href;
      new MutationObserver(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          debouncedRun();
        } else {
          if (!document.getElementById(`${Config.PREFIX}trending`)) {
            debouncedRun();
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }

})();
