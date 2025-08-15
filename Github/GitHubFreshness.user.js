// ==UserScript==
// @name         !.GitHub Freshness Pro
// @description  🚀 GitHub仓库新鲜度可视化工具 - 多级颜色系统
// @version      0.0.1
// @author       ank
// @namespace    http://010314.xyz/
// @match        https://github.com/*/*
// @match        https://github.com/search?*
// @match        https://github.com/*/tree/*
// @match        https://github.com/*/*/blob/*
// @match        https://github.com/*/*/commits/*
// @match        https://github.com/*/*/releases
// @match        https://github.com/*/*/tags
// @match        https://github.com/*/*/issues
// @match        https://github.com/*/*/pulls
// @match        https://github.com/trending*
// @match        https://github.com/explore*
// @match        https://github.com/stars*
// @match        https://github.com/watching*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Github/GitHubFreshness.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ===== 简化配置系统 =====
  const CONFIG = {
    // 多级时间阈值配置（天）
    TIME_LEVELS: {
      VERY_FRESH: 7, // 极新鲜：1-7天
      FRESH: 30, // 较新鲜：8-30天
      NORMAL: 90, // 一般：31-90天
      OLD: 180, // 较旧：91-180天
      // 很旧：180天以上
    },

    // 多级颜色配置
    COLORS: {
      VERY_FRESH: { color: '#22c55e', bg: '#f0fdf4', name: '极新鲜' },
      FRESH: { color: '#84cc16', bg: '#f7fee7', name: '较新鲜' },
      NORMAL: { color: '#eab308', bg: '#fefce8', name: '一般' },
      OLD: { color: '#f97316', bg: '#fff7ed', name: '较旧' },
      VERY_OLD: { color: '#ef4444', bg: '#fef2f2', name: '很旧' },
    },

    // 调试模式
    DEBUG: false,
  };

  // ===== 工具函数 =====
  const Utils = {
    log(...args) {
      if (CONFIG.DEBUG) {
        console.log('[GitHub Freshness Simplified]', ...args);
      }
    },

    debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },
  };

  // ===== 时间分级器 =====
  const TimeClassifier = {
    /**
     * 根据时间差分类时间级别
     * @param {string} dateString - ISO日期字符串
     * @returns {string} - 时间级别
     */
    classify(dateString) {
      if (!dateString) return 'VERY_OLD';

      try {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        Utils.log(`Date: ${dateString}, Days ago: ${diffDays}`);

        if (diffDays <= CONFIG.TIME_LEVELS.VERY_FRESH) return 'VERY_FRESH';
        if (diffDays <= CONFIG.TIME_LEVELS.FRESH) return 'FRESH';
        if (diffDays <= CONFIG.TIME_LEVELS.NORMAL) return 'NORMAL';
        if (diffDays <= CONFIG.TIME_LEVELS.OLD) return 'OLD';
        return 'VERY_OLD';
      } catch (error) {
        Utils.log('Error parsing date:', dateString, error);
        return 'VERY_OLD';
      }
    },
  };

  // ===== 统一高亮器 =====
  const Highlighter = {
    /**
     * 高亮元素
     * @param {Element} element - 要高亮的元素
     * @param {string} level - 时间级别
     */
    highlight(element, level) {
      if (!element || !CONFIG.COLORS[level]) return;

      const config = CONFIG.COLORS[level];

      // 设置元素样式
      element.style.setProperty('color', config.color, 'important');
      element.style.setProperty('font-weight', level === 'VERY_FRESH' ? 'bold' : 'normal', 'important');

      // 设置容器背景
      this.setContainerBackground(element, config);

      Utils.log(`Highlighted element as ${config.name}:`, element);
    },

    /**
     * 设置容器背景
     * @param {Element} element - 时间元素
     * @param {Object} config - 颜色配置
     */
    setContainerBackground(element, config) {
      // 查找合适的容器
      const containers = [
        element.closest('tr'),
        element.closest('.Box-row'),
        element.closest('li'),
        element.closest('article'),
        element.closest('[data-testid*="row"]'),
        element.closest('[data-testid*="item"]'),
        element.closest('[data-testid*="card"]'),
      ];

      for (const container of containers) {
        if (container) {
          container.style.setProperty('background-color', config.bg, 'important');
          container.style.setProperty('border-left', `3px solid ${config.color}`, 'important');
          break;
        }
      }
    },
  };

  // ===== 统一选择器管理器 =====
  const SelectorManager = {
    /**
     * 获取通用时间元素选择器
     * @returns {Array} - 选择器数组
     */
    getTimeSelectors() {
      return [
        // 2025年核心选择器
        'relative-time[datetime]',
        'time[datetime]',

        // data-testid选择器
        '[data-testid*="commit"] relative-time',
        '[data-testid*="issue"] relative-time',
        '[data-testid*="pull"] relative-time',
        '[data-testid*="release"] relative-time',
        '[data-testid*="repo"] relative-time',
        '[data-testid*="result"] relative-time',

        // 容器选择器
        '.Box relative-time',
        '.Box-row relative-time',
        'article relative-time',
        'li relative-time',
        'tr relative-time',

        // 备用选择器
        'relative-time',
        'time-ago[datetime]',
        'time-ago',
      ];
    },

    /**
     * 查找页面中的时间元素
     * @returns {Array} - 时间元素数组
     */
    findTimeElements() {
      const selectors = this.getTimeSelectors();
      let elements = [];

      for (const selector of selectors) {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          elements = Array.from(found);
          Utils.log(`Found ${found.length} elements with selector: ${selector}`);
          break; // 使用第一个有效的选择器
        }
      }

      return elements;
    },
  };

  // ===== 统一页面处理器 =====
  const PageProcessor = {
    /**
     * 处理当前页面
     */
    process() {
      Utils.log('Processing page:', window.location.href);

      const timeElements = SelectorManager.findTimeElements();

      if (timeElements.length === 0) {
        Utils.log('No time elements found');
        return;
      }

      let processedCount = 0;
      timeElements.forEach(element => {
        const datetime = element.getAttribute('datetime');
        if (datetime) {
          const level = TimeClassifier.classify(datetime);
          Highlighter.highlight(element, level);
          processedCount++;
        }
      });

      Utils.log(`Processed ${processedCount} time elements`);
    },
  };

  // ===== CSS样式注入 =====
  const injectCSS = () => {
    const styles = Object.entries(CONFIG.COLORS)
      .map(
        ([level, config]) => `
      .github-freshness-${level.toLowerCase()} {
        color: ${config.color} !important;
        font-weight: ${level === 'VERY_FRESH' ? 'bold' : 'normal'} !important;
      }
      .github-freshness-${level.toLowerCase()}-bg {
        background-color: ${config.bg} !important;
        border-left: 3px solid ${config.color} !important;
      }
    `
      )
      .join('');

    const style = document.createElement('style');
    style.textContent = `/* GitHub Freshness Simplified Styles */${styles}`;
    document.head.appendChild(style);
    Utils.log('CSS styles injected');
  };

  // ===== 事件管理器 =====
  const EventManager = {
    init() {
      const debouncedProcess = Utils.debounce(() => {
        PageProcessor.process();
      }, 300);

      // 页面加载完成后处理
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', debouncedProcess);
      } else {
        setTimeout(debouncedProcess, 500);
      }

      // GitHub PJAX导航
      document.addEventListener('pjax:end', debouncedProcess);

      // URL变化监听
      this.observeUrlChanges(debouncedProcess);

      // DOM变化监听
      this.observeDOMChanges(debouncedProcess);
    },

    observeUrlChanges(callback) {
      let lastUrl = location.href;
      const observer = new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          Utils.log('URL changed:', currentUrl);
          setTimeout(callback, 100);
        }
      });
      observer.observe(document, { subtree: true, childList: true });
    },

    observeDOMChanges(callback) {
      const observer = new MutationObserver(
        Utils.debounce(mutations => {
          const hasTimeElements = mutations.some(mutation => {
            return Array.from(mutation.addedNodes).some(node => {
              return node.nodeType === Node.ELEMENT_NODE && node.querySelector && node.querySelector('relative-time');
            });
          });

          if (hasTimeElements) {
            Utils.log('Time elements added to DOM');
            callback();
          }
        }, 500)
      );

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },
  };

  // ===== 配置面板 =====
  const ConfigPanel = {
    show() {
      const panel = this.createPanel();
      document.body.appendChild(panel);

      // 点击外部关闭
      panel.addEventListener('click', e => {
        if (e.target === panel) {
          panel.remove();
        }
      });
    },

    createPanel() {
      const panel = document.createElement('div');
      panel.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      const content = document.createElement('div');
      content.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 20px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      `;

      content.innerHTML = `
        <h2 style="margin: 0 0 20px 0; color: #333;">GitHub Freshness 多级颜色系统</h2>
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; color: #666;">时间分级说明：</h3>
          ${this.createLevelDisplay()}
        </div>
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; color: #666;">当前配置：</h3>
          ${this.createConfigDisplay()}
        </div>
        <button onclick="this.parentElement.parentElement.remove()"
                style="background: #0969da; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
          关闭
        </button>
      `;

      panel.appendChild(content);
      return panel;
    },

    createLevelDisplay() {
      return Object.entries(CONFIG.COLORS)
        .map(
          ([level, config]) => `
        <div style="display: flex; align-items: center; margin: 8px 0; padding: 8px; border-radius: 4px; background: ${config.bg
            }; border-left: 3px solid ${config.color};">
          <span style="color: ${config.color}; font-weight: bold; margin-right: 10px;">●</span>
          <span style="color: ${config.color}; font-weight: bold;">${config.name}</span>
          <span style="margin-left: auto; color: #666; font-size: 12px;">
            ${this.getLevelDescription(level)}
          </span>
        </div>
      `
        )
        .join('');
    },

    createConfigDisplay() {
      return `
        <div style="font-family: monospace; font-size: 12px; background: #f6f8fa; padding: 10px; border-radius: 4px;">
          极新鲜: ≤ ${CONFIG.TIME_LEVELS.VERY_FRESH} 天<br>
          较新鲜: ≤ ${CONFIG.TIME_LEVELS.FRESH} 天<br>
          一般: ≤ ${CONFIG.TIME_LEVELS.NORMAL} 天<br>
          较旧: ≤ ${CONFIG.TIME_LEVELS.OLD} 天<br>
          很旧: > ${CONFIG.TIME_LEVELS.OLD} 天
        </div>
      `;
    },

    getLevelDescription(level) {
      const descriptions = {
        VERY_FRESH: '1-7天',
        FRESH: '8-30天',
        NORMAL: '31-90天',
        OLD: '91-180天',
        VERY_OLD: '180天以上',
      };
      return descriptions[level] || '';
    },
  };

  // ===== 添加菜单命令 =====
  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('🎨 查看颜色分级', () => ConfigPanel.show());
  }

  // ===== 主入口 =====
  Utils.log('GitHub Freshness Simplified Pro initialized');
  injectCSS();
  EventManager.init();
})();
