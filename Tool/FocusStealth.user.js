// ==UserScript==
// @name         !.FocusStealth
// @description  全局拦截 visibilitychange / blur / focusout / pagehide / mouseleave 等事件，并伪装 document.visibilityState/hidden。
// @version      0.0.3
// @author       ank
// @namespace    http://010314.xyz/
// @license      AGPL-3.0
// @match        *://*/*
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Tool/FocusStealth.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Tool/FocusStealth.user.js
// ==/UserScript==

(function () {
  'use strict';

  /**
   * ================================
   * Layer 1: Configuration & Constants
   * ================================
   */
  const CONSTANTS = {
    LOG_PREFIX: '[🛡️ Stealth]',
    EVENT_GROUPS: {
      VISIBILITY: {
        name: '拦截可见性检测',
        events: [
          'visibilitychange',
          'webkitvisibilitychange',
          'mozvisibilitychange',
          'msvisibilitychange'
        ]
      },
      FOCUS: {
        name: '拦截失焦/模糊',
        events: ['blur', 'focusout']
      },
      PAGE: {
        name: '拦截页面离开',
        events: ['pagehide', 'freeze', 'mouseleave', 'mouseout']
      }
    },
    PROPS_TO_SPOOF: {
      hidden: false,
      mozHidden: false,
      webkitHidden: false,
      msHidden: false,
      visibilityState: 'visible',
      webkitVisibilityState: 'visible'
    }
  };

  // 极简配置：直接全打开
  const CONFIG = Object.freeze({
    ENABLE_ALL: true,   // 若以后你想临时关掉，可以改成 false 再保存脚本
    DEBUG: false        // 改成 true 可看调试日志
  });

  /**
   * ================================
   * Layer 2: Core Business Logic (Domain)
   * ================================
   */
  class StealthEngine {
    #context;
    #isInitialized = false;
    #targetedEvents;

    constructor() {
      this.#context = unsafeWindow || window;

      // Pre-compute event lookup Set for O(1) performance
      this.#targetedEvents = new Set([
        ...CONSTANTS.EVENT_GROUPS.VISIBILITY.events,
        ...CONSTANTS.EVENT_GROUPS.FOCUS.events,
        ...CONSTANTS.EVENT_GROUPS.PAGE.events
      ]);
    }

    run() {
      if (this.#isInitialized) return;
      this.#isInitialized = true;

      this.#log('Engine starting (full-block, no-menu mode)...');

      // Use helper method to eliminate repetitive error handling
      this.#safeExecute('spoofProperties', () => this.#spoofProperties());
      this.#safeExecute('trapEvents', () => this.#trapEvents());
      this.#safeExecute('hookAddEventListener', () => this.#hookAddEventListener());
      this.#safeExecute('patchToStringUtils', () => this.#patchToStringUtils());
    }

    #log(...args) {
      if (!CONFIG.DEBUG) return;
      console.log(
        `%c${CONSTANTS.LOG_PREFIX}`,
        'color: #00ff9d; background: #333; border-radius: 3px; padding: 2px;',
        ...args
      );
    }

    /**
     * Helper method to eliminate repetitive try-catch blocks (DRY principle)
     */
    #safeExecute(operationName, operationFn) {
      try {
        operationFn();
      } catch (e) {
        this.#log(`${operationName} error`, e);
      }
    }

    /**
     * Unified event checking utility (DRY principle)
     */
    #isTargetedEvent(eventType) {
      return eventType && this.#targetedEvents.has(eventType.toLowerCase());
    }

    /**
     * Descriptor factory methods (DRY principle)
     */
    #createGetterDescriptor(value) {
      return {
        get: () => value,
        configurable: true,
        enumerable: true
      };
    }

    #createMethodDescriptor(fn) {
      return {
        value: fn,
        configurable: true,
        writable: true
      };
    }

    /**
     * 伪装 Document 相关可见性属性 & hasFocus
     */
    #spoofProperties() {
      const doc = this.#context.document;
      const docProto = this.#context.Document?.prototype;

      // Simplified target gathering (KISS principle)
      const targets = docProto ? [docProto, doc].filter(Boolean) : [doc].filter(Boolean);

      for (const target of targets) {
        // Use descriptor factory methods
        for (const [prop, value] of Object.entries(CONSTANTS.PROPS_TO_SPOOF)) {
          this.#safeDefineProperty(target, prop, this.#createGetterDescriptor(value));
        }

        // hasFocus() 永远返回 true
        this.#safeDefineProperty(target, 'hasFocus', this.#createMethodDescriptor(() => true));
      }
    }

    /**
     * 在捕获阶段全局拦截 visibility / blur / pagehide / mouseleave 等事件
     */
    #trapEvents() {
      if (!this.#context?.addEventListener) return;

      const handler = (e) => {
        if (!CONFIG.ENABLE_ALL) return;

        // Use unified event checking with pre-computed Set
        if (!this.#isTargetedEvent(e.type)) return;

        try {
          e.stopImmediatePropagation();
          e.stopPropagation();
        } catch (err) {
          // 某些自定义事件可能不完全兼容
        }

        this.#log(`Blocked event: ${e.type}`, e.target);
      };

      // Simplified event aggregation (KISS principle)
      const allEvents = [
        ...CONSTANTS.EVENT_GROUPS.VISIBILITY.events,
        ...CONSTANTS.EVENT_GROUPS.FOCUS.events,
        ...CONSTANTS.EVENT_GROUPS.PAGE.events
      ];

      allEvents.forEach((evt) => {
        this.#safeExecute(`addEventListener for ${evt}`, () => {
          this.#context.addEventListener(evt, handler, true); // 捕获阶段
        });
      });
    }

    /**
     * 劫持 EventTarget.prototype.addEventListener
     */
    #hookAddEventListener() {
      const proto = this.#context.EventTarget?.prototype;
      const originalAdd = proto?.addEventListener;

      if (typeof originalAdd !== 'function') return;

      // Standardized variable naming (KISS principle)
      const patched = (type, listener, options) => {
        const result = originalAdd.call(this, type, listener, options);

        // Use unified event checking
        if (CONFIG.DEBUG && this.#isTargetedEvent(type)) {
          this.#log('Site registered suspect listener:', type, listener);
        }

        return result;
      };

      this.#safeExecute('patch addEventListener', () => {
        proto.addEventListener = patched;
        this.#patchToString(proto.addEventListener, originalAdd);
      });
    }

    #safeDefineProperty(obj, prop, descriptor) {
      if (!obj) return;
      try {
        Object.defineProperty(obj, prop, descriptor);
      } catch (e) {
        // 某些环境原型不可写，静默降级
      }
    }

    #patchToString(proxy, original) {
      try {
        const str = original.toString();
        Object.defineProperty(proxy, 'toString', {
          value: () => str,
          configurable: true,
          writable: true
        });
      } catch (e) {
        // 忽略 toString 伪装失败
      }
    }

    #patchToStringUtils() {
      // Empty method - kept for consistency but marked for future implementation
      // Could be removed or implemented based on future requirements
    }
  }

  /**
   * ================================
   * Main Entry
   * ================================
   */
  function main() {
    try {
      const core = new StealthEngine();
      core.run();
    } catch (e) {
      console.error(`${CONSTANTS.LOG_PREFIX} Fatal init error`, e);
    }
  }

  main();
})();