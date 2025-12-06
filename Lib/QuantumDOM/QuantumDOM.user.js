// ==UserScript==
// @name         !.QuantumDOM
// @description  终极 DOM 库：ES2022 语法、内存安全缓存、ShadowDOM/Iframe 穿透、遵循 DRY/KISS 原则。
// @version      2.1.1
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0
// @grant        none
// @doc          https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.Doc.md
// @test         https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.Test.html
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Lib/QuantumDOM/QuantumDOM.user.js
// ==/UserScript==

(function () {
    'use strict';

    /**
     * [Layer 1] Constants & Configuration
     * 集中管理魔法字符串和默认配置
     */
    const TOKENS = {
        SEP: '>>>',
        SHADOW: 'shadow-root',
        IFRAME: 'iframe-content'
    };

    const NODE_TYPES = {
        ELEMENT: 1,
        DOCUMENT: 9,
        FRAGMENT: 11
    };

    // 公共工具函数
    const Utils = {
        isValidContext(node) {
            return node && Object.values(NODE_TYPES).includes(node.nodeType);
        },

        isIframeReady(iframe) {
            try {
                const doc = iframe.contentDocument;
                return doc && doc.readyState === 'complete' && doc.location.href !== 'about:blank';
            } catch (e) {
                return false;
            }
        },

        createCleanupManager() {
            const tasks = new Set();
            return {
                add(task) {
                    tasks.add(task);
                    return () => tasks.delete(task);
                },
                execute() {
                    tasks.forEach(task => {
                        try {
                            task();
                        } catch (e) {
                            console.error('[QDOM] Cleanup error:', e);
                        }
                    });
                    tasks.clear();
                },
                get size() { return tasks.size; }
            };
        }
    };

    class QError extends Error {
        constructor(msg, code = 'GENERIC') {
            super(`[QuantumDOM] ${msg}`);
            this.name = 'QuantumError';
            this.code = code;
        }
    }
    class TimeoutError extends QError { constructor(m) { super(m, 'TIMEOUT'); } }

    class Config {
        #data = {
            timeout: 10_000,
            debug: false,
            cache: true,
            cacheTTL: 300_000
        };

        get(key) { return this.#data[key]; }
        getAll() { return { ...this.#data }; }
        update(opts) { Object.assign(this.#data, opts); }
    }

    class Logger {
        #config;
        constructor(config) { this.#config = config; }
        log(...args) { if (this.#config.get('debug')) console.log('%c[QDOM]', 'color:#00a8ff', ...args); }
        warn(...args) { if (this.#config.get('debug')) console.warn('[QDOM]', ...args); }
        error(...args) { console.error('[QDOM]', ...args); }
    }

    /**
     * [Layer 2] Simplified Caching (Memory Safe)
     * 使用 WeakMap 简化缓存逻辑，自动清理
     */
    class DomCache {
        #config;
        #store = new WeakMap(); // Key: ParentNode, Value: Map<Selector, Node>
        #timestamps = new WeakMap(); // Key: ParentNode, Value: Map<Selector, timestamp>

        constructor(config) { this.#config = config; }

        get(parent, selector) {
            if (!this.#config.get('cache')) return null;

            const contextMap = this.#store.get(parent);
            const timeMap = this.#timestamps.get(parent);

            if (!contextMap || !timeMap) return null;

            const node = contextMap.get(selector);
            if (!node) return null;

            // TTL Check
            const ts = timeMap.get(selector);
            if (Date.now() - ts > this.#config.get('cacheTTL')) {
                contextMap.delete(selector);
                timeMap.delete(selector);
                return null;
            }

            // Connection Check
            if (!node.isConnected) {
                contextMap.delete(selector);
                timeMap.delete(selector);
                return null;
            }

            return node;
        }

        set(parent, selector, node) {
            if (!this.#config.get('cache') || !node) return;

            let contextMap = this.#store.get(parent);
            let timeMap = this.#timestamps.get(parent);

            if (!contextMap) {
                contextMap = new Map();
                this.#store.set(parent, contextMap);
            }

            if (!timeMap) {
                timeMap = new Map();
                this.#timestamps.set(parent, timeMap);
            }

            contextMap.set(selector, node);
            timeMap.set(selector, Date.now());
        }

        clear() {
            this.#store = new WeakMap();
            this.#timestamps = new WeakMap();
        }
    }

    /**
     * [Layer 3] Engine: Parsing & Traversal
     * 核心逻辑：解析选择器路径，处理 ShadowDOM/Iframe
     */
    class SelectorParser {
        static parse(raw) {
            if (typeof raw !== 'string' || !raw.trim()) throw new QError('Empty selector', 'PARSE');
            // Fast path check
            if (!raw.includes(TOKENS.SEP)) {
                return { isFast: true, path: [{ type: 'QUERY', val: raw.trim() }] };
            }

            const segments = raw.split(TOKENS.SEP).map(s => {
                const t = s.trim();
                if (t === TOKENS.SHADOW) return { type: 'SHADOW' };
                if (t === TOKENS.IFRAME) return { type: 'IFRAME' };
                return { type: 'QUERY', val: t };
            });

            return { isFast: false, path: segments };
        }
    }

    class DomTraverser {
        static async waitForIframeLoad(iframeNode, timeoutMs = 2000) {
            if (Utils.isIframeReady(iframeNode)) return iframeNode.contentDocument;

            return new Promise((resolve) => {
                const cleanup = Utils.createCleanupManager();

                const timer = setTimeout(() => {
                    cleanup.execute();
                    resolve(null);
                }, timeoutMs);

                cleanup.add(() => clearTimeout(timer));

                const handler = () => {
                    if (Utils.isIframeReady(iframeNode)) {
                        cleanup.execute();
                        resolve(iframeNode.contentDocument);
                    }
                };

                cleanup.add(() => iframeNode.removeEventListener('load', handler));
                iframeNode.addEventListener('load', handler);
            });
        }

        static findNextContext(currentCtx, step) {
            if (!currentCtx) return null;

            try {
                switch (step.type) {
                    case 'QUERY':
                        return currentCtx.querySelector ? currentCtx.querySelector(step.val) : null;

                    case 'SHADOW':
                        return currentCtx.shadowRoot || null;

                    case 'IFRAME':
                        if (currentCtx.tagName === 'IFRAME') {
                            const doc = currentCtx.contentDocument;
                            return (doc && doc.readyState === 'complete') ? doc : null;
                        }
                        return null;

                    default:
                        return null;
                }
            } catch (e) {
                // Security errors ignored
                return null;
            }
        }
    }

    /**
     * [Layer 4] Public Facade
     * 对外暴露的 API
     */
    class QuantumCore {
        #config;
        #logger;
        #cache;

        constructor() {
            this.#config = new Config();
            this.#logger = new Logger(this.#config);
            this.#cache = new DomCache(this.#config);
        }

        // --- Configuration ---
        get config() { return this.#config.getAll(); }
        configure(opts) { this.#config.update(opts); }
        clearCache() { this.#cache.clear(); }

        // --- API: Get (Async) ---
        async get(selector, options = {}) {
            if (Array.isArray(selector)) {
                return Promise.all(selector.map(s => this.get(s, options)));
            }

            const { parent = document, timeout = this.#config.get('timeout') } = options;

            // 1. Check Cache
            const cached = this.#cache.get(parent, selector);
            if (cached) return cached;

            // 2. Parse
            const { path } = SelectorParser.parse(selector);

            // 3. Simplified polling approach
            const startTime = Date.now();
            const pollInterval = 50; // 50ms polling

            const checkPath = async () => {
                let ctx = parent;

                for (const step of path) {
                    if (!ctx) break;

                    let next = DomTraverser.findNextContext(ctx, step);

                    // Special Async Handling for Iframe
                    if (!next && step.type === 'IFRAME' && ctx.tagName === 'IFRAME') {
                        next = await DomTraverser.waitForIframeLoad(ctx, 1000);
                    }

                    ctx = next;
                }

                if (ctx) {
                    this.#cache.set(parent, selector, ctx);
                    return ctx;
                }

                return null;
            };

            return new Promise((resolve, reject) => {
                const cleanup = Utils.createCleanupManager();

                const timer = setTimeout(() => {
                    cleanup.execute();
                    if (options.returnNullOnTimeout) {
                        resolve(null);
                    } else {
                        reject(new TimeoutError(`Selector timed out: ${selector}`));
                    }
                }, timeout);

                cleanup.add(() => clearTimeout(timer));

                const poll = async () => {
                    if (Date.now() - startTime >= timeout) return;

                    const result = await checkPath();
                    if (result) {
                        cleanup.execute();
                        resolve(result);
                        return;
                    }

                    // Continue polling
                    const nextTimer = setTimeout(poll, pollInterval);
                    cleanup.add(() => clearTimeout(nextTimer));
                };

                poll();
            });
        }

        // --- API: Each (Observer) ---
        each(selector, callback, options = {}) {
            const { parent = document } = options;
            const { path } = SelectorParser.parse(selector);

            const cleanup = Utils.createCleanupManager();
            let active = true;
            const processed = new WeakSet();
            const logger = this.#logger;

            const processNode = (node, isAsync = false) => {
                if (!active || processed.has(node)) return;
                processed.add(node);
                try {
                    callback(node, isAsync);
                } catch (e) {
                    logger.error('Each callback error:', e);
                }
            };

            const traversePath = (ctx, stepIndex, isAsync) => {
                if (!active || !ctx || stepIndex >= path.length) {
                    if (stepIndex >= path.length) processNode(ctx, isAsync);
                    return;
                }

                const step = path[stepIndex];

                switch (step.type) {
                    case 'QUERY':
                        // Initial scan
                        if (ctx.querySelectorAll) {
                            ctx.querySelectorAll(step.val).forEach(node => {
                                traversePath(node, stepIndex + 1, isAsync);
                            });
                        }

                        // Observe future changes
                        if (Utils.isValidContext(ctx)) {
                            const obs = new MutationObserver(() => {
                                if (active && ctx.querySelectorAll) {
                                    ctx.querySelectorAll(step.val).forEach(node => {
                                        traversePath(node, stepIndex + 1, true);
                                    });
                                }
                            });

                            obs.observe(ctx, { childList: true, subtree: true });
                            cleanup.add(() => obs.disconnect());
                        }
                        break;

                    case 'SHADOW':
                        if (ctx.shadowRoot) {
                            traversePath(ctx.shadowRoot, stepIndex + 1, isAsync);
                        }
                        break;

                    case 'IFRAME':
                        if (ctx.tagName === 'IFRAME') {
                            const handleIframe = () => {
                                try {
                                    if (ctx.contentDocument) {
                                        traversePath(ctx.contentDocument, stepIndex + 1, isAsync);
                                    }
                                } catch (e) {
                                    // Cross-origin blocked
                                }
                            };

                            handleIframe();
                            const reloadHandler = () => {
                                if (active) handleIframe();
                            };
                            ctx.addEventListener('load', reloadHandler);
                            cleanup.add(() => ctx.removeEventListener('load', reloadHandler));
                        }
                        break;
                }
            };

            // Start traversal
            traversePath(parent, 0, false);

            // Return stop function
            return () => {
                active = false;
                cleanup.execute();
            };
        }

        // --- API: On (Delegation) ---
        async on(event, selector, callback, options = {}) {
            const { parent = document, capture = false } = options;
            const { path } = SelectorParser.parse(selector);

            const targetStep = path[path.length - 1];

            // Fast path: simple selector, use native delegation
            if (path.length === 1 && targetStep.type === 'QUERY') {
                const handler = (e) => {
                    const t = e.target.closest(targetStep.val);
                    if (t && parent.contains(t)) callback(e, t);
                };
                parent.addEventListener(event, handler, capture);
                return () => parent.removeEventListener(event, handler, capture);
            }

            // Complex path: find context containers
            const contextPathStr = path.slice(0, -1).map(s => {
                if (s.type === 'SHADOW') return TOKENS.SHADOW;
                if (s.type === 'IFRAME') return TOKENS.IFRAME;
                return s.val;
            }).join(` ${TOKENS.SEP} `);

            const cleanup = Utils.createCleanupManager();

            // Handle target matching（每次事件都可触发，不再对目标元素做一次性去重）
            const handleTarget = (e, ctx) => {
                if (targetStep.type === 'QUERY') {
                    const t = e.target.closest ? e.target.closest(targetStep.val) : null;
                    if (t && ctx.contains(t)) {
                        callback(e, t);
                    }
                }
            };

            // Find all context containers and bind listeners
            const stopEach = this.each(contextPathStr, (ctx) => {
                if (!ctx || !ctx.addEventListener) return;

                const handler = (e) => handleTarget(e, ctx);
                ctx.addEventListener(event, handler, capture);
                cleanup.add(() => ctx.removeEventListener(event, handler, capture));
            }, { parent });

            // Combined cleanup
            return () => {
                stopEach();
                cleanup.execute();
            };
        }

        // --- Utils ---
        create(html, options = {}) {
            const { parent, mapIds } = options;
            const t = document.createElement('template');
            t.innerHTML = html.trim();
            const frag = t.content;

            if (mapIds) {
                const map = { 0: frag.firstElementChild };
                frag.querySelectorAll('[id]').forEach(el => map[el.id] = el);
                if (parent) parent.appendChild(frag);
                return map;
            }

            const node = frag.firstElementChild;
            if (parent && node) parent.appendChild(node);
            return node;
        }

        css(cssText, id, root = document.head) {
            let el = id ? root.querySelector(`#${id}`) : null;
            if (!el) {
                el = document.createElement('style');
                if (id) el.id = id;
                root.appendChild(el);
            }
            if (el.textContent !== cssText) el.textContent = cssText;
            return el;
        }
    }

    // Export
    if (window.QuantumDOM) return;
    const core = new QuantumCore();
    // Expose Classes for Error checking
    core.TimeoutError = TimeoutError;
    core.QuantumError = QError;

    window.QuantumDOM = core;
    console.log('[QuantumDOM] v2.1.1 Loaded (Optimized Core, on() fixed)');
})();