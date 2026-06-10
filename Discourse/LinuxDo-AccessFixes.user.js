// ==UserScript==
// @name         !.Linux.do Access Fixes
// @description  自动跳转与话题中键打开补 track-view 计数。
// @version      0.1.0
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0
// @match        https://linux.do/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linux.do
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Discourse/LinuxDo-AccessFixes.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/Tampermonkey/main/Discourse/LinuxDo-AccessFixes.user.js
// ==/UserScript==

;(function () {
  'use strict'

  const GLOBAL_KEY = '__linuxDoAccessFixes__'
  const globalState = (window[GLOBAL_KEY] ||= {
    challengeStarted: false,
    topicTrackViewStarted: false
  })

  const CONFIG = {
    challengePath: '/challenge',
    challengeDebounceMs: 200,
    jumpCooldownMs: 3000,
    lastJumpKey: 'ld_cf_last_jump',
    legacyTopicTrackedKeyPrefix: 'mfix_topic_',
    topicTrackedKeyPrefix: 'ld_topic_tracked_',
    trackViewCarrierPath: '/session/current.json',
    trackViewReadyPollMs: 200,
    trackViewReadyTimeoutMs: 6000
  }

  const ERROR_KEYWORDS = [
    '403 error',
    '该回应是很久以前创建的',
    'reaction was created too long ago',
    '我们无法加载该话题',
    'we cannot load this topic'
  ].map(text => text.toLowerCase())

  const SELECTORS = {
    dialog: '.dialog-body',
    content: '.topic-post, .topic-body, .timeline-container',
    closeButton: '.dialog-footer button.btn'
  }

  const query = selector => document.querySelector(selector)
  const meta = name => document.querySelector(`meta[name="${name}"]`)?.content || ''
  const lowerText = el => (el?.textContent || '').toLowerCase()

  const createLogger = prefix => ({
    info: (...args) => console.info(`[${prefix}]`, ...args),
    warn: (...args) => console.warn(`[${prefix}]`, ...args)
  })

  const cfLog = createLogger('CF Jump')
  const trackLog = createLogger('MiddleclickFix')

  const storageGet = key => {
    try {
      return sessionStorage.getItem(key)
    } catch {
      return null
    }
  }

  const storageGetNumber = (key, fallback = 0) => {
    const value = Number(storageGet(key))
    return Number.isFinite(value) ? value : fallback
  }

  const storageSet = (key, value) => {
    try {
      sessionStorage.setItem(key, String(value))
      return true
    } catch {
      return false
    }
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

  function startChallengeJump() {
    let memoryLastJump = 0
    let observer = null

    const isChallengePage = () => location.pathname.startsWith(CONFIG.challengePath)
    const hasContent = () => query(SELECTORS.content) !== null
    const dismissDialog = () => query(SELECTORS.closeButton)?.click()

    const shouldJump = () => {
      if (isChallengePage()) return false

      const dialog = query(SELECTORS.dialog)
      if (!dialog) return false

      const text = lowerText(dialog)
      if (!ERROR_KEYWORDS.some(keyword => text.includes(keyword))) return false

      if (hasContent()) {
        dismissDialog()
        return false
      }

      return true
    }

    const readLastJump = () => {
      const stored = storageGetNumber(CONFIG.lastJumpKey, NaN)
      return Number.isFinite(stored) ? stored : memoryLastJump
    }

    const writeLastJump = timestamp => {
      memoryLastJump = timestamp
      storageSet(CONFIG.lastJumpKey, timestamp)
    }

    const jump = () => {
      if (Date.now() - readLastJump() <= CONFIG.jumpCooldownMs) {
        cfLog.warn('跳转过于频繁，暂停执行以防止死循环。')
        return
      }

      cfLog.info('检测到 Cloudflare 阻断，正在跳转验证...')
      observer?.disconnect()
      writeLastJump(Date.now())
      location.href = `${CONFIG.challengePath}?redirect=${encodeURIComponent(location.href)}`
    }

    const check = () => shouldJump() && jump()

    check()
    if (!document.body) return

    observer = new MutationObserver(debounce(check, CONFIG.challengeDebounceMs))
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    })

    window.addEventListener('pagehide', () => observer?.disconnect(), { once: true })
  }

  function startTopicTrackViewFix() {
    const topicId = location.pathname.match(/^\/t\/[^/]+\/(\d+)(?:\/|$)/)?.[1]
    if (!topicId) return

    const flagKeys = [
      `${CONFIG.legacyTopicTrackedKeyPrefix}${topicId}`,
      `${CONFIG.topicTrackedKeyPrefix}${topicId}`
    ]
    const isTracked = () => flagKeys.some(key => storageGet(key))
    const markTracked = () => flagKeys.forEach(key => storageSet(key, '1'))
    if (isTracked()) return

    const sendTrackView = () => {
      if (!meta('csrf-token')) return

      const headers = {
        'X-Requested-With': 'XMLHttpRequest',
        'Discourse-Track-View': 'true',
        'Discourse-Track-View-Topic-Id': topicId,
        'Discourse-Track-View-Url': location.href,
        'Discourse-Track-View-Referrer': document.referrer || '',
        'Discourse-Present': 'true'
      }

      const sessionId = meta('discourse-track-view-session-id')
      if (sessionId) headers['Discourse-Track-View-Session-Id'] = sessionId

      fetch(CONFIG.trackViewCarrierPath, {
        method: 'GET',
        credentials: 'include',
        headers
      })
        .then(response => {
          if (!response.ok) {
            trackLog.warn(`请求失败 status=${response.status}`)
            return
          }

          markTracked()
          trackLog.info(`✓ 已为话题 ${topicId} 补 track-view`)
        })
        .catch(error => trackLog.warn('网络错误:', error))
    }

    const isReady = () => Boolean(meta('discourse-track-view-session-id'))
    if (isReady()) {
      sendTrackView()
      return
    }

    let tries = 0
    const maxTries = Math.ceil(CONFIG.trackViewReadyTimeoutMs / CONFIG.trackViewReadyPollMs)
    const timer = setInterval(() => {
      tries += 1
      if (isReady() || tries > maxTries) {
        clearInterval(timer)
        sendTrackView()
      }
    }, CONFIG.trackViewReadyPollMs)

    window.addEventListener('pagehide', () => clearInterval(timer), { once: true })
  }

  if (!globalState.challengeStarted) {
    globalState.challengeStarted = true
    startChallengeJump()
  }

  if (!globalState.topicTrackViewStarted) {
    globalState.topicTrackViewStarted = true
    startTopicTrackViewFix()
  }
})()
