// ==UserScript==
// @name         !.LINUX.DO CF Challenge Jump
// @description  高效检测 Cloudflare 阻断，自动跳转 Challenge 验证，无感静默运行。
// @version      0.0.1
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0
// @match        https://linux.do/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linux.do
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/LINUX.DOCFChallengeJump.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/LINUX.DOCFChallengeJump.js
// ==/UserScript==

;(function () {
  'use strict'

  class Config {
    static CHALLENGE_PATH = '/challenge'
    static ERROR_KEYWORDS = [
      '403 error',
      '该回应是很久以前创建的',
      'reaction was created too long ago',
      '我们无法加载该话题',
      'We cannot load this topic'
    ]

    static SELECTORS = {
      DIALOG: '.dialog-body',
      CONTENT: '.topic-post, .topic-body, .timeline-container',
    }

    static LOOP_PROTECTION_MS = 3000 
  }

  class SessionStore {
    static #KEY_LAST_JUMP = 'ld_cf_last_jump'

    static canJump() {
      const last = parseInt(sessionStorage.getItem(this.#KEY_LAST_JUMP) || '0', 10)
      return Date.now() - last > Config.LOOP_PROTECTION_MS
    }

    static recordJump() {
      sessionStorage.setItem(this.#KEY_LAST_JUMP, Date.now().toString())
    }
  }

  class Core {
    #observer = null
    #timer = null

    constructor() {
      this.init()
    }

    get #isChallengePage() {
      return location.pathname.startsWith(Config.CHALLENGE_PATH)
    }

    #shouldJump() {
      if (this.#isChallengePage) return false

      const dialog = document.querySelector(Config.SELECTORS.DIALOG)
      if (!dialog) return false

      const dialogText = dialog.innerText || ''
      const hasErrorText = Config.ERROR_KEYWORDS.some(key => dialogText.includes(key))

      if (!hasErrorText) return false

      // 防止误判：必须确认正文确实缺失
      const hasContent = document.querySelector(Config.SELECTORS.CONTENT) !== null
      
      return !hasContent
    }

    #performJump() {
      if (!SessionStore.canJump()) {
        console.warn('[CF Jump] 跳转过于频繁，暂停执行以防止死循环。')
        return
      }

      console.info('[CF Jump] 检测到 Cloudflare 阻断，正在跳转验证...')
      this.#disconnect()
      SessionStore.recordJump()
      
      const targetUrl = `${Config.CHALLENGE_PATH}?redirect=${encodeURIComponent(location.href)}`
      location.href = targetUrl
    }

    #debouncedCheck() {
      if (this.#timer) clearTimeout(this.#timer)
      this.#timer = setTimeout(() => {
        if (this.#shouldJump()) {
          this.#performJump()
        }
      }, 200)
    }

    #disconnect() {
      if (this.#observer) {
        this.#observer.disconnect()
        this.#observer = null
      }
    }

    init() {
      if (this.#shouldJump()) {
        this.#performJump()
        return
      }

      this.#observer = new MutationObserver(() => this.#debouncedCheck())
      
      this.#observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }
  }

  new Core()

})()
