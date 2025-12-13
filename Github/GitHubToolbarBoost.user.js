// ==UserScript==
// @name         !.GitHub Toolbar Boost
// @description  顶部 Trending 入口，仓库工具栏加入 Github.dev / DeepWiki / CodeWiki / ZreadAi 按钮。
// @version      0.0.2
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

  const DEBUG = false;

  const IDS = Object.freeze({
    trending: 'gh-boost-trending',
    repoGroup: 'gh-boost-repo-links'
  });

  const SELECTORS = Object.freeze({
    headerActions: '.AppHeader-actions',
    headerRef: ['notification-indicator', '.AppHeader-user', '.AppHeader-globalBar-end'],
    repoActions: [
      'ul.pagehead-actions',
      '.pagehead-actions',
      '.file-navigation .d-flex',
      'nav[aria-label="Repository"] .d-flex'
    ]
  });

  const ICONS = Object.freeze({
    trending: `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-graph"><path d="M1.5 1.75V13.5h13.75a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75V1.75a.75.75 0 0 1 1.5 0Zm14.28 2.53-5.25 5.25a.75.75 0 0 1-1.06 0L7 7.06 4.28 9.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.25-3.25a.75.75 0 0 1 1.06 0L10 7.94l4.72-4.72a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z"></path></svg>`,
    githubDev: `<img class="octicon" width="16" height="16" alt="" src="https://github.com/favicons/favicon-codespaces.svg" />`,
    deepWiki: `<svg class="octicon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
    zreadAi: `<svg aria-hidden="true" viewBox="0 0 32 32" width="16" height="16" class="octicon"><path d="M9.919 3.2h-5.44c-.7 0-1.28.57-1.28 1.28v5.44c0 .7.57 1.28 1.28 1.28h5.44c.7 0 1.28-.57 1.28-1.28V4.48c0-.7-.57-1.28-1.28-1.28zm0 17.6h-5.44c-.7 0-1.28.57-1.28 1.28v5.44c0 .7.57 1.28 1.28 1.28h5.44c.7 0 1.28-.57 1.28-1.28v-5.44c0-.7-.57-1.28-1.28-1.28zm17.6-17.6h-5.44c-.7 0-1.28.57-1.28 1.28v5.44c0 .7.57 1.28 1.28 1.28h5.44c.7 0 1.28-.57 1.28-1.28V4.48c0-.7-.57-1.28-1.28-1.28zM8 24L24 8L8 24z" fill="currentColor"></path><path d="M8 24L24 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`,
    codeWiki: `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" class="octicon" fill="currentColor"><path d="M5.5 3.5 2 8l3.5 4.5.9-.7L3.6 8l2.8-3.8-.9-.7Zm5 0-.9.7L12.4 8l-2.8 3.8.9.7L14 8 10.5 3.5Z"></path></svg>`
  });

  const qAny = (selectors, base = document) => {
    if (typeof selectors === 'string') return base.querySelector(selectors);
    for (const sel of selectors) {
      const el = base.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const debounce = (fn, ms = 120) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const urls = () => {
    const pathInfo = location.pathname + location.search + location.hash;
    return {
      trending: '/trending',
      githubDev: `https://github.dev${pathInfo}`,
      zreadAi: `https://zread.ai${pathInfo}`,
      deepWiki: `https://deepwiki.com${pathInfo}`,
      codeWiki: `https://codewiki.google/${location.hostname}${location.pathname}`
    };
  };

  const needRepoLinks = () => {
    const container = qAny(SELECTORS.repoActions);
    if (!container) return false;
    return !document.getElementById(IDS.repoGroup);
  };

  const needRender = () => !document.getElementById(IDS.trending) || needRepoLinks();

  const iconBtn = (href, title, iconHtml) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'btn btn-sm';
    a.title = title;
    a.setAttribute('aria-label', title);
    a.innerHTML = iconHtml;
    return a;
  };

  const injectTrending = () => {
    if (document.getElementById(IDS.trending)) return;
    const container = document.querySelector(SELECTORS.headerActions);
    if (!container) return;

    const btn = document.createElement('a');
    btn.id = IDS.trending;
    btn.href = '/trending';
    btn.className = 'Button Button--iconOnly Button--secondary Button--medium AppHeader-button color-fg-muted';
    btn.setAttribute('aria-label', 'Trending');
    btn.title = 'Trending';
    btn.innerHTML = ICONS.trending;

    const ref = qAny(SELECTORS.headerRef, container);
    if (ref) container.insertBefore(btn, ref);
    else container.appendChild(btn);
  };

  const injectRepoLinks = (container) => {
    if (document.getElementById(IDS.repoGroup)) return;

    const wrap = document.createElement(container.tagName === 'UL' || container.tagName === 'OL' ? 'li' : 'div');
    wrap.id = IDS.repoGroup;
    wrap.className = 'd-flex';
    wrap.style.marginRight = '8px';
    wrap.style.gap = '6px';
    wrap.style.flexWrap = 'nowrap';
    wrap.style.alignItems = 'center';

    const u = urls();
    const links = [
      { href: u.githubDev, title: 'Github.dev', icon: ICONS.githubDev },
      { href: u.codeWiki, title: 'CodeWiki', icon: ICONS.codeWiki },
      { href: u.deepWiki, title: 'DeepWiki', icon: ICONS.deepWiki },
      { href: u.zreadAi, title: 'ZreadAi', icon: ICONS.zreadAi }
    ];

    links.forEach(({ href, title, icon }) => wrap.appendChild(iconBtn(href, title, icon)));

    const first = container.firstElementChild;
    if (first) container.insertBefore(wrap, first);
    else container.appendChild(wrap);
  };

  const render = () => {
    if (!needRender()) return;

    injectTrending();

    const repoContainer = qAny(SELECTORS.repoActions);
    if (repoContainer) injectRepoLinks(repoContainer);
  };

  const boot = () => {
    const run = debounce(() => {
      try {
        render();
      } catch (err) {
        if (DEBUG) console.warn('[gh-boost] render failed', err);
      }
    }, 120);

    run();
    ['turbo:load', 'turbo:render', 'pjax:end'].forEach(evt => document.addEventListener(evt, run));

    let last = location.href;
    new MutationObserver(() => {
      const urlChanged = location.href !== last;
      if (urlChanged) last = location.href;
      if (urlChanged || needRender()) run();
    }).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
