// ==UserScript==
// @name         !.GitHub Freshness
// @description  🔍 为 GitHub 的所有时间标记提供“新鲜度可视化增强”。
//               自动为 relative-time / time-ago / local-time / time[datetime] 等组件添加
//               清晰的时间鲜度状态标签，让你一眼识别仓库、Issue、PR、Commit 的活跃程度。
// 
//               ◼ 功能特点：
//                 • 新鲜度分级：
//                     🟢 active   — 过去 60 天内更新的内容（高活跃度）
//                     🟡 inactive — 60～180 天内更新的内容（一般）
//                     🔴 stale    — 180 天以上未更新（陈旧）
// 
//                 • 自动适配 GitHub 深色/浅色主题：
//                   使用内建颜色变量 (--fgColor-*/--bgColor-* muted) 实现无侵入式视觉融合。
// 
//                 • UI 风格：
//                   胶囊状标签、轻量边框、半透明衰减（stale），确保突出重点但视觉不过载。
// 
//                 • 强健的 DOM 监听：
//                   通过 MutationObserver 监控 GitHub 动态页面（PJAX、SPA-like 加载），
//                   对新增节点做增量式处理，无需再刷新页面。
// 
//                 • 高性能设计：
//                   仅处理新增节点子树，避免全量扫描；内部采用标记属性防止重复处理。
// 
//                 • 全站覆盖：
//                   适用于：仓库主页、Commit 列表、PR/Issue 列表、对话区、贡献图、讨论区等所有使用 GitHub 时间组件的区域。
// 
//               ◼ 使用价值：
//                 • 快速判断仓库是否活跃（Star 前必看！）
//                 • 浏览 Issue/PR 时立即看出哪些是“新鲜讨论”，哪些已久未处理
//                 • 在贡献者视图中更快理解提交活跃度趋势
//                 • 项目维护者可迅速识别长期无人更新的内容段
//
//               —— 一个让“时间信息真正有意义”的 GitHub 增强脚本。
// @version      1.1.1
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0
// @match        https://github.com/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubFreshness.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubFreshness.user.js
// ==/UserScript==

(function () {
  'use strict';

  class GitHubFreshness {
    // 配置
    static #CONFIG = {
      DAYS: {
        ACTIVE: 60,   // ≤ 60 天
        INACTIVE: 180 // 60 ~ 180 天
      },
      // 覆盖 GitHub 常见时间组件：relative-time / time-ago / local-time / 通用 time[datetime]
      SELECTOR: [
        'relative-time[datetime]',
        'time-ago[datetime]',
        'local-time[datetime]',
        'time[datetime]'
      ].join(', '),
      ATTR: {
        STATUS: 'data-gfh-status',
        PROCESSED: 'data-gfh-processed'
      },
      STYLE_ID: 'gfh-style-v3',
      MS_PER_DAY: 24 * 60 * 60 * 1000
    };

    #observer = null;

    constructor() {
      this.#init();
    }

    // 注入样式（使用 GitHub 原生变量，自动适配主题）
    #injectCSS() {
      const { ATTR, STYLE_ID } = GitHubFreshness.#CONFIG;
      if (document.getElementById(STYLE_ID)) return;

      const css = `
        [${ATTR.STATUS}] {
          font-weight: 600 !important;
          padding: 2px 6px;
          border-radius: 6px;
          transition: all 0.2s ease;
          display: inline-block;
          line-height: 1.2;
          box-sizing: border-box;
        }

        [${ATTR.STATUS}="active"] {
          color: var(--fgColor-success, #2da44e) !important;
          background-color: var(--bgColor-success-muted, rgba(45,164,78,0.15));
          border: 1px solid var(--borderColor-success-muted, transparent);
        }

        [${ATTR.STATUS}="inactive"] {
          color: var(--fgColor-attention, #9a6700) !important;
          background-color: var(--bgColor-attention-muted, rgba(210,153,34,0.15));
          border: 1px solid var(--borderColor-attention-muted, transparent);
        }

        [${ATTR.STATUS}="stale"] {
          color: var(--fgColor-danger, #cf222e) !important;
          opacity: 0.85;
          text-decoration: none;
        }

        @media (prefers-reduced-motion: reduce) {
          [${ATTR.STATUS}] {
            transition: none !important;
          }
        }
      `;

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.type = 'text/css';
      style.textContent = css;
      document.head.appendChild(style);
    }

    // 计算新鲜度
    #calculateStatus(dateString) {
      try {
        const target = new Date(dateString).getTime();
        if (Number.isNaN(target)) return null;

        const diffDays = (Date.now() - target) / GitHubFreshness.#CONFIG.MS_PER_DAY;
        const { DAYS } = GitHubFreshness.#CONFIG;

        if (diffDays <= DAYS.ACTIVE) return 'active';
        if (diffDays <= DAYS.INACTIVE) return 'inactive';
        return 'stale';
      } catch {
        return null;
      }
    }

    // 处理单个时间节点
    #processNode(el) {
      const { ATTR } = GitHubFreshness.#CONFIG;

      if (!(el instanceof HTMLElement)) return;
      if (el.hasAttribute(ATTR.PROCESSED)) return;

      const datetime = el.getAttribute('datetime');
      if (!datetime) return;

      const status = this.#calculateStatus(datetime);
      if (!status) return;

      el.setAttribute(ATTR.STATUS, status);
      el.setAttribute(ATTR.PROCESSED, 'true');
    }

    // 处理一个子树（用于增量更新）
    #processTree(root) {
      if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

      const { SELECTOR } = GitHubFreshness.#CONFIG;
      const element = /** @type {Element} */ (root);

      if (element.matches && element.matches(SELECTOR)) {
        this.#processNode(element);
      }

      if (element.querySelectorAll) {
        const nodes = element.querySelectorAll(SELECTOR);
        for (const node of nodes) {
          this.#processNode(node);
        }
      }
    }

    // 初次全量扫描
    #processInitial() {
      const { SELECTOR } = GitHubFreshness.#CONFIG;
      const nodes = document.querySelectorAll(SELECTOR);
      for (const node of nodes) {
        this.#processNode(node);
      }
    }

    // 监听 DOM 变更，增量处理
    #initObserver() {
      this.#observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;
          for (const node of mutation.addedNodes) {
            this.#processTree(node);
          }
        }
      });

      this.#observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    #init() {
      this.#injectCSS();
      this.#processInitial();
      this.#initObserver();
    }

    static run() {
      new GitHubFreshness();
    }
  }

  GitHubFreshness.run();
})();
