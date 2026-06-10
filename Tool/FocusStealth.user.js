// ==UserScript==
// @name         !.FocusStealth
// @description  伪装页面始终可见/聚焦，并精准拦截 visibilitychange / blur / focusout / pagehide / mouseleave / mouseout 等前台检测事件。
// @version      0.0.4
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

  const CONFIG = Object.freeze({
    ENABLE_ALL: true,
    DEBUG: false
  });

  class StealthEngine {
    #context;
    #isInitialized = false;
    #targetedEvents;

    constructor() {
      this.#context = unsafeWindow || window;
      this.#targetedEvents = new Set([
        ...CONSTANTS.EVENT_GROUPS.VISIBILITY.events,
        ...CONSTANTS.EVENT_GROUPS.FOCUS.events,
        ...CONSTANTS.EVENT_GROUPS.PAGE.events
      ]);
    }

    run() {
      if (this.#isInitialized || !CONFIG.ENABLE_ALL) return;
      this.#isInitialized = true;
      this.#log('Engine starting (precise-block mode)...');
      this.#safeExecute('spoofProperties', () => this.#spoofProperties());
      this.#safeExecute('trapEvents', () => this.#trapEvents());
      this.#safeExecute('hookAddEventListener', () => this.#hookAddEventListener());
    }

    #log(...args) {
      if (!CONFIG.DEBUG) return;
      console.log(
        `%c${CONSTANTS.LOG_PREFIX}`,
        'color: #00ff9d; background: #333; border-radius: 3px; padding: 2px;',
        ...args
      );
    }

    #safeExecute(operationName, operationFn) {
      try {
        operationFn();
      } catch (e) {
        this.#log(`${operationName} error`, e);
      }
    }

    #isTargetedEvent(eventType) {
      return eventType && this.#targetedEvents.has(eventType.toLowerCase());
    }

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

    #spoofProperties() {
      const doc = this.#context.document;
      const docProto = this.#context.Document?.prototype;
      const primaryTarget = docProto || doc;

      if (!primaryTarget) return;

      for (const [prop, value] of Object.entries(CONSTANTS.PROPS_TO_SPOOF)) {
        const definedOnPrimary = this.#safeDefineProperty(
          primaryTarget,
          prop,
          this.#createGetterDescriptor(value)
        );

        if (!definedOnPrimary && doc && doc !== primaryTarget) {
          this.#safeDefineProperty(doc, prop, this.#createGetterDescriptor(value));
        }
      }

      const hasFocusDefinedOnPrimary = this.#safeDefineProperty(
        primaryTarget,
        'hasFocus',
        this.#createMethodDescriptor(() => true)
      );

      if (!hasFocusDefinedOnPrimary && doc && doc !== primaryTarget) {
        this.#safeDefineProperty(doc, 'hasFocus', this.#createMethodDescriptor(() => true));
      }
    }

    #trapEvents() {
      if (!this.#context?.addEventListener) return;

      const visibilityEvents = new Set(CONSTANTS.EVENT_GROUPS.VISIBILITY.events);
      const pageLifecycleEvents = new Set(['pagehide', 'freeze']);

      const handler = (e) => {
        if (!this.#isTargetedEvent(e.type)) return;

        const doc = this.#context.document;
        const target = e.target;
        const type = e.type.toLowerCase();

        if (visibilityEvents.has(type) && target !== doc) {
          return;
        }

        if (type === 'blur' && target !== this.#context && target !== doc) {
          return;
        }

        if (
          type === 'focusout' &&
          target !== doc &&
          target !== doc?.documentElement &&
          target !== doc?.body
        ) {
          return;
        }

        if (pageLifecycleEvents.has(type) && target !== this.#context && target !== doc) {
          return;
        }

        if (
          type === 'mouseleave' &&
          target !== doc &&
          target !== doc?.documentElement &&
          target !== doc?.body
        ) {
          return;
        }

        if (
          type === 'mouseout' &&
          (
            (target !== doc && target !== doc?.documentElement && target !== doc?.body) ||
            e.relatedTarget
          )
        ) {
          return;
        }

        try {
          e.stopImmediatePropagation();
          e.stopPropagation();
        } catch (err) {}

        this.#log(`Blocked event: ${e.type}`, target);
      };

      const allEvents = [
        ...CONSTANTS.EVENT_GROUPS.VISIBILITY.events,
        ...CONSTANTS.EVENT_GROUPS.FOCUS.events,
        ...CONSTANTS.EVENT_GROUPS.PAGE.events
      ];

      allEvents.forEach((evt) => {
        this.#safeExecute(`addEventListener for ${evt}`, () => {
          this.#context.addEventListener(evt, handler, true);
        });
      });
    }

    #hookAddEventListener() {
      const proto = this.#context.EventTarget?.prototype;
      const originalAdd = proto?.addEventListener;

      if (typeof originalAdd !== 'function') return;

      const engine = this;

      const patched = function (type, listener, options) {
        const result = originalAdd.call(this, type, listener, options);

        if (CONFIG.DEBUG && engine.#isTargetedEvent(type)) {
          engine.#log('Site registered suspect listener:', type, listener);
        }

        return result;
      };

      this.#safeExecute('patch addEventListener', () => {
        proto.addEventListener = patched;
        this.#patchToString(proto.addEventListener, originalAdd);
      });
    }

    #safeDefineProperty(obj, prop, descriptor) {
      if (!obj) return false;
      try {
        Object.defineProperty(obj, prop, descriptor);
        return true;
      } catch (e) {
        return false;
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
      } catch (e) {}
    }
  }

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
