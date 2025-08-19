// ==UserScript==
// @name         ElmGetter
// @description  异步DOM元素获取和操作库
// @version      1.0.0
// @author       ank
// @namespace    http://010314.xyz/
// @doc          https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetterDoc.md
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/ElmGetter/elmGetter.user.js
// ==/UserScript==
(function () {
  'use strict';

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
      this[_mode] = 'css';
      const elProto = this[_win].Element.prototype;
      this[_matches] = elProto.matches || elProto.matchesSelector || elProto.webkitMatchesSelector || elProto.mozMatchesSelector || elProto.oMatchesSelector;
      this[_MutationObs] = this[_win].MutationObserver || this[_win].WebkitMutationObserver || this[_win].MozMutationObserver;
    }

    observe(target, callback) {
      const unobserve = () => {
        const entry = this[_observers].get(target);
        if (!entry) return;
        const idx = entry.callbacks.indexOf(callback);
        if (idx !== -1) entry.callbacks.splice(idx, 1);
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
        if (!cbs) return;
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            for (const cb of cbs) cb(mutation.target);
          }
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

    query(all, selector, parent = this[_doc], includeParent = false) {
      try {
        if (this[_mode] === 'css') {
          const checkParent = includeParent && this[_matches].call(parent, selector);
          if (all) {
            const queryAll = parent.querySelectorAll(selector);
            return checkParent ? [parent, ...queryAll] : [...queryAll];
          }
          return checkParent ? parent : parent.querySelector(selector);
        }
        if (this[_mode] === 'xpath') {
          const ownerDoc = parent.ownerDocument || parent;
          const resultType = all ? 7 : 9;
          const result = ownerDoc.evaluate(selector, parent, null, resultType, null);
          if (all) {
            return Array.from({ length: result.snapshotLength }, (_, i) => result.snapshotItem(i));
          }
          return result.singleNodeValue;
        }
      } catch (error) {
        console.error('[ElmGetter] Invalid selector or query error.', { selector, parent, error });
      }
      return all ? [] : null;
    }

    get(selector, parent = this[_doc], timeout = 0) {
      if (typeof parent === 'number') {
        [timeout, parent] = [parent, this[_doc]];
      }

      const isSingle = !Array.isArray(selector);
      const selectors = isSingle ? [selector] : selector;
      if (selectors.length === 0) return Promise.resolve(isSingle ? null : []);

      return new Promise(resolve => {
        const results = Array(selectors.length).fill(null);
        const pending = [];
        let pendingCount = 0;

        const checkPending = (checkParent = false) => {
          for (let i = 0; i < pending.length; i++) {
            const item = pending[i];
            if (!item) continue;
            const node = this.query(false, item.selector, checkParent ? parent : document, checkParent);
            if (node) {
              results[item.index] = node;
              pending[i] = null;
              pendingCount--;
            }
          }
        };

        for (let i = 0; i < selectors.length; i++) {
          const node = this.query(false, selectors[i], parent);
          if (node) {
            results[i] = node;
          } else {
            pending.push({ index: i, selector: selectors[i] });
            pendingCount++;
          }
        }

        if (pendingCount === 0) {
          return resolve(isSingle ? results : results);
        }

        let removeObserver;
        let timer;

        const finish = () => {
          if (removeObserver) removeObserver();
          if (timer) clearTimeout(timer);
          resolve(isSingle ? results : results);
        };

        const callback = el => {
          checkPending(el);
          if (pendingCount === 0) finish();
        };

        removeObserver = this.observe(parent, callback);
        checkPending(parent);
        if (pendingCount === 0) return finish();

        if (timeout > 0) {
          timer = setTimeout(finish, timeout);
        }
      });
    }

    each(selector, parent, callback) {
      if (typeof parent === 'function') {
        [callback, parent] = [parent, this[_doc]];
      }
      if (typeof callback !== 'function') {
        console.error('[ElmGetter] each: callback must be a function');
        return () => { };
      }

      const refs = new WeakSet();
      let active = true;

      const processNode = (node, isNew) => {
        if (!active || refs.has(node)) return;
        refs.add(node);
        if (callback(node, isNew) === false) {
          active = false;
        }
      };

      for (const node of this.query(true, selector, parent)) {
        processNode(node, false);
        if (!active) break;
      }

      const stopObserver = this.observe(parent, el => {
        if (!active) return;
        for (const node of this.query(true, selector, el, true)) {
          processNode(node, true);
          if (!active) break;
        }
      });

      return () => {
        active = false;
        if (stopObserver) stopObserver();
      };
    }

    create(domString, parentOrReturnList, parent) {
      if (typeof domString !== 'string') return null;
      let returnList = false;
      if (typeof parentOrReturnList === 'boolean') {
        returnList = parentOrReturnList;
      } else if (parentOrReturnList) {
        parent = parentOrReturnList;
      }

      const node = new DOMParser().parseFromString(domString.trim(), 'text/html').body.firstElementChild;
      if (!node) return null;

      if (parent) parent.appendChild(node);

      if (returnList) {
        const list = { 0: node };
        node.querySelectorAll('[id]').forEach(el => (list[el.id] = el));
        return list;
      }
      return node;
    }

    selector(mode) {
      this[_mode] = mode?.toLowerCase() === 'xpath' ? 'xpath' : 'css';
      return this[_mode];
    }

    get currentSelector() {
      return this[_mode];
    }
  }

  window.elmGetter = new ElmGetter();
})();