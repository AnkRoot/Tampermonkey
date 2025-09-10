// ==UserScript==
// @name         !.QuantumDOM
// @description  终极DOM实用工具库，结合了事件驱动的高性能与穿透Shadow DOM/Iframe的强大遍历能力
// @version      1.0.8
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0-or-later
// @grant        none
// @api          https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.Api.md
// @doc          https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.Doc.md
// @test         https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.Test.html
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.user.js
// ==/UserScript==

(function () {
  'use strict';

  class QuantumDOMError extends Error { constructor(message) { super(`[QuantumDOM] ${message}`); this.name = this.constructor.name; } }
  class ParseError extends QuantumDOMError { }
  class TimeoutError extends QuantumDOMError { }
  class TraversalError extends QuantumDOMError { }

  class QuantumDOM {
    #win;
    #doc;
    #observerManager = new Map();
    #cache = new Map();

    constructor() {
      this.#win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      this.#doc = this.#win.document;
      this.config = {
        timeout: 10000,
        debug: false,
        cacheEnabled: true,
        cacheTTL: 5 * 60 * 1000,
      };
    }

    configure(options) { Object.assign(this.config, options); this.#log('Configuration updated:', this.config); }
    #log(...args) { if (this.config.debug) console.log('[QuantumDOM]', ...args); }
    #warn(...args) { if (this.config.debug) console.warn('[QuantumDOM]', ...args); }

    #parseQuery(selector) {
      if (typeof selector !== 'string' || !selector.trim()) throw new ParseError('选择器必须是非空字符串。');
      return selector.split('>>>').map(part => {
        const trimmed = part.trim();
        if (!trimmed) throw new ParseError(`选择器片段不能为空: "${selector}"`);
        if (trimmed === 'shadow-root') return { type: 'SHADOW_ROOT' };
        if (trimmed === 'iframe-content') return { type: 'IFRAME_CONTENT' };
        return { type: 'QUERY', selector: trimmed };
      });
    }

    async #waitForIframe(iframe) {
      if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        return iframe.contentDocument;
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new TraversalError(`Iframe 加载超时: ${iframe.src || '(no src)'}`));
        }, this.config.timeout);
        iframe.addEventListener('load', () => {
          clearTimeout(timer);
          resolve(iframe.contentDocument);
        }, { once: true });
      });
    }

    async #executePlan(plan, root) {
      let contexts = [root];
      for (const step of plan) {
        if (contexts.length === 0) break;
        const nextContexts = [];
        for (const ctx of contexts) {
          try {
            if (step.type === 'QUERY') {
              nextContexts.push(...ctx.querySelectorAll(step.selector));
            } else if (step.type === 'SHADOW_ROOT') {
              if (ctx.shadowRoot) nextContexts.push(ctx.shadowRoot);
            } else if (step.type === 'IFRAME_CONTENT') {
              if (ctx.tagName === 'IFRAME') {
                const doc = await this.#waitForIframe(ctx);
                if (doc) nextContexts.push(doc);
              }
            }
          } catch (e) { this.#warn(`遍历步骤失败: ${e.message}`); }
        }
        contexts = nextContexts;
      }
      return contexts;
    }

    #getSharedObserver(rootNode) {
      if (!this.#observerManager.has(rootNode)) {
        const callbacks = new Set();
        const observer = new MutationObserver(() => callbacks.forEach(cb => cb()));
        observer.observe(rootNode, { childList: true, subtree: true });
        this.#observerManager.set(rootNode, { observer, callbacks, refCount: 0 });
      }
      const manager = this.#observerManager.get(rootNode);
      manager.refCount++;
      return {
        addCallback: (cb) => manager.callbacks.add(cb),
        removeCallback: (cb) => {
          manager.callbacks.delete(cb);
          manager.refCount--;
          if (manager.refCount === 0) {
            manager.observer.disconnect();
            this.#observerManager.delete(rootNode);
          }
        },
      };
    }

    async get(selectors, { parent = this.#doc, timeout = this.config.timeout } = {}) {
      const isSingle = !Array.isArray(selectors);
      const selArray = isSingle ? [selectors] : selectors;

      const getOne = (selector) => {
        const cacheKey = `${selector}|${parent.nodeName}`;
        if (this.config.cacheEnabled) {
          const cached = this.#cache.get(cacheKey);
          if (cached && (Date.now() - cached.timestamp < this.config.cacheTTL)) {
            this.#log(`Cache HIT for "${selector}"`);
            return Promise.resolve(cached.value);
          }
        }

        return new Promise(async (resolve, reject) => {
          const plan = this.#parseQuery(selector);
          let observerHandle;

          const check = async () => {
            const contexts = await this.#executePlan(plan, parent);
            if (contexts.length > 0) {
              if (observerHandle) observerHandle.removeCallback(check);
              if (timer) clearTimeout(timer);
              return resolve(contexts[0]);
            }
          };

          const timer = timeout > 0 ? setTimeout(() => {
            if (observerHandle) observerHandle.removeCallback(check);
            reject(new TimeoutError(`元素查找超时: "${selector}"`));
          }, timeout) : null;

          await check();

          observerHandle = this.#getSharedObserver(parent);
          observerHandle.addCallback(check);
        }).then(result => {
          if (this.config.cacheEnabled && result) {
            this.#log(`Cache SET for "${selector}"`);
            this.#cache.set(cacheKey, { value: result, timestamp: Date.now() });
          }
          return result;
        });
      };

      if (isSingle) {
        try {
          return await getOne(selArray[0]);
        } catch (e) {
          this.#warn(e.message);
          if (e instanceof QuantumDOMError) throw e;
          throw new QuantumDOMError(e.message);
        }
      } else {
        return Promise.all(selArray.map(sel => getOne(sel).catch(err => {
          this.#warn(err.message);
          return null;
        })));
      }
    }

    each(selector, callback, { parent = this.#doc } = {}) {
      const plan = this.#parseQuery(selector);
      const stoppers = new Set();
      let active = true;

      const stopAll = () => {
        if (!active) return;
        active = false;
        stoppers.forEach(s => s());
        stoppers.clear();
        this.#log(`each() stopped for selector: "${selector}"`);
      };

      const setupListener = (root, currentPlan) => {
        if (!active || !root) return;
        const handledHosts = new WeakSet();

        let boundaryIndex = currentPlan.findIndex(step => step.type !== 'QUERY');
        const queryPlan = boundaryIndex === -1 ? currentPlan : currentPlan.slice(0, boundaryIndex);
        const boundaryPlan = boundaryIndex === -1 ? [] : currentPlan.slice(boundaryIndex);

        const checkAndProceed = async () => {
          if (!active) return;
          const hosts = queryPlan.length > 0 ? await this.#executePlan(queryPlan, root) : [root];

          for (const host of hosts) {
            if (handledHosts.has(host)) continue;

            if (boundaryPlan.length === 0) {
              handledHosts.add(host);
              if (callback(host) === false) {
                stopAll();
                return;
              }
            } else {
              const boundaryStep = boundaryPlan[0];
              const remainingPlan = boundaryPlan.slice(1);
              const nextRoots = await this.#executePlan([boundaryStep], host);
              if (nextRoots.length > 0) {
                handledHosts.add(host);
                for (const nextRoot of nextRoots) {
                  setupListener(nextRoot, remainingPlan);
                }
              }
            }
          }
        };

        if (root.nodeType === Node.DOCUMENT_NODE || root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
          const observer = this.#getSharedObserver(root);
          observer.addCallback(checkAndProceed);
          stoppers.add(() => observer.removeCallback(checkAndProceed));
        }
        checkAndProceed();
      };

      setupListener(parent, plan);
      return stopAll;
    }

    async on(eventName, selector, callback, { parent = this.#doc } = {}) {
      const plan = this.#parseQuery(selector);
      const targetSelector = plan.pop().selector;
      const rootPlan = plan;

      const attachListener = (root) => {
        const handler = (event) => {
          const target = event.target.closest(targetSelector);
          if (target && root.contains(target)) {
            callback(event, target);
          }
        };
        root.addEventListener(eventName, handler, true);
        return () => root.removeEventListener(eventName, handler, true);
      };

      const contexts = await this.#executePlan(rootPlan, parent);
      if (contexts.length === 0) {
        this.#warn(`on(): 未找到用于附加监听器的父级元素: "${selector}"`);
        return () => { };
      }
      const removers = contexts.map(attachListener);
      return () => removers.forEach(r => r());
    }

    create(htmlString, { parent = null, mapIds = false } = {}) {
      const template = this.#doc.createElement('template');
      template.innerHTML = htmlString.trim();
      const node = template.content.firstElementChild;
      if (!node) return null;
      if (parent && (parent instanceof Element || parent instanceof DocumentFragment)) {
        parent.appendChild(node);
      }
      if (mapIds) {
        const map = { 0: node };
        if (node.id) map[node.id] = node;
        node.querySelectorAll('[id]').forEach(el => { if (el.id) map[el.id] = el; });
        return map;
      }
      return node;
    }

    css(cssText, id = null) {
      if (id && this.#doc.getElementById(id)) {
        return this.#doc.getElementById(id);
      }
      const style = this.create(`<style ${id ? `id="${id}"` : ''}>${cssText}</style>`);
      this.#doc.head.appendChild(style);
      return style;
    }

    clearCache() { this.#cache.clear(); this.#log('Cache cleared.'); }
  }

  const instance = new QuantumDOM();
  instance.QuantumDOMError = QuantumDOMError;
  instance.ParseError = ParseError;
  instance.TimeoutError = TimeoutError;
  instance.TraversalError = TraversalError;
  if (typeof window.QuantumDOM === 'undefined') { window.QuantumDOM = instance; }
})();