// ==UserScript==
// @name         !.LINUX.DO CF Challenge Jump
// @description  高效检测 Cloudflare 阻断，自动跳转 Challenge 验证，无感静默运行。
// @version      0.0.2
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

  const CHALLENGE_PATH = '/challenge'
  const LOOP_PROTECTION_MS = 3000
  const DEBOUNCE_MS = 200
  const KEY_LAST_JUMP = 'ld_cf_last_jump'

  const ERROR_KEYWORDS = [
    '403 error',
    '该回应是很久以前创建的',
    'reaction was created too long ago',
    '我们无法加载该话题',
    'We cannot load this topic'
  ].map(s => s.toLowerCase())

  const SELECTORS = {
    DIALOG: '.dialog-body',
    CONTENT: '.topic-post, .topic-body, .timeline-container',
    CLOSE_BUTTON: '.dialog-footer button.btn'
  }

  const $ = selector => document.querySelector(selector)
  const lowerText = el => (el?.textContent || '').toLowerCase()

  let memoryLastJump = 0
  let observer = null

  const readLastJump = () => {
    try {
      const n = Number(sessionStorage.getItem(KEY_LAST_JUMP))
      return Number.isFinite(n) ? n : 0
    } catch {
      return memoryLastJump
    }
  }

  const writeLastJump = timestamp => {
    memoryLastJump = timestamp
    try {
      sessionStorage.setItem(KEY_LAST_JUMP, String(timestamp))
    } catch {
      // 部分浏览器隐私模式可能禁用 sessionStorage
    }
  }

  const canJump = () => Date.now() - readLastJump() > LOOP_PROTECTION_MS

  const isChallengePage = () => location.pathname.startsWith(CHALLENGE_PATH)

  const dismissDialog = () => $(SELECTORS.CLOSE_BUTTON)?.click()

  const hasContent = () => $(SELECTORS.CONTENT) !== null

  const shouldJump = () => {
    if (isChallengePage()) return false

    const dialog = $(SELECTORS.DIALOG)
    if (!dialog) return false

    const text = lowerText(dialog)
    if (!ERROR_KEYWORDS.some(k => text.includes(k))) return false

    if (hasContent()) return (dismissDialog(), false)

    return true
  }

  const jump = () => {
    if (!canJump()) return console.warn('[CF Jump] 跳转过于频繁，暂停执行以防止死循环。')

    console.info('[CF Jump] 检测到 Cloudflare 阻断，正在跳转验证...')
    observer?.disconnect()
    writeLastJump(Date.now())
    location.href = `${CHALLENGE_PATH}?redirect=${encodeURIComponent(location.href)}`
  }

  const debounce = (fn, ms) => {
    let timer = null
    return () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fn()
      }, ms)
    }
  }

  const check = () => shouldJump() && jump()
  const scheduleCheck = debounce(check, DEBOUNCE_MS)

  check()
  observer = new MutationObserver(scheduleCheck)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  })

})()
