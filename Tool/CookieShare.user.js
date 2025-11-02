// ==UserScript==
// @name         !.Cookie Share (WebDAV Sync)
// @description  具有WebDAV同步的本地cookie管理脚本
// @version      3.6.0
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0-or-later
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @connect      *
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/CookieShare.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/CookieShare.user.js
// ==/UserScript==

(function () {
    "use strict";
    if (window.self !== window.top) return;

    function sanitizeForFilename(name) {
        if (!name || typeof name !== 'string') return '';
        return name.trim().replace(/[\s\\/:"*?<>|]+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '');
    }

    class Config {
        constructor() {
            this.STORAGE_KEYS = {
                WEBDAV_URL: "cookie_share_webdav_url",
                WEBDAV_USER: "cookie_share_webdav_user",
                WEBDAV_PASS: "cookie_share_webdav_pass",
            };
            this.WEBDAV_BASE_PATH = "/CookieShare/";
            this.LOCAL_STORAGE_PREFIX = "cookie_share_local_";
        }
    }

    class Storage {
        async get(key, defaultValue = null) { return await GM_getValue(key, defaultValue); }
        async set(key, value) { return await GM_setValue(key, value); }
        async delete(key) { return await GM_deleteValue(key); }
        async list() { return await GM_listValues(); }
    }

    class CookieManager {
        static async getAll() {
            const globalPromise = new Promise(resolve => GM_cookie.list({}, resolve));
            const domains = this.getDomainHierarchy(window.location.hostname);
            const domainPromises = domains.map(domain =>
                new Promise(resolve => GM_cookie.list({ domain }, resolve))
            );
            const [globalCookies, ...domainCookieArrays] = await Promise.all([globalPromise, ...domainPromises]);
            const uniqueCookies = new Map();
            const addCookiesToMap = (cookies) => {
                if (!cookies) return;
                for (const cookie of cookies) {
                    const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
                    if (!uniqueCookies.has(key)) {
                        uniqueCookies.set(key, { ...cookie, path: cookie.path || "/" });
                    }
                }
            };
            addCookiesToMap(globalCookies);
            for (const cookies of domainCookieArrays) {
                addCookiesToMap(cookies);
            }
            return Array.from(uniqueCookies.values());
        }

        static getDomainHierarchy(hostname) {
            const domains = new Set([hostname]);
            const parts = hostname.split('.');
            if (parts.length > 1) {
                for (let i = 0; i < parts.length - 1; i++) {
                    const subdomain = parts.slice(i).join('.');
                    domains.add(subdomain);
                    domains.add(`.${subdomain}`);
                }
            }
            return Array.from(domains);
        }

        static set(cookie) {
            return new Promise((resolve, reject) => {
                if (!cookie.name || typeof cookie.value === 'undefined') {
                    console.warn("CookieShare: Skipping invalid cookie object", cookie);
                    return resolve();
                }
                const cookieToSet = {
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain,
                    path: cookie.path || "/",
                    secure: cookie.secure || false,
                    httpOnly: cookie.httpOnly || false,
                };
                if (cookie.expirationDate && typeof cookie.expirationDate === 'number') {
                    cookieToSet.expirationDate = cookie.expirationDate;
                }
                GM_cookie.set(cookieToSet, (error) => {
                    if (error) reject(new Error(error));
                    else resolve();
                });
            });
        }

        static delete(cookie) {
            return new Promise((resolve) => {
                GM_cookie.delete({ name: cookie.name, domain: cookie.domain, path: cookie.path }, () => resolve());
            });
        }
    }

    class WebDAVClient {
        #storage;
        #config;

        constructor(storage, config) {
            this.#storage = storage;
            this.#config = config;
        }

        #getAuthHeader(user, pass) {
            return user && pass ? "Basic " + btoa(user + ":" + pass) : null;
        }

        #translateError(err) {
            if (err.status === 401) return "认证失败，请检查用户名和密码。";
            if (err.status === 403) return "权限被拒绝。";
            if (err.status === 404) return "路径未找到。";
            if (err.status >= 500) return `服务器错误 (${err.status})。`;
            return err.responseText || err.message || "未知错误发生。";
        }

        #request(options) {
            return new Promise(async (resolve, reject) => {
                const url = await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_URL);
                if (!url) {
                    return reject({ status: -1, message: "请先配置并测试 WebDAV" });
                }
                const user = await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_USER, "");
                const pass = await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_PASS, "");
                const authHeader = this.#getAuthHeader(user, pass);
                const headers = { ...options.headers };
                if (authHeader) headers["Authorization"] = authHeader;
                GM_xmlhttpRequest({
                    ...options, headers, timeout: 15000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) resolve(res);
                        else reject({ status: res.status, responseText: res.responseText, message: `HTTP Error ${res.status}` });
                    },
                    onerror: () => reject({ status: 0, message: "网络请求失败" }),
                    ontimeout: () => reject({ status: 0, message: "请求超时" }),
                });
            });
        }

        async #getBaseUrl() {
            const url = await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_URL);
            return url ? url.replace(/\/+$/, "") : null;
        }

        async testConnection() {
            try {
                const baseUrl = await this.#getBaseUrl();
                if (!baseUrl) throw new Error("请先配置并测试 WebDAV");
                await this.#request({ method: 'PROPFIND', url: `${baseUrl}${this.#config.WEBDAV_BASE_PATH}`, headers: { 'Depth': '0' } });
            } catch (err) {
                throw new Error(this.#translateError(err));
            }
        }

        async put(filePath, data) {
            try {
                const baseUrl = await this.#getBaseUrl();
                if (!baseUrl) throw new Error("请先配置并测试 WebDAV");
                await this.#request({ method: 'PUT', url: `${baseUrl}${filePath}`, data: JSON.stringify(data, null, 2), headers: { 'Content-Type': 'application/json' } });
            } catch (err) {
                throw new Error(this.#translateError(err));
            }
        }

        async get(filePath) {
            try {
                const baseUrl = await this.#getBaseUrl();
                if (!baseUrl) throw new Error("请先配置并测试 WebDAV");
                const response = await this.#request({ method: 'GET', url: `${baseUrl}${filePath}` });
                return JSON.parse(response.responseText);
            } catch (err) {
                if (err instanceof SyntaxError) {
                    throw new Error("从云端获取的配置文件格式无效。");
                }
                throw new Error(this.#translateError(err));
            }
        }

        async delete(filePath) {
            try {
                const baseUrl = await this.#getBaseUrl();
                if (!baseUrl) throw new Error("请先配置并测试 WebDAV");
                await this.#request({ method: 'DELETE', url: `${baseUrl}${filePath}` });
            } catch (err) {
                throw new Error(this.#translateError(err));
            }
        }

        async list(dirPath) {
            try {
                const baseUrl = await this.#getBaseUrl();
                if (!baseUrl) throw new Error("请先配置并测试 WebDAV");
                const response = await this.#request({ method: 'PROPFIND', url: `${baseUrl}${dirPath}`, headers: { 'Depth': '1' } });
                const hrefs = response.responseText.match(/<d:href>(.*?)<\/d:href>/g) || [];
                return hrefs.map(href => href.replace(/<\/?d:href>/g, '')).filter(href => href.endsWith('.json')).map(fullPath => fullPath.split('/').pop());
            } catch (error) {
                if (error.status === 404) {
                    try {
                        const baseUrl = await this.#getBaseUrl();
                        await this.#request({ method: 'MKCOL', url: `${baseUrl}${dirPath}` });
                    } catch (mkcolError) {
                        console.error("CookieShare: Failed to create WebDAV directory.", mkcolError);
                    }
                    return [];
                }
                throw new Error(this.#translateError(error));
            }
        }
    }

    class UI {
        #storage;
        #config;

        constructor(storage, config) {
            this.#storage = storage;
            this.#config = config;
            this.#injectStyles();
        }

        setLoadingState(button, isLoading, originalText = '') {
            if (!button) return;
            if (isLoading) {
                button.disabled = true;
                button.dataset.originalText = button.textContent;
                button.innerHTML = `<div class="cookie-share-spinner"></div>`;
            } else {
                button.disabled = false;
                button.innerHTML = button.dataset.originalText || originalText;
            }
        }

        showNotification(message, type = "success") {
            const existing = document.querySelector(".cookie-share-notification");
            if (existing) existing.remove();
            const el = document.createElement("div");
            el.className = `cookie-share-notification ${type}`;
            el.textContent = message;
            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add("show"));
            setTimeout(() => {
                el.classList.remove("show");
                setTimeout(() => el.remove(), 5000);
            }, 5000);
        }

        confirm(title, message, confirmText = "删除") {
            return new Promise(resolve => {
                const overlay = this.#createOverlay(() => resolve(false));
                const dialog = document.createElement("div");
                dialog.className = "cookie-share-modal visible";
                dialog.style.maxWidth = "400px";
                dialog.innerHTML = `<div class="cookie-share-container" style="padding: 24px;"><h3 style="text-align: center; margin-top: 0;">${title}</h3><p style="text-align: center;">${message}</p><div style="display: flex; gap: 12px; justify-content: center;"><button id="cs-confirm-cancel" class="action-btn" style="background: #91B3A7;">取消</button><button id="cs-confirm-ok" class="clear-btn">${confirmText}</button></div></div>`;
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                dialog.querySelector("#cs-confirm-ok").onclick = () => { overlay.remove(); resolve(true); };
                dialog.querySelector("#cs-confirm-cancel").onclick = () => { overlay.remove(); resolve(false); };
            });
        }

        #createOverlay(onClose) {
            const existing = document.querySelector(".cookie-share-overlay");
            if (existing) existing.remove();
            const overlay = document.createElement("div");
            overlay.className = "cookie-share-overlay";
            overlay.onclick = (e) => { if (e.target === overlay && onClose) onClose(); };
            return overlay;
        }

        #createModal(title, content, customClass = "") {
            const overlay = this.#createOverlay(() => overlay.remove());
            const modal = document.createElement("div");
            modal.className = `cookie-share-modal ${customClass}`;
            modal.innerHTML = `<div class="cookie-share-container"><button class="close-btn">×</button><div class="title-container"><h1>${title}</h1></div>${content}</div>`;
            modal.querySelector('.close-btn').onclick = () => overlay.remove();
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            requestAnimationFrame(() => {
                overlay.classList.add("visible");
                modal.classList.add("visible");
            });
            return { overlay, modal };
        }

        async createMainPanel(callbacks) {
            const content = `
                <div class="id-input-container">
                    <input type="text" id="cs-profile-name" class="cookie-id-input" placeholder="配置名称 (区分账户)" autocomplete="username">
                </div>
                <div class="action-buttons">
                    <button id="cs-save" class="action-btn">另存为配置</button>
                    <button id="cs-show-list" class="action-btn" style="flex-grow: 0.5;">配置列表</button>
                </div>
                <details class="settings-details">
                    <summary>设置</summary>
                    <div id="cs-settings-container">
                        ${await this.#getSettingsHTML()}
                    </div>
                </details>`;
            const { modal } = this.#createModal("Cookie 存储", content);

            const profileNameInput = modal.querySelector("#cs-profile-name");
            const saveButton = modal.querySelector("#cs-save");
            const testBtn = modal.querySelector('#cs-test-webdav');

            modal.querySelector("#cs-show-list").onclick = callbacks.onShowList;
            saveButton.onclick = () => callbacks.onSave(profileNameInput.value, saveButton);
            testBtn.onclick = () => callbacks.onTestWebDAV(testBtn);

            ['url', 'user', 'pass'].forEach(key => {
                const input = modal.querySelector(`#cs-webdav-${key}`);
                input.onchange = (e) => this.#storage.set(this.#config.STORAGE_KEYS[`WEBDAV_${key.toUpperCase()}`], e.target.value.trim());
            });

            const passInput = modal.querySelector('#cs-webdav-pass');
            if (passInput) {
                passInput.addEventListener('focus', () => {
                    if (passInput.type === 'text') {
                        passInput.type = 'password';
                    }
                }, { once: true });
            }
        }

        async createCookieListPanel(callbacks) {
            const content = `<div id="cs-profile-list" class="cookie-list-container">加载中...</div><div class="action-buttons" style="margin-top: 16px;"><button id="cs-sync-cloud" class="action-btn">从云端拉取配置</button></div>`;
            const { modal } = this.#createModal("Cookie 配置列表", content, "cookie-list-modal");
            const listContainer = modal.querySelector("#cs-profile-list");
            const syncBtn = modal.querySelector("#cs-sync-cloud");
            syncBtn.onclick = async () => {
                this.setLoadingState(syncBtn, true);
                await callbacks.onSync();
                this.setLoadingState(syncBtn, false);
            };
            callbacks.onLoadList(listContainer);
        }

        renderCookieList(container, profiles, callbacks) {
            if (!container) return;
            container.innerHTML = "";
            if (profiles.length === 0) {
                container.innerHTML = `<div class="cookie-share-empty">未找到与 ${window.location.hostname} 相关的本地 Cookie 配置。</div>`;
                return;
            }
            profiles.forEach(({ profileName, source }) => {
                const item = document.createElement("div");
                item.className = "cookie-share-item";
                const sourceText = source === "local" ? "本地" : "云端";
                item.innerHTML = `<span>配置: ${profileName} (${sourceText})</span><div class="cookie-share-buttons"><button class="cookie-share-apply">应用</button><button class="cookie-share-delete">删除</button></div>`;
                const applyBtn = item.querySelector(".cookie-share-apply");
                const deleteBtn = item.querySelector(".cookie-share-delete");
                applyBtn.onclick = () => callbacks.onApply(profileName, applyBtn);
                deleteBtn.onclick = () => callbacks.onDelete(profileName, source, deleteBtn);
                container.appendChild(item);
            });
        }

        async #getSettingsHTML() {
            const url = await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_URL, "");
            const user = await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_USER, "");
            const pass = await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_PASS, "");
            return `
                <div class="settings-group">
                    <h4>WebDAV 同步设置</h4>
                    <div class="settings-field">
                        <label for="cs-webdav-url">服务器 URL</label>
                        <input type="text" id="cs-webdav-url" class="settings-input" placeholder="https://dav.example.com/dav" value="${url}" autocomplete="off">
                    </div>
                    <div class="settings-field">
                        <label for="cs-webdav-user">用户名</label>
                        <input type="text" id="cs-webdav-user" class="settings-input" placeholder="WebDAV 用户名" value="${user}" autocomplete="off">
                    </div>
                    <div class="settings-field">
                        <label for="cs-webdav-pass">密码</label>
                        <input type="text" id="cs-webdav-pass" class="settings-input" placeholder="WebDAV 密码" value="${pass}" autocomplete="off">
                    </div>
                </div>
                <button id="cs-test-webdav" class="action-btn">测试连接</button>`;
        }

        #injectStyles() {
            GM_addStyle(`
                :root {
                    --cs-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    --cs-primary-color: #007AFF;
                    --cs-danger-color: #FF3B30;
                    --cs-text-color: #1d1d1f;
                    --cs-text-color-secondary: #6e6e73;
                    --cs-border-color: rgba(0, 0, 0, 0.1);
                }
                .cookie-share-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(20px) saturate(180%);
                    z-index: 2147483646;
                    display: flex; justify-content: center; align-items: center;
                    opacity: 0; transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .cookie-share-overlay.visible { opacity: 1; }
                .cookie-share-modal {
                    background: rgba(248, 248, 250, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.1);
                    border-radius: 16px;
                    width: min(500px, 90vw); max-height: 90vh;
                    overflow: hidden; position: relative; z-index: 2147483647;
                    transform: scale(0.95) translateY(10px);
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .cookie-share-modal.visible { transform: scale(1) translateY(0); }
                .cookie-share-container { font-family: var(--cs-font-family); padding: 32px; box-sizing: border-box; }
                .close-btn {
                    position: absolute; right: 12px; top: 12px; width: 32px; height: 32px;
                    background: rgba(0,0,0,0.05); border: none; border-radius: 50%;
                    font-size: 16px; color: var(--cs-text-color-secondary); cursor: pointer;
                    display: flex; align-items: center; justify-content: center; padding: 0;
                    transition: background 0.2s, color 0.2s;
                }
                .close-btn:hover { background: rgba(0,0,0,0.1); color: var(--cs-text-color); }
                .title-container { text-align: center; margin-bottom: 32px; }
                .title-container h1 { font-size: 24px; margin: 0; color: var(--cs-text-color); font-weight: 500; }
                .id-input-container { margin-bottom: 24px; }
                input.cookie-id-input, .settings-input {
                    width: 100%; height: auto; padding: 12px 4px;
                    border: none; border-bottom: 1px solid var(--cs-border-color);
                    border-radius: 0; font-size: 16px;
                    background: transparent; color: var(--cs-text-color);
                    transition: border-color 0.3s; box-sizing: border-box;
                }
                input.cookie-id-input:focus, .settings-input:focus {
                    border-color: var(--cs-primary-color);
                    box-shadow: none; outline: none;
                }
                button {
                    height: 48px; border: none; border-radius: 12px;
                    font-size: 16px; font-weight: 500; cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                button:disabled { cursor: not-allowed; opacity: 0.5; }
                .action-buttons { display: flex; gap: 16px; margin-bottom: 16px; }
                .action-btn, .clear-btn {
                    flex: 1;
                    background: #fff;
                    color: var(--cs-primary-color);
                    border: 1px solid var(--cs-border-color);
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                }
                .clear-btn { color: var(--cs-danger-color); }
                .action-btn:hover:not(:disabled), .clear-btn:hover:not(:disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 10px rgba(0,0,0,0.08);
                }
                .cookie-list-modal { max-width: 600px; }
                .cookie-list-container { margin-top: 20px; max-height: 400px; overflow-y: auto; margin-bottom: 16px; }
                .cookie-share-item {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 16px; border-radius: 12px; margin-bottom: 12px;
                    background: rgba(255,255,255,0.5);
                    border: 1px solid var(--cs-border-color);
                    transition: all 0.2s;
                }
                .cookie-share-item:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
                .cookie-share-buttons { display: flex; gap: 8px; }
                .cookie-share-apply, .cookie-share-delete {
                    padding: 6px 12px; border-radius: 8px; font-size: 14px; height: auto;
                    background: #fff; border: 1px solid var(--cs-border-color);
                    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
                }
                .cookie-share-apply { color: var(--cs-primary-color); }
                .cookie-share-delete { color: var(--cs-danger-color); }
                .cookie-share-empty { text-align: center; padding: 40px; color: var(--cs-text-color-secondary); }
                .cookie-share-spinner { width: 18px; height: 18px; border: 2px solid rgba(0,0,0,0.1); border-top-color: var(--cs-text-color); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto; }
                @keyframes spin { to { transform: rotate(360deg); } }
                .settings-details { margin-top: 24px; border-top: 1px solid var(--cs-border-color); padding-top: 24px; }
                .settings-details summary { cursor: pointer; color: var(--cs-text-color-secondary); margin-bottom: 16px; font-weight: 500; }
                #cs-settings-container { padding: 0; background: transparent; border-radius: 0; }
                .settings-group h4 { margin-top: 0; margin-bottom: 16px; color: var(--cs-text-color); border-bottom: 1px solid var(--cs-border-color); padding-bottom: 8px; font-weight: 500; }
                .settings-field { margin-bottom: 16px; }
                .settings-field label { display: block; font-size: 14px; color: var(--cs-text-color-secondary); margin-bottom: 8px; }
                #cs-test-webdav { margin-top: 16px; width: 100%; }
                .cookie-share-notification {
                    position: fixed; bottom: 24px; right: 24px;
                    padding: 16px 24px; border-radius: 12px;
                    backdrop-filter: blur(10px) saturate(180%);
                    background: rgba(248, 248, 250, 0.9);
                    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                    border: 1px solid rgba(255,255,255,0.4);
                    color: var(--cs-text-color);
                    font-family: var(--cs-font-family); font-size: 14px;
                    transform: translateY(150%);
                    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    z-index: 2147483647; max-width: 350px;
                }
                .cookie-share-notification.show { transform: translateY(0); }
                .cookie-share-notification.success { border-left: 4px solid #34C759; }
                .cookie-share-notification.error { border-left: 4px solid var(--cs-danger-color); }
                .cookie-share-notification.warning { border-left: 4px solid #FF9500; }
            `);
        }
    }

    class CookieShareApp {
        #config = new Config();
        #storage = new Storage();
        #ui = new UI(this.#storage, this.#config);
        #webdav = new WebDAVClient(this.#storage, this.#config);
        #currentHost = window.location.hostname;
        #isBusy = false;

        constructor() {
            this.#init();
        }

        #init() {
            this.#registerMenuCommands();
            this.#setupEventListeners();
        }

        #registerMenuCommands() {
            GM_registerMenuCommand("显示 Cookie 分享面板 (Alt+Shift+C)", () => this.showMainPanel());
            GM_registerMenuCommand("显示 Cookie 配置列表 (Alt+Shift+L)", () => this.showCookieList());
        }

        #setupEventListeners() {
            document.addEventListener("keydown", (e) => {
                if (e.altKey && e.shiftKey) {
                    if (e.key.toLowerCase() === 'c') { e.preventDefault(); this.showMainPanel(); }
                    else if (e.key.toLowerCase() === 'l') { e.preventDefault(); this.showCookieList(); }
                }
            }, true);
        }

        showMainPanel() {
            this.#ui.createMainPanel({
                onShowList: () => this.showCookieList(),
                onSave: (name, btn) => this.#handleSave(name, btn),
                onTestWebDAV: (btn) => this.#handleTestWebDAV(btn),
            });
        }

        showCookieList() {
            this.#ui.createCookieListPanel({
                onLoadList: (container) => this.#renderProfileList(container),
                onSync: () => this.#handleSync(document.querySelector("#cs-profile-list")),
                onApply: (name, btn) => this.#handleApply(name, btn),
                onDelete: (name, src, btn) => this.#handleDelete(name, src, btn),
            });
        }

        #getLocalKey(profileName) {
            return `${this.#config.LOCAL_STORAGE_PREFIX}${this.#currentHost}_${profileName}`;
        }

        async #handleTestWebDAV(button) {
            if (this.#isBusy) return;
            this.#isBusy = true;
            this.#ui.setLoadingState(button, true);
            try {
                await this.#webdav.testConnection();
                this.#ui.showNotification("WebDAV 连接成功！", "success");
            } catch (err) {
                this.#ui.showNotification(`WebDAV 连接失败: ${err.message}`, "error");
            } finally {
                this.#ui.setLoadingState(button, false);
                this.#isBusy = false;
            }
        }

        async #handleSave(rawProfileName, button) {
            if (this.#isBusy) return;
            if (!rawProfileName) return this.#ui.showNotification("请输入配置名称", "error");
            const profileName = sanitizeForFilename(rawProfileName);
            if (!profileName) return this.#ui.showNotification("配置名称包含无效字符", "error");

            const localKey = this.#getLocalKey(profileName);
            if (await this.#storage.get(localKey) !== null) {
                if (!await this.#ui.confirm("确认操作", `一个名为 '${profileName}' 的配置已存在。要覆盖它吗？`)) return;
            }

            this.#isBusy = true;
            this.#ui.setLoadingState(button, true);
            try {
                const cookies = await CookieManager.getAll();

                if (cookies.length === 0) {
                    this.#ui.showNotification("未找到可访问的Cookie。请确保页面已完全加载或尝试刷新后重试。", "error");
                    return;
                }

                const httpOnlyCount = cookies.filter(c => c.httpOnly).length;
                const data = { profileName, cookies, savedAt: new Date().toISOString() };
                await this.#storage.set(localKey, JSON.stringify(data));

                if (cookies.length < 3 && httpOnlyCount > 0) {
                    this.#ui.showNotification(`捕获到 ${cookies.length} 个Cookie。部分核心Cookie可能受高级安全策略(如SameSite/HttpOnly)保护，无法自动访问。`, "warning");
                } else {
                    this.#ui.showNotification(`成功捕获 ${cookies.length} 个Cookie (其中 ${httpOnlyCount} 个为HttpOnly)。配置已保存。`, "success");
                }

                if (await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_URL)) {
                    const filename = `${this.#currentHost}_${profileName}.json`;
                    await this.#webdav.put(this.#config.WEBDAV_BASE_PATH + filename, data);
                    this.#ui.showNotification("已成功同步到 WebDAV", "success");
                }
            } catch (err) {
                this.#ui.showNotification(`同步到 WebDAV 失败: ${err.message}`, "error");
            } finally {
                this.#ui.setLoadingState(button, false);
                this.#isBusy = false;
            }
        }

        async #renderProfileList(container) {
            const localPrefix = `${this.#config.LOCAL_STORAGE_PREFIX}${this.#currentHost}_`;
            const allKeys = await this.#storage.list();
            const profiles = allKeys
                .filter(key => key.startsWith(localPrefix))
                .map(key => ({ profileName: key.substring(localPrefix.length), source: "local" }));

            this.#ui.renderCookieList(container, profiles, {
                onApply: (name, btn) => this.#handleApply(name, btn),
                onDelete: (name, src, btn) => this.#handleDelete(name, src, btn),
            });
        }

        async #handleSync(container) {
            if (this.#isBusy) return;
            this.#isBusy = true;
            try {
                const remoteFiles = await this.#webdav.list(this.#config.WEBDAV_BASE_PATH);
                const localKeys = new Set(await this.#storage.list());
                let newProfilesCount = 0;
                for (const filename of remoteFiles) {
                    if (filename.startsWith(this.#currentHost + "_") && filename.endsWith(".json")) {
                        const profileName = filename.substring((this.#currentHost + "_").length, filename.length - 5);
                        const localKey = this.#getLocalKey(profileName);
                        if (!localKeys.has(localKey)) {
                            const data = await this.#webdav.get(this.#config.WEBDAV_BASE_PATH + filename);
                            await this.#storage.set(localKey, JSON.stringify(data));
                            newProfilesCount++;
                        }
                    }
                }
                this.#ui.showNotification(`同步完成, 成功拉取 ${newProfilesCount} 个新配置。`, "success");
            } catch (err) {
                this.#ui.showNotification(`同步失败: ${err.message}`, "error");
            } finally {
                await this.#renderProfileList(container);
                this.#isBusy = false;
            }
        }

        async #handleApply(profileName, button) {
            if (this.#isBusy) return;
            this.#isBusy = true;
            this.#ui.setLoadingState(button, true);
            const localKey = this.#getLocalKey(profileName);
            let successCount = 0;
            let totalCount = 0;

            try {
                const rawData = await this.#storage.get(localKey);
                if (!rawData) throw new Error("本地配置数据未找到");

                let data;
                try {
                    data = JSON.parse(rawData);
                } catch (e) {
                    throw new Error("本地配置数据格式无效");
                }

                const cookiesToImport = data.cookies;
                if (!Array.isArray(cookiesToImport)) throw new Error("本地配置数据格式无效");

                totalCount = cookiesToImport.length;

                const oldCookies = await CookieManager.getAll();
                const newCookieMap = new Map(cookiesToImport.map(c => [`${c.name}|${c.domain}|${c.path}`, c]));

                const cookiesToDelete = oldCookies.filter(c => !newCookieMap.has(`${c.name}|${c.domain}|${c.path}`));

                for (const cookie of cookiesToDelete) {
                    await CookieManager.delete(cookie);
                }

                for (const cookie of cookiesToImport) {
                    try {
                        await CookieManager.set(cookie);
                        successCount++;
                    } catch (e) {
                        console.error("CookieShare: Failed to set cookie. Details:", { cookie, error: e.message });
                    }
                }

                this.#ui.showNotification(`Cookie 应用完成，页面即将刷新。成功: ${successCount}/${totalCount}`, "success");
                setTimeout(() => window.location.reload(), 500);
            } catch (error) {
                this.#ui.showNotification(`应用 Cookie 失败: ${error.message}`, "error");
                this.#ui.setLoadingState(button, false);
                this.#isBusy = false;
            }
        }

        async #handleDelete(profileName, source, button) {
            if (this.#isBusy) return;
            if (!await this.#ui.confirm("确认操作", `您确定要删除 '${profileName}' 这个配置吗？`)) return;

            this.#isBusy = true;
            this.#ui.setLoadingState(button, true);
            const localKey = this.#getLocalKey(profileName);
            let remoteDeleteFailed = false;

            try {
                if (await this.#storage.get(this.#config.STORAGE_KEYS.WEBDAV_URL)) {
                    const filename = `${this.#currentHost}_${profileName}.json`;
                    try {
                        await this.#webdav.delete(this.#config.WEBDAV_BASE_PATH + filename);
                    } catch (err) {
                        if (!err.message.includes("404")) {
                            remoteDeleteFailed = true;
                            this.#ui.showNotification(`删除失败: ${err.message}`, "error");
                        }
                    }
                }
                await this.#storage.delete(localKey);
                if (remoteDeleteFailed) {
                    this.#ui.showNotification("本地配置已删除，但从 WebDAV 删除失败。下次同步时它可能会重新出现。", "error");
                } else {
                    this.#ui.showNotification("本地配置已删除", "success");
                }
            } catch (error) {
                this.#ui.showNotification(`删除失败: ${error.message}`, "error");
            } finally {
                this.showCookieList();
                this.#isBusy = false;
            }
        }
    }

    new CookieShareApp();
})();