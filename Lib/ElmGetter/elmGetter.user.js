// ==UserScript==
// @name         ElmGetter
// @description  高性能的异步DOM元素获取和操作库
// @version      1.1.0
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

  // 使用 Symbol 创建私有属性，避免外部访问和命名冲突
  const _win = Symbol('win');
  const _doc = Symbol('doc');
  const _observers = Symbol('observers');
  const _mode = Symbol('mode');
  const _matches = Symbol('matches');
  const _MutationObs = Symbol('MutationObs');

  class ElmGetter {
    constructor() {
      this[_win] = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      this[_doc] = this[_win].document;
      this[_observers] = new Map();
      this[_mode] = 'css'; // 默认为 'css' 选择器模式

      // 现代化改进：直接使用标准API，不再需要兼容老旧浏览器的前缀
      this[_matches] = this[_win].Element.prototype.matches;
      this[_MutationObs] = this[_win].MutationObserver;
    }

    /**
     * 观察目标节点下的 DOM 变动 (新增节点、属性变化)
     * @param {Node} target - 被观察的 DOM 节点
     * @param {function(Element): void} callback - 当有元素新增或属性变化时执行的回调
     * @returns {function(): void} - 调用此函数可停止观察
     */
    observe(target, callback) {
      const unobserve = () => {
        const entry = this[_observers].get(target);
        if (!entry) return;
        const idx = entry.callbacks.indexOf(callback);
        if (idx > -1) {
          entry.callbacks.splice(idx, 1);
        }
        // 当没有回调时，断开观察者并清理 Map
        if (entry.callbacks.length === 0) {
          entry.observer.disconnect();
          this[_observers].delete(target);
        }
      };

      if (this[_observers].has(target)) {
        this[_observers].get(target).callbacks.push(callback);
        return unobserve;
      }

      const observer = new this[_MutationObs](mutations => {
        const cbs = this[_observers].get(target)?.callbacks;
        if (!cbs || cbs.length === 0) return;

        for (const mutation of mutations) {
          // 处理属性变化，将目标元素传递给回调
          if (mutation.type === 'attributes') {
            for (const cb of cbs) cb(mutation.target);
          }
          // 处理新增节点，将每个新增的 Element 节点传递给回调
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              for (const cb of cbs) cb(node);
            }
          }
        }
      });

      this[_observers].set(target, { observer, callbacks: [callback] });
      observer.observe(target, { childList: true, subtree: true, attributes: true });
      return unobserve;
    }

    /**
     * DOM 查询的统一接口，支持 CSS 和 XPath
     * @param {boolean} all - 是否查询所有匹配的元素
     * @param {string} selector - 选择器字符串
     * @param {Node} parent - 查询的起始节点
     * @param {boolean} includeParent - 结果是否包含 parent 自身（如果匹配）
     * @returns {Element|Element[]|null} - 查询结果
     */
    query(all, selector, parent = this[_doc], includeParent = false) {
      if (!parent || !selector || typeof selector !== 'string') {
        return all ? [] : null;
      }

      try {
        if (this[_mode] === 'css') {
          const checkParent = includeParent && parent instanceof Element && this[_matches].call(parent, selector);
          if (all) {
            const results = Array.from(parent.querySelectorAll(selector));
            if (checkParent) {
              results.unshift(parent);
            }
            return results;
          }
          return checkParent ? parent : parent.querySelector(selector);
        }

        if (this[_mode] === 'xpath') {
          const ownerDoc = parent.ownerDocument || parent;
          // XPathResult.ORDERED_NODE_SNAPSHOT_TYPE = 7
          // XPathResult.FIRST_ORDERED_NODE_TYPE = 9
          const resultType = all ? 7 : 9;
          const result = ownerDoc.evaluate(selector, parent, null, resultType, null);
          if (all) {
            return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i));
          }
          return result.singleNodeValue;
        }
      } catch (error) {
        console.error('[ElmGetter] 查询错误或选择器无效:', { selector, parent, error });
      }
      return all ? [] : null;
    }

    /**
     * 异步获取一个或多个元素，超时则返回已找到的元素
     * @param {string|string[]} selector - 单个选择器或选择器数组
     * @param {Node|number} [parent=document] - 起始节点或超时时间
     * @param {number} [timeout=0] - 超时时间 (ms)，0 表示不超时
     * @returns {Promise<Element|Element[]|null>} - 匹配的元素或元素数组
     */
    get(selector, parent = this[_doc], timeout = 0) {
      // 优雅地处理灵活的参数顺序: get(selector, timeout) 或 get(selector, parent, timeout)
      if (typeof parent === 'number') {
        [timeout, parent] = [parent, this[_doc]];
      }

      const isSingle = !Array.isArray(selector);
      const selectors = isSingle ? [selector] : selector;
      if (selectors.length === 0) return Promise.resolve(isSingle ? null : []);

      return new Promise(resolve => {
        const results = Array(selectors.length).fill(null);
        let pending = new Map(); // 使用 Map 存储待处理项，方便通过索引查找和删除
        
        // 1. 初始查询，找出已存在的元素
        for (let i = 0; i < selectors.length; i++) {
          const node = this.query(false, selectors[i], parent);
          if (node) {
            results[i] = node;
          } else {
            pending.set(i, selectors[i]);
          }
        }

        if (pending.size === 0) {
          return resolve(isSingle ? results[0] : results);
        }

        let removeObserver;
        let timer;

        const finish = () => {
          if (removeObserver) removeObserver();
          if (timer) clearTimeout(timer);
          resolve(isSingle ? results[0] : results);
        };

        // 2. **【核心优化】** 创建一个高效的回调函数来处理 DOM 变动
        const callback = (addedNode) => {
          for (const [index, sel] of pending.entries()) {
            let foundNode = null;
            // 检查新增节点本身是否匹配
            if (this[_matches].call(addedNode, sel)) {
              foundNode = addedNode;
            } else {
              // 否则，仅在新增节点内部查找
              foundNode = this.query(false, sel, addedNode);
            }
            
            if (foundNode) {
              results[index] = foundNode;
              pending.delete(index); // 找到后从待处理中移除
            }
          }

          if (pending.size === 0) {
            finish();
          }
        };

        // 3. 启动观察者
        removeObserver = this.observe(parent, callback);

        // 再次检查，防止在设置观察者和实际观察到之间有元素出现
        for (const [index, sel] of pending.entries()) {
            const node = this.query(false, sel, parent);
            if (node) {
                results[index] = node;
                pending.delete(index);
            }
        }
        if (pending.size === 0) return finish();

        if (timeout > 0) {
          timer = setTimeout(finish, timeout);
        }
      });
    }

    /**
     * 遍历处理所有现在和未来匹配选择器的元素
     * @param {string} selector - CSS 或 XPath 选择器
     * @param {Node|Function} parent - 起始节点或回调函数
     * @param {Function} [callback] - 回调函数
     * @returns {function(): void} - 调用此函数可停止遍历和观察
     */
    each(selector, parent, callback) {
      if (typeof parent === 'function') {
        [callback, parent] = [parent, this[_doc]];
      } else if (!parent || !(parent instanceof Node)) {
        parent = this[_doc];
      }

      if (typeof callback !== 'function') {
        console.error('[ElmGetter] each: 回调必须是一个函数');
        return () => {};
      }

      const refs = new WeakSet(); // 使用 WeakSet 防止内存泄漏，并避免重复处理同一元素
      let active = true;

      const processNode = (node, isNew) => {
        if (!active || !node || refs.has(node)) return;
        refs.add(node);
        try {
          if (callback(node, isNew) === false) {
            stop();
          }
        } catch (error) {
          console.error('[ElmGetter] each 回调函数执行出错:', error);
          stop(); // 出错时停止，防止无限循环的错误
        }
      };
      
      let stopObserver = null;
      const stop = () => {
        active = false;
        if (stopObserver) {
          stopObserver();
          stopObserver = null;
        }
      };

      // 延迟执行，确保返回 stop 函数后再开始处理
      setTimeout(() => {
        if (!active) return;

        // 1. 处理已存在的元素
        const existingNodes = this.query(true, selector, parent);
        for (const node of existingNodes) {
          if (!active) break;
          processNode(node, false);
        }

        if (!active) return;
        
        // 2. **【核心优化】** 设置观察者，只处理新增的、匹配的节点
        stopObserver = this.observe(parent, (node) => {
          if (!active) return;
          // 检查节点本身是否匹配
          if (this[_matches].call(node, selector)) {
            processNode(node, true);
          }
          if (!active) return;
          // 检查其后代中是否有匹配的元素
          const newNodes = this.query(true, selector, node);
          for (const childNode of newNodes) {
            if (!active) break;
            processNode(childNode, true);
          }
        });
      }, 0);

      return stop;
    }

    /**
     * 从 HTML 字符串创建 DOM 元素
     * @param {string} domString - 包含HTML的字符串
     * @param {boolean|Element} [parentOrReturnList=false] - 如果是布尔值，决定是否返回ID映射表；如果是元素，则将创建的节点追加进去
     * @param {Element} [parent] - (可选) 将创建的节点追加到此父元素
     * @returns {Element|Object|null} - 返回创建的元素，或一个包含根元素和ID映射的列表
     */
    create(domString, parentOrReturnList, parent) {
      if (typeof domString !== 'string' || !domString.trim()) return null;

      let returnList = false;
      if (typeof parentOrReturnList === 'boolean') {
        returnList = parentOrReturnList;
      } else if (parentOrReturnList instanceof Element) {
        parent = parentOrReturnList;
      }

      // 使用 template 元素比 DOMParser 更高效、更安全
      const template = this[_doc].createElement('template');
      template.innerHTML = domString.trim();
      const node = template.content.firstElementChild;

      if (!node) return null;
      if (parent instanceof Element) parent.appendChild(node);

      if (returnList) {
        const list = { 0: node };
        if (node.id) {
          list[node.id] = node;
        }
        node.querySelectorAll('[id]').forEach(el => {
          if (el.id) list[el.id] = el;
        });
        return list;
      }
      return node;
    }

    /**
     * 设置或获取当前的选择器模式
     * @param {'css'|'xpath'} [mode] - 要设置的模式
     * @returns {string} - 当前的模式
     */
    selector(mode) {
      const lowerMode = mode?.toLowerCase();
      if (lowerMode === 'xpath' || lowerMode === 'css') {
        this[_mode] = lowerMode;
      }
      return this[_mode];
    }

    get currentSelector() {
      return this[_mode];
    }
  }

  // 将实例挂载到 window 对象上
  if (typeof window.elmGetter === 'undefined') {
    window.elmGetter = new ElmGetter();
  }
})();