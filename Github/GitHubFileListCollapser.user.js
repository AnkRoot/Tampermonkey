// ==UserScript==
// @name         GitHub File List Collapser
// @description  Add a single global collapse button to GitHub repository file lists.
// @version      0.0.3
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0
// @match        https://github.com/*
// @grant        GM_addStyle
// @run-at       document-end
// @icon         https://github.githubassets.com/favicons/favicon.svg
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubFileListCollapser.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubFileListCollapser.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'ghflc-button';
  const COLLAPSED_ATTR = 'data-ghflc-collapsed';
  const BUTTON_HOST_SELECTOR = 'tr[class*="DirectoryContent"] td > div[class*="LatestCommit"]';
  const ICON = `
    <svg aria-hidden="true" focusable="false" class="octicon octicon-chevron-down" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"></path>
    </svg>`;

  GM_addStyle(`
    #${BUTTON_ID} {
      width: 2em;
      height: 2em;
    }

    #${BUTTON_ID}[aria-expanded="false"] {
      rotate: 90deg;
    }

    table[${COLLAPSED_ATTR}] tbody > tr:not(:first-child) {
      display: none !important;
    }
  `);

  const syncButton = (button, table) => {
    const collapsed = table.hasAttribute(COLLAPSED_ATTR);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand file list' : 'Collapse file list');
    button.title = collapsed ? 'Expand file list' : 'Collapse file list';
  };

  const createButton = (table) => {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'Button Button--iconOnly Button--invisible flex-shrink-0 flex-order-1';
    button.innerHTML = ICON;
    button.addEventListener('click', () => {
      table.toggleAttribute(COLLAPSED_ATTR);
      syncButton(button, table);
    });

    syncButton(button, table);
    return button;
  };

  const render = () => {
    const host = document.querySelector(BUTTON_HOST_SELECTOR);
    const table = host?.closest('table');
    if (!host || !table) return;

    const button = document.getElementById(BUTTON_ID);
    if (button && host.contains(button)) return;

    button?.remove();
    host.append(createButton(table));
  };

  let scheduled = false;
  const scheduleRender = () => {
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };

  render();
  new MutationObserver(scheduleRender).observe(document.body, {
    childList: true,
    subtree: true
  });
})();