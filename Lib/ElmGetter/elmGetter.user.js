// ==UserScript==
// @name         !.ElmGetter 2.0
// @description  新一代高性能异步DOM库，为用户脚本量身打造，提供事件委托和样式注入功能
// @version      2.0.1
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0-or-later
// @grant        none
// @api          https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.Api.md
// @doc          https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.Doc.md
// @test         https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.Test.md
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.user.js
// ==/UserScript==
(function () {
  'use strict';

  class ElmGetter {
    // 使用 # 定义私有字段，确保内部状态不被外部篡改
    #win;
    #doc;
    #selectorMode = 'css';
    #observerManager = new Map(); // 核心优化：共享 MutationObserver 实例

    constructor() {
      this.#win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      this.#doc = this.#win.document;
    }

    /**
     * 内部方法：获取或创建一个针对特定根节点的共享 MutationObserver
     * @param {Node} rootNode - 观察的根节点
     * @returns {{addCallback: Function, removeCallback: Function}}
     */
    #getSharedObserver(rootNode) {
      if (!this.#observerManager.has(rootNode)) {
        const callbacks = new Set();
        const observer = new MutationObserver(mutations => {
          for (const mutation of mutations) {
            for (const addedNode of mutation.addedNodes) {
              if (addedNode.nodeType === Node.ELEMENT_NODE) {
                // 将新增的元素节点分发给所有注册的回调
                callbacks.forEach(cb => cb(addedNode));
              }
            }
          }
        });

        observer.observe(rootNode, { childList: true, subtree: true });

        this.#observerManager.set(rootNode, {
          observer,
          callbacks,
          refCount: 0,
        });
      }

      const manager = this.#observerManager.get(rootNode);
      manager.refCount++;

      return {
        addCallback: (cb) => manager.callbacks.add(cb),
        removeCallback: (cb) => {
          manager.callbacks.delete(cb);
          manager.refCount--;
          if (manager.refCount === 0) {
            // 当没有任何任务监听时，自动断开观察者，释放资源
            manager.observer.disconnect();
            this.#observerManager.delete(rootNode);
          }
        },
      };
    }

    /**
     * 同步查询 DOM 元素
     * @param {string} selector - CSS 或 XPath 选择器
     * @param {{all?: boolean, parent?: Node, includeParent?: boolean}} [options={}] - 查询选项
     * @returns {Element|Element[]|null}
     */
    query(selector, { all = false, parent = this.#doc, includeParent = false } = {}) {
      if (!parent || typeof selector !== 'string') return all ? [] : null;

      try {
        if (this.#selectorMode === 'css') {
          const results = all ? Array.from(parent.querySelectorAll(selector)) : parent.querySelector(selector);
          if (all && includeParent && parent instanceof Element && parent.matches(selector)) {
            results.unshift(parent);
          }
          return results;
        } else { // xpath
          const resultType = all ? XPathResult.ORDERED_NODE_SNAPSHOT_TYPE : XPathResult.ANY_UNORDERED_NODE_TYPE;
          const result = this.#doc.evaluate(selector, parent, null, resultType, null);
          if (all) {
            return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i));
          }
          return result.singleNodeValue;
        }
      } catch (error) {
        console.error('[ElmGetter] 查询失败:', { selector, error });
        return all ? [] : null;
      }
    }

    /**
     * 异步获取一个或多个元素，超时则返回已找到的结果
     * @param {string|string[]} selectors - 单个或多个选择器
     * @param {{parent?: Node, timeout?: number}} [options={}] - 选项
     * @returns {Promise<Element|Element[]|null>}
     */
    get(selectors, { parent = this.#doc, timeout = 0 } = {}) {
      const isSingle = !Array.isArray(selectors);
      const selArray = isSingle ? [selectors] : selectors;

      return new Promise(resolve => {
        const results = Array(selArray.length).fill(null);
        const pending = new Map(selArray.map((sel, i) => [i, sel]));

        for (const [index, selector] of pending.entries()) {
          const found = this.query(selector, { parent });
          if (found) {
            results[index] = found;
            pending.delete(index);
          }
        }

        if (pending.size === 0) {
          return resolve(isSingle ? results[0] : results);
        }

        let observerHandle;
        let timer;

        const cleanup = () => {
          if (observerHandle) observerHandle.removeCallback(callback);
          if (timer) clearTimeout(timer);
        };

        const finish = () => {
          cleanup();
          resolve(isSingle ? results[0] : results);
        };

        const callback = (addedNode) => {
          for (const [index, selector] of pending.entries()) {
            let found = null;
            if (addedNode.matches(selector)) {
              found = addedNode;
            } else {
              found = this.query(selector, { parent: addedNode });
            }

            if (found) {
              results[index] = found;
              pending.delete(index);
            }
          }
          if (pending.size === 0) finish();
        };

        observerHandle = this.#getSharedObserver(parent);
        observerHandle.addCallback(callback);

        if (timeout > 0) {
          timer = setTimeout(finish, timeout);
        }
      });
    }

    /**
     * 持续处理现在和未来所有匹配的元素
     * @param {string} selector - 选择器
     * @param {function(Element, boolean): (void|false)} callback - 回调函数 (element, isNew)。返回 false 可停止观察。
     * @param {{parent?: Node}} [options={}] - 选项
     * @returns {function(): void} - 调用此函数可手动停止观察
     */
    each(selector, callback, { parent = this.#doc } = {}) {
      if (typeof callback !== 'function') {
        console.error('[ElmGetter] each: 回调必须是函数');
        return () => { };
      }

      const processed = new WeakSet();
      let active = true;

      let stop;
      const processNode = (node, isNew) => {
        if (!active || processed.has(node)) return;
        processed.add(node);
        try {
          if (callback(node, isNew) === false) {
            stop(); // 此处调用时，stop 已经被赋值
          }
        } catch (error) {
          console.error('[ElmGetter] each 回调函数执行出错:', error);
          stop();
        }
      };

      const observerCallback = (addedNode) => {
        if (!active) return;
        if (addedNode.matches(selector)) {
          processNode(addedNode, true);
        }
        if (!active) return;
        this.query(selector, { all: true, parent: addedNode }).forEach(node => processNode(node, true));
      };

      const observerHandle = this.#getSharedObserver(parent);

      stop = () => {
        if (!active) return;
        active = false;
        observerHandle.removeCallback(observerCallback);
      };

      observerHandle.addCallback(observerCallback);
      this.query(selector, { all: true, parent }).forEach(node => processNode(node, false));

      return stop;
    }

    /**
     * 为现在和未来的元素提供事件委托
     * @param {string} eventName - 事件名称，如 'click'
     * @param {string} selector - 目标元素的选择器
     * @param {function(Event, Element): void} callback - 事件回调
     * @param {{parent?: Node}} [options={}] - 选项
     * @returns {function(): void} - 调用此函数可移除事件监听
     */
    on(eventName, selector, callback, { parent = this.#doc } = {}) {
      const handler = (event) => {
        const target = event.target.closest(selector);
        if (target && parent.contains(target)) {
          callback(event, target);
        }
      };

      parent.addEventListener(eventName, handler, true);

      return () => parent.removeEventListener(eventName, handler, true);
    }

    /**
     * 从 HTML 字符串创建 DOM 元素
     * @param {string} htmlString - HTML 字符串
     * @param {{parent?: Element, mapIds?: boolean}} [options={}] - 选项
     * @returns {Element|{[key: string]: Element}|null}
     */
    create(htmlString, { parent = null, mapIds = false } = {}) {
      const template = this.#doc.createElement('template');
      template.innerHTML = htmlString.trim();
      const node = template.content.firstElementChild;

      if (!node) return null;
      if (parent instanceof Element) parent.appendChild(node);

      if (mapIds) {
        const map = { 0: node, [node.id]: node };
        node.querySelectorAll('[id]').forEach(el => { if (el.id) map[el.id] = el; });
        return map;
      }
      return node;
    }

    /**
     * 向页面注入 CSS 样式
     * @param {string} css - CSS 样式文本
     * @param {string} [id] - 为 <style> 标签指定一个ID，用于防止重复注入
     * @returns {HTMLStyleElement}
     */
    css(css, id = null) {
      if (id && this.#doc.getElementById(id)) {
        return this.#doc.getElementById(id);
      }
      const style = this.create(`<style ${id ? `id="${id}"` : ''}>${css}</style>`);
      this.#doc.head.appendChild(style);
      return style;
    }

    /**
     * 配置 ElmGetter 实例
     * @param {{selectorMode: 'css'|'xpath'}} options - 配置选项
     */
    config({ selectorMode }) {
      if (selectorMode === 'css' || selectorMode === 'xpath') {
        this.#selectorMode = selectorMode;
      }
      return this;
    }

    get currentSelectorMode() {
      return this.#selectorMode;
    }
  }

  if (typeof window.elmGetter === 'undefined') {
    window.elmGetter = new ElmGetter();
  }
})();