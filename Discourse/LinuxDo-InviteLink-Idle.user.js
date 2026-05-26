// ==UserScript==
// @name         !.Linux.do 邀请码（稳定挂机版）
// @description  自动生成 Linux.do Discourse 邀请链接：24h 仅生成一次，限流/异常自动冷却，成功后复制到剪贴板并长期挂机。
// @version      0.0.2
// @author       ank
// @match        https://linux.do/u/*/invited*
// @license      AGPL-3.0
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/LinuxDo-InviteLink-Idle.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Discourse/LinuxDo-InviteLink-Idle.user.js
// ==/UserScript==

(async function () {
    'use strict';

    const CONFIG = {
        DAILY_MS: 24 * 60 * 60 * 1000,
        EXPIRES_MS: 24 * 60 * 60 * 1000,
        COOLDOWN_CHUNK_MS: 60 * 60 * 1000,        // 长冷却时每小时醒一次，防止超长挂机掉链
        JITTER_MS: 15 * 1000,                     // 避免边界太准导致提前/并发
        LOCK_TTL_MS: 2 * 60 * 1000,               // 多标签页/多窗口的软锁
        BACKOFF_BASE_MS: 30 * 1000,               // 通用错误退避
        BACKOFF_MAX_MS: 6 * 60 * 60 * 1000,       // 最多 6h 重试一次，避免刷屏/刷接口
        LOGIN_BASE_MS: 2 * 60 * 1000,             // 未登录/CSRF 缺失退避
        LOGIN_MAX_MS: 60 * 60 * 1000              // 最多 1h 提醒一次即可
    };

    const KEYS = {
        NEXT_ALLOWED: "INVITE_NEXT_ALLOWED",
        LAST_SUCCESS: "INVITE_LAST_SUCCESS_AT",
        LAST_LINK: "INVITE_LAST_LINK",
        ERROR_COUNT: "INVITE_ERROR_COUNT",
        LOCK_UNTIL: "INVITE_LOCK_UNTIL"
    };

    const now = Date.now();
    const jitter = (maxMs) => Math.floor(Math.random() * Math.max(0, maxMs));
    const fmt = (ms) => new Date(ms).toLocaleString();

    const calcBackoff = (count, baseMs, maxMs) => {
        const exp = Math.min(Math.max(0, count), 16);
        const raw = baseMs * Math.pow(2, exp);
        return Math.min(maxMs, Math.max(baseMs, raw)) + jitter(1000);
    };

    const scheduleReload = (delayMs, reason) => {
        const ms = Math.max(1000, Math.floor(delayMs));
        console.log(`[invite-idle] ${reason}，${Math.round(ms / 1000)}s 后刷新`);
        setTimeout(() => location.reload(), ms);
    };

    const scheduleCooldown = (nextAllowedMs, reason) => {
        const now2 = Date.now();
        const wait = Math.max(0, nextAllowedMs - now2);
        const chunk = wait > CONFIG.COOLDOWN_CHUNK_MS ? CONFIG.COOLDOWN_CHUNK_MS : wait;
        console.log(`[invite-idle] ${reason}，下次允许: ${fmt(nextAllowedMs)}，剩余: ${Math.round(wait / 1000)}s`);
        scheduleReload(chunk + jitter(1000), reason);
    };

    // 兜底：如果没有 nextAllowed 但有 lastSuccess，则按 24h 算一次，避免重启/崩溃后立刻连打接口。
    const storedNextAllowed = GM_getValue(KEYS.NEXT_ALLOWED, 0);
    const storedLastSuccess = GM_getValue(KEYS.LAST_SUCCESS, 0);
    let nextAllowed = storedNextAllowed;
    if (!nextAllowed && storedLastSuccess) nextAllowed = storedLastSuccess + CONFIG.DAILY_MS;
    if (nextAllowed && now < nextAllowed) {
        scheduleCooldown(nextAllowed, "冷却中");
        return;
    }

    // 软锁：避免多个标签页同时跑
    const lockUntil = GM_getValue(KEYS.LOCK_UNTIL, 0);
    if (now < lockUntil) {
        scheduleReload(lockUntil - now + jitter(1000), "已有实例在跑");
        return;
    }
    GM_setValue(KEYS.LOCK_UNTIL, now + CONFIG.LOCK_TTL_MS);

    const csrf = document.querySelector('meta[name="csrf-token"]')?.content;

    if (!csrf) {
        const count = (GM_getValue(KEYS.ERROR_COUNT, 0) || 0) + 1;
        GM_setValue(KEYS.ERROR_COUNT, count);
        const delay = calcBackoff(count, CONFIG.LOGIN_BASE_MS, CONFIG.LOGIN_MAX_MS);
        console.log("[invite-idle] 未登录或CSRF失效:", "count=", count);
        scheduleReload(delay, "等待登录");
        return;
    }

    console.log("[invite-idle] 尝试生成邀请码...");

    const formData = new URLSearchParams();
    formData.append('max_redemptions_allowed', '1');
    formData.append(
        'expires_at',
        new Date(now + CONFIG.EXPIRES_MS)
            .toISOString()
            .replace('T', ' ')
            .substring(0, 19)
    );

    try {
        const res = await fetch('/invites', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': csrf,
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: formData,
            credentials: 'include'
        });

        let json;
        try {
            json = await res.json();
        } catch (e) {
            const text = await res.text().catch(() => '');
            console.log("返回非JSON:", res.status, text || e);
            const count = (GM_getValue(KEYS.ERROR_COUNT, 0) || 0) + 1;
            GM_setValue(KEYS.ERROR_COUNT, count);
            const delay = calcBackoff(count, CONFIG.BACKOFF_BASE_MS, CONFIG.BACKOFF_MAX_MS);
            scheduleReload(delay, "返回非JSON");
            return;
        }

        // 限流：可能是 429 / 4xx，但仍会带 wait_seconds
        if (json?.extras?.wait_seconds) {
            const waitSeconds = Number(json.extras.wait_seconds) || 0;
            const nextTime = Date.now() + waitSeconds * 1000 + jitter(CONFIG.JITTER_MS);
            GM_setValue(KEYS.NEXT_ALLOWED, nextTime);
            GM_setValue(KEYS.ERROR_COUNT, 0);
            console.log("[invite-idle] 触发限流，等待:", waitSeconds, "HTTP:", res.status);
            scheduleCooldown(nextTime, "限流冷却");
            return;
        }

        if (json?.link) {
            try {
                GM_setClipboard(json.link);
            } catch (e) {
                console.log("[invite-idle] 复制剪贴板失败:", e);
            }

            const okAt = Date.now();
            const nextTime = okAt + CONFIG.DAILY_MS + jitter(CONFIG.JITTER_MS);
            GM_setValue(KEYS.LAST_SUCCESS, okAt);
            GM_setValue(KEYS.LAST_LINK, json.link);
            GM_setValue(KEYS.NEXT_ALLOWED, nextTime);
            GM_setValue(KEYS.ERROR_COUNT, 0);
            console.log("[invite-idle] 生成成功:", json.link);
            scheduleCooldown(nextTime, "每日冷却");
            return;
        }

        if (!res.ok) {
            const count = (GM_getValue(KEYS.ERROR_COUNT, 0) || 0) + 1;
            GM_setValue(KEYS.ERROR_COUNT, count);
            const delay = calcBackoff(count, CONFIG.BACKOFF_BASE_MS, CONFIG.BACKOFF_MAX_MS);
            console.log("[invite-idle] HTTP错误:", res.status, json);
            scheduleReload(delay, `HTTP ${res.status}`);
            return;
        }

        console.log("[invite-idle] 未识别返回:", json);

        scheduleReload(5 * 60 * 1000 + jitter(10 * 1000), "未识别返回");
    } catch (e) {
        const count = (GM_getValue(KEYS.ERROR_COUNT, 0) || 0) + 1;
        GM_setValue(KEYS.ERROR_COUNT, count);
        const delay = calcBackoff(count, CONFIG.BACKOFF_BASE_MS, CONFIG.BACKOFF_MAX_MS);
        console.log("[invite-idle] 请求失败:", e);
        scheduleReload(delay, "请求失败");
    }

})();
