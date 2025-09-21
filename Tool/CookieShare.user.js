// ==UserScript==
// @name         !.Cookie Share (WebDAV Sync)
// @description  具有WebDAV同步的本地cookie管理脚本
// @version      3.4.0
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

    const I18N = {
        cookieShareTitle: "Cookie 分享",
        cookiesListTitle: "Cookie 配置列表",
        confirmDeleteTitle: "确认操作",
        closeButton: "×",
        cancelButton: "取消",
        deleteButton: "删除",
        applyButton: "应用",
        showListButton: "配置列表",
        saveCookieButton: "另存为配置",
        clearAllCookiesButton: "清除本页所有 Cookie",
        sourceLocal: "本地",
        sourceCloud: "云端",
        loading: "加载中...",
        syncFromCloudButton: "从云端同步/合并",
        settingsTitle: "设置",
        webdavSettingsTitle: "WebDAV 同步设置",
        webdavUrlLabel: "服务器 URL",
        webdavUserLabel: "用户名",
        webdavPassLabel: "密码",
        testingConnection: "正在测试连接...",
        testConnectionButton: "测试连接",
        placeholderProfileName: "配置名称 (可使用浏览器填充)",
        placeholderWebdavUrl: "https://dav.example.com/dav",
        placeholderWebdavUser: "WebDAV 用户名",
        placeholderWebdavPass: "WebDAV 密码",
        menuShowShare: "显示 Cookie 分享面板 (Alt+Shift+C)",
        menuShowList: "显示 Cookie 配置列表 (Alt+Shift+L)",
        notificationEnterProfileName: "请输入配置名称",
        notificationInvalidProfileName: "配置名称包含无效字符",
        notificationNoCookiesToSave: "未找到可访问的Cookie。请确保页面已完全加载或尝试刷新后重试。",
        notificationSavedSuccess: "成功捕获 {{total}} 个Cookie (其中 {{httpOnlyCount}} 个为HttpOnly)。配置已保存。",
        notificationSavedWithWarning: "捕获到 {{total}} 个Cookie。部分核心Cookie可能受高级安全策略(如SameSite/HttpOnly)保护，无法自动访问。",
        notificationSyncWebDAVSuccess: "已成功同步到 WebDAV",
        notificationSyncWebDAVFailed: "同步到 WebDAV 失败: {{message}}",
        notificationAppliedSuccess: "Cookie 应用完成，页面即将刷新。成功: {{successCount}}/{{totalCount}}",
        notificationClearedSuccess: "Cookie 已清除，页面即将刷新",
        notificationProfileNotFound: "本地配置数据未找到",
        notificationProfileInvalid: "本地配置数据格式无效",
        notificationNeedWebDAVConfig: "请先配置并测试 WebDAV",
        notificationApplyFailed: "应用 Cookie 失败: {{message}}",
        notificationLocalDeleted: "本地配置已删除",
        notificationWebDAVDeleted: "WebDAV 配置已删除",
        notificationDeleteFailed: "删除失败: {{message}}",
        notificationDeleteRemoteFailed: "本地配置已删除，但从 WebDAV 删除失败。下次同步时它可能会重新出现。",
        notificationWebDAVSuccess: "WebDAV 连接成功！",
        notificationWebDAVFailed: "WebDAV 连接失败: {{message}}",
        notificationSyncComplete: "同步完成, 成功拉取 {{count}} 个新配置。",
        notificationSyncFailed: "同步失败: {{message}}",
        notificationNetworkError: "网络请求失败",
        notificationRequestTimeout: "请求超时",
        confirmDeleteMessage: "您确定要删除 '{{profileName}}' 这个配置吗？",
        confirmOverwriteMessage: "一个名为 '{{profileName}}' 的配置已存在。要覆盖它吗？",
        confirmClearMessage: "此操作将替换当前站点的所有 Cookie。您确定吗？",
        listEmpty: "未找到与 {{host}} 相关的本地 Cookie 配置。",
        profile: "配置",
    };

    const t = (key, replacements = {}) => {
        let translation = I18N[key] || key;
        for (const placeholder in replacements) {
            translation = translation.replace(new RegExp(`{{\\s*${placeholder}\\s*}}`, "g"), replacements[placeholder]);
        }
        return translation;
    };

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
        static getAll() {
            return new Promise((resolve) => {
                GM_cookie.list({}, (cookies) => resolve(cookies.map(c => ({ ...c, path: c.path || "/" }))));
            });
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
        static async clearAll() {
            const cookies = await this.getAll();
            if (cookies.length === 0) return;
            await Promise.all(cookies.map(cookie => this.delete(cookie)));
        }
    }

    class WebDAVClient {
        constructor(storage, config) {
            this.storage = storage;
            this.config = config;
        }
        _getAuthHeader(user, pass) {
            return user && pass ? "Basic " + btoa(user + ":" + pass) : null;
        }
        _translateError(err) {
            if (err.status === 401) return "认证失败，请检查用户名和密码。";
            if (err.status === 403) return "权限被拒绝。";
            if (err.status === 404) return "路径未找到。";
            if (err.status >= 500) return `服务器错误 (${err.status})。`;
            return err.responseText || err.message || "未知错误发生。";
        }
        _request(options) {
            return new Promise(async (resolve, reject) => {
                const url = await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_URL);
                if (!url) {
                    return reject({ status: -1, message: t("notificationNeedWebDAVConfig") });
                }
                const user = await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_USER, "");
                const pass = await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_PASS, "");
                const authHeader = this._getAuthHeader(user, pass);
                const headers = { ...options.headers };
                if (authHeader) headers["Authorization"] = authHeader;
                GM_xmlhttpRequest({
                    ...options, headers, timeout: 15000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) resolve(res);
                        else reject({ status: res.status, responseText: res.responseText, message: `HTTP Error ${res.status}` });
                    },
                    onerror: () => reject({ status: 0, message: t("notificationNetworkError") }),
                    ontimeout: () => reject({ status: 0, message: t("notificationRequestTimeout") }),
                });
            });
        }
        async _getBaseUrl() {
            const url = await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_URL);
            return url ? url.replace(/\/+$/, "") : null;
        }
        async testConnection() {
            const baseUrl = await this._getBaseUrl();
            if (!baseUrl) throw new Error(t("notificationNeedWebDAVConfig"));
            return this._request({ method: 'PROPFIND', url: `${baseUrl}${this.config.WEBDAV_BASE_PATH}`, headers: { 'Depth': '0' } });
        }
        async put(filePath, data) {
            const baseUrl = await this._getBaseUrl();
            if (!baseUrl) throw new Error(t("notificationNeedWebDAVConfig"));
            return this._request({ method: 'PUT', url: `${baseUrl}${filePath}`, data: JSON.stringify(data, null, 2), headers: { 'Content-Type': 'application/json' } });
        }
        async get(filePath) {
            const baseUrl = await this._getBaseUrl();
            if (!baseUrl) throw new Error(t("notificationNeedWebDAVConfig"));
            const response = await this._request({ method: 'GET', url: `${baseUrl}${filePath}` });
            return JSON.parse(response.responseText);
        }
        async delete(filePath) {
            const baseUrl = await this._getBaseUrl();
            if (!baseUrl) throw new Error(t("notificationNeedWebDAVConfig"));
            return this._request({ method: 'DELETE', url: `${baseUrl}${filePath}` });
        }
        async list(dirPath) {
            const baseUrl = await this._getBaseUrl();
            if (!baseUrl) throw new Error(t("notificationNeedWebDAVConfig"));
            try {
                const response = await this._request({ method: 'PROPFIND', url: `${baseUrl}${dirPath}`, headers: { 'Depth': '1' } });
                const hrefs = response.responseText.match(/<d:href>(.*?)<\/d:href>/g) || [];
                return hrefs.map(href => href.replace(/<\/?d:href>/g, '')).filter(href => href.endsWith('.json')).map(fullPath => fullPath.split('/').pop());
            } catch (error) {
                if (error.status === 404) {
                    this._request({ method: 'MKCOL', url: `${baseUrl}${dirPath}` }).catch(console.error);
                    return [];
                }
                throw error;
            }
        }
    }

    class UI {
        constructor(storage, config) {
            this.storage = storage;
            this.config = config;
            this.injectStyles();
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
        confirm(title, message, confirmText = t("deleteButton")) {
            return new Promise(resolve => {
                const overlay = this._createOverlay(() => resolve(false));
                const dialog = document.createElement("div");
                dialog.className = "cookie-share-modal visible";
                dialog.style.maxWidth = "400px";
                dialog.innerHTML = `<div class="cookie-share-container" style="padding: 24px;"><h3 style="text-align: center; margin-top: 0;">${title}</h3><p style="text-align: center;">${message}</p><div style="display: flex; gap: 12px; justify-content: center;"><button id="cs-confirm-cancel" class="action-btn" style="background: #91B3A7;">${t("cancelButton")}</button><button id="cs-confirm-ok" class="clear-btn">${confirmText}</button></div></div>`;
                overlay.appendChild(dialog);
                document.body.appendChild(overlay);
                dialog.querySelector("#cs-confirm-ok").onclick = () => { overlay.remove(); resolve(true); };
                dialog.querySelector("#cs-confirm-cancel").onclick = () => { overlay.remove(); resolve(false); };
            });
        }
        _createOverlay(onClose) {
            const existing = document.querySelector(".cookie-share-overlay");
            if (existing) existing.remove();
            const overlay = document.createElement("div");
            overlay.className = "cookie-share-overlay";
            overlay.onclick = (e) => { if (e.target === overlay && onClose) onClose(); };
            return overlay;
        }
        _createModal(title, content, customClass = "") {
            const overlay = this._createOverlay(() => overlay.remove());
            const modal = document.createElement("div");
            modal.className = `cookie-share-modal ${customClass}`;
            modal.innerHTML = `<div class="cookie-share-container"><button class="close-btn">${t("closeButton")}</button><div class="title-container"><h1>${title}</h1></div>${content}</div>`;
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
                    <input type="text" id="cs-profile-name" class="cookie-id-input" placeholder="${t("placeholderProfileName")}" autocomplete="username">
                </div>
                <div class="action-buttons">
                    <button id="cs-save" class="action-btn">${t("saveCookieButton")}</button>
                    <button id="cs-show-list" class="action-btn" style="flex-grow: 0.5;">${t("showListButton")}</button>
                </div>
                <button id="cs-clear" class="clear-btn">${t("clearAllCookiesButton")}</button>
                <details class="settings-details">
                    <summary>${t("settingsTitle")}</summary>
                    <div id="cs-settings-container">
                        ${await this._getSettingsHTML()}
                    </div>
                </details>`;
            const { modal } = this._createModal(t("cookieShareTitle"), content);

            const profileNameInput = modal.querySelector("#cs-profile-name");
            const saveButton = modal.querySelector("#cs-save");
            const clearButton = modal.querySelector("#cs-clear");
            const testBtn = modal.querySelector('#cs-test-webdav');

            modal.querySelector("#cs-show-list").onclick = callbacks.onShowList;
            saveButton.onclick = () => callbacks.onSave(profileNameInput.value, saveButton);
            clearButton.onclick = () => callbacks.onClear(clearButton);
            testBtn.onclick = () => callbacks.onTestWebDAV(testBtn);

            ['url', 'user', 'pass'].forEach(key => {
                const input = modal.querySelector(`#cs-webdav-${key}`);
                input.onchange = (e) => this.storage.set(this.config.STORAGE_KEYS[`WEBDAV_${key.toUpperCase()}`], e.target.value.trim());
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
            const content = `<div id="cs-profile-list" class="cookie-list-container">${t("loading")}</div><div class="action-buttons" style="margin-top: 16px;"><button id="cs-sync-cloud" class="action-btn">${t("syncFromCloudButton")}</button></div>`;
            const { modal } = this._createModal(t("cookiesListTitle"), content, "cookie-list-modal");
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
                container.innerHTML = `<div class="cookie-share-empty">${t("listEmpty", { host: window.location.hostname })}</div>`;
                return;
            }
            profiles.forEach(({ profileName, source }) => {
                const item = document.createElement("div");
                item.className = "cookie-share-item";
                const sourceText = t(source === "local" ? "sourceLocal" : "sourceCloud");
                item.innerHTML = `<span>${t('profile')}: ${profileName} (${sourceText})</span><div class="cookie-share-buttons"><button class="cookie-share-apply">${t("applyButton")}</button><button class="cookie-share-delete">${t("deleteButton")}</button></div>`;
                const applyBtn = item.querySelector(".cookie-share-apply");
                const deleteBtn = item.querySelector(".cookie-share-delete");
                applyBtn.onclick = () => callbacks.onApply(profileName, applyBtn);
                deleteBtn.onclick = () => callbacks.onDelete(profileName, source, deleteBtn);
                container.appendChild(item);
            });
        }

        async _getSettingsHTML() {
            const url = await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_URL, "");
            const user = await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_USER, "");
            const pass = await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_PASS, "");
            return `
                <div class="settings-group">
                    <h4>${t("webdavSettingsTitle")}</h4>
                    <div class="settings-field">
                        <label for="cs-webdav-url">${t("webdavUrlLabel")}</label>
                        <input type="text" id="cs-webdav-url" class="settings-input" placeholder="${t("placeholderWebdavUrl")}" value="${url}" autocomplete="off">
                    </div>
                    <div class="settings-field">
                        <label for="cs-webdav-user">${t("webdavUserLabel")}</label>
                        <input type="text" id="cs-webdav-user" class="settings-input" placeholder="${t("placeholderWebdavUser")}" value="${user}" autocomplete="off">
                    </div>
                    <div class="settings-field">
                        <label for="cs-webdav-pass">${t("webdavPassLabel")}</label>
                        <input type="text" id="cs-webdav-pass" class="settings-input" placeholder="${t("placeholderWebdavPass")}" value="${pass}" autocomplete="off">
                    </div>
                </div>
                <button id="cs-test-webdav" class="action-btn">${t("testConnectionButton")}</button>`;
        }

        injectStyles() {
            GM_addStyle(`
                .cookie-share-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.3); backdrop-filter: blur(2px); z-index: 2147483646; display: flex; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.2s ease; }
                .cookie-share-overlay.visible { opacity: 1; }
                .cookie-share-modal { background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 8px 32px rgba(31,38,135,0.15); border-radius: 12px; width: min(500px, 90vw); max-height: 90vh; overflow: hidden; position: relative; z-index: 2147483647; transform: scale(0.95); transition: transform 0.2s ease; }
                .cookie-share-modal.visible { transform: scale(1); }
                .cookie-share-container { font-family: -apple-system, system-ui, sans-serif; padding: 32px; }
                .close-btn { position: absolute; right: 16px; top: 16px; width: 32px; height: 32px; background: none; border: none; font-size: 24px; color: #666; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
                .title-container { text-align: center; margin-bottom: 20px; }
                .title-container h1 { font-size: 28px; margin: 0; color: #000; }
                .id-input-container { display: flex; gap: 16px; margin-bottom: 16px; align-items: center; }
                input.cookie-id-input, .settings-input { width: 100%; height: 48px; padding: 0 16px; border: 1px solid rgba(145,179,167,0.3); border-radius: 8px; font-size: 16px; background: rgba(255,255,255,0.95); color: #000; transition: all 0.3s; box-sizing: border-box; }
                input.cookie-id-input:focus, .settings-input:focus { border-color: #91B3A7; box-shadow: 0 0 0 2px rgba(145,179,167,0.2); outline: none; }
                button { height: 48px; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; transition: all 0.3s ease; }
                button:disabled { cursor: not-allowed; filter: grayscale(50%); opacity: 0.7; }
                .action-buttons { display: flex; gap: 16px; margin-bottom: 16px; }
                .action-btn { flex: 1; background: #91B3A7; color: white; }
                .action-btn:hover:not(:disabled) { background: #7A9B8F; transform: translateY(-1px); }
                .clear-btn { width: 100%; background: #FF6B6B; color: white; }
                .clear-btn:hover:not(:disabled) { background: #FF5252; transform: translateY(-1px); }
                .cookie-list-modal { max-width: 600px; }
                .cookie-list-container { margin-top: 20px; max-height: 400px; overflow-y: auto; margin-bottom: 16px; }
                .cookie-share-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid rgba(145,179,167,0.2); transition: all 0.3s; }
                .cookie-share-item:hover { transform: translateY(-1px); }
                .cookie-share-buttons { display: flex; gap: 8px; }
                .cookie-share-apply, .cookie-share-delete { padding: 6px 12px; border-radius: 4px; font-size: 14px; height: auto; }
                .cookie-share-apply { background: #91B3A7; color: white; }
                .cookie-share-delete { background: #FF6B6B; color: white; }
                .cookie-share-empty, .cookie-share-error { text-align: center; padding: 20px; color: #666; }
                .cookie-share-spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .settings-details { margin-top: 16px; border-top: 1px solid #e0e0e0; padding-top: 16px; }
                .settings-details summary { cursor: pointer; color: #555; margin-bottom: 12px; font-weight: 500; }
                #cs-settings-container { padding: 16px; background: #f7f7f7; border-radius: 8px; }
                .settings-group h4 { margin-top: 0; margin-bottom: 16px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
                .settings-field { margin-bottom: 12px; }
                .settings-field label { display: block; font-size: 14px; color: #555; margin-bottom: 6px; }
                .settings-input { height: 40px; font-size: 14px; }
                #cs-test-webdav { margin-top: 12px; width: 100%; }
                .cookie-share-notification { position: fixed; bottom: 24px; right: 24px; padding: 16px 24px; border-radius: 12px; backdrop-filter: blur(10px); background: rgba(255,255,255,0.95); box-shadow: 0 8px 32px rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.2); color: #000; font-family: -apple-system, system-ui, sans-serif; font-size: 14px; transform: translateY(150%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); z-index: 2147483647; max-width: 350px; }
                .cookie-share-notification.show { transform: translateY(0); }
                .cookie-share-notification.success { border-left: 4px solid #91B3A7; }
                .cookie-share-notification.error { border-left: 4px solid #FF6B6B; }
                .cookie-share-notification.warning { border-left: 4px solid #f0ad4e; }
            `);
        }
    }

    class CookieShareApp {
        constructor() {
            this.config = new Config();
            this.storage = new Storage();
            this.ui = new UI(this.storage, this.config);
            this.webdav = new WebDAVClient(this.storage, this.config);
            this.currentHost = window.location.hostname;
            this.init();
        }

        init() {
            this.registerMenuCommands();
            this.setupEventListeners();
        }

        registerMenuCommands() {
            GM_registerMenuCommand(t("menuShowShare"), () => this.showMainPanel());
            GM_registerMenuCommand(t("menuShowList"), () => this.showCookieList());
        }

        setupEventListeners() {
            document.addEventListener("keydown", (e) => {
                if (e.altKey && e.shiftKey) {
                    if (e.key.toLowerCase() === 'c') { e.preventDefault(); this.showMainPanel(); }
                    else if (e.key.toLowerCase() === 'l') { e.preventDefault(); this.showCookieList(); }
                }
            }, true);
        }

        showMainPanel() {
            this.ui.createMainPanel({
                onShowList: () => this.showCookieList(),
                onSave: (name, btn) => this.handleSave(name, btn),
                onClear: (btn) => this.handleClearAll(btn),
                onTestWebDAV: (btn) => this.handleTestWebDAV(btn),
            });
        }

        showCookieList() {
            this.ui.createCookieListPanel({
                onLoadList: (container) => this.renderProfileList(container),
                onSync: () => this.handleSync(document.querySelector("#cs-profile-list")),
                onApply: (name, btn) => this.handleApply(name, btn),
                onDelete: (name, src, btn) => this.handleDelete(name, src, btn),
            });
        }

        _getLocalKey(profileName) {
            return `${this.config.LOCAL_STORAGE_PREFIX}${this.currentHost}_${profileName}`;
        }

        async handleTestWebDAV(button) {
            this.ui.setLoadingState(button, true);
            try {
                await this.webdav.testConnection();
                this.ui.showNotification(t("notificationWebDAVSuccess"), "success");
            } catch (err) {
                this.ui.showNotification(t("notificationWebDAVFailed", { message: this.webdav._translateError(err) }), "error");
            } finally {
                this.ui.setLoadingState(button, false);
            }
        }

        async handleSave(rawProfileName, button) {
            if (!rawProfileName) return this.ui.showNotification(t("notificationEnterProfileName"), "error");
            const profileName = sanitizeForFilename(rawProfileName);
            if (!profileName) return this.ui.showNotification(t("notificationInvalidProfileName"), "error");

            const localKey = this._getLocalKey(profileName);
            if (await this.storage.get(localKey) !== null) {
                if (!await this.ui.confirm(t('confirmDeleteTitle'), t('confirmOverwriteMessage', { profileName }))) return;
            }

            this.ui.setLoadingState(button, true);
            try {
                const cookies = await CookieManager.getAll();

                if (cookies.length === 0) {
                    this.ui.showNotification(t("notificationNoCookiesToSave"), "error");
                    return;
                }

                const httpOnlyCount = cookies.filter(c => c.httpOnly).length;
                const data = { profileName, cookies, savedAt: new Date().toISOString() };
                await this.storage.set(localKey, JSON.stringify(data));

                if (cookies.length < 3 && httpOnlyCount > 0) {
                     this.ui.showNotification(t("notificationSavedWithWarning", { total: cookies.length }), "warning");
                } else {
                     this.ui.showNotification(t("notificationSavedSuccess", { total: cookies.length, httpOnlyCount }), "success");
                }

                if (await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_URL)) {
                    const filename = `${this.currentHost}_${profileName}.json`;
                    await this.webdav.put(this.config.WEBDAV_BASE_PATH + filename, data);
                    this.ui.showNotification(t("notificationSyncWebDAVSuccess"), "success");
                }
            } catch (err) {
                this.ui.showNotification(t("notificationSyncWebDAVFailed", { message: this.webdav._translateError(err) }), "error");
            } finally {
                this.ui.setLoadingState(button, false);
            }
        }

        async handleClearAll(button) {
            if (await this.ui.confirm(t("confirmDeleteTitle"), t("confirmClearMessage"))) {
                this.ui.setLoadingState(button, true);
                await CookieManager.clearAll();
                this.ui.showNotification(t("notificationClearedSuccess"), "success");
                setTimeout(() => window.location.reload(), 500);
            }
        }

        async renderProfileList(container) {
            const localPrefix = `${this.config.LOCAL_STORAGE_PREFIX}${this.currentHost}_`;
            const allKeys = await this.storage.list();
            const profiles = allKeys
                .filter(key => key.startsWith(localPrefix))
                .map(key => ({ profileName: key.substring(localPrefix.length), source: "local" }));

            this.ui.renderCookieList(container, profiles, {
                onApply: (name, btn) => this.handleApply(name, btn),
                onDelete: (name, src, btn) => this.handleDelete(name, src, btn),
            });
        }

        async handleSync(container) {
            try {
                const remoteFiles = await this.webdav.list(this.config.WEBDAV_BASE_PATH);
                const localKeys = new Set(await this.storage.list());
                let newProfilesCount = 0;
                for (const filename of remoteFiles) {
                    if (filename.startsWith(this.currentHost + "_") && filename.endsWith(".json")) {
                        const profileName = filename.substring((this.currentHost + "_").length, filename.length - 5);
                        const localKey = this._getLocalKey(profileName);
                        if (!localKeys.has(localKey)) {
                            const data = await this.webdav.get(this.config.WEBDAV_BASE_PATH + filename);
                            await this.storage.set(localKey, JSON.stringify(data));
                            newProfilesCount++;
                        }
                    }
                }
                this.ui.showNotification(t("notificationSyncComplete", { count: newProfilesCount }), "success");
            } catch (err) {
                this.ui.showNotification(t("notificationSyncFailed", { message: this.webdav._translateError(err) }), "error");
            } finally {
                await this.renderProfileList(container);
            }
        }

        async handleApply(profileName, button) {
            this.ui.setLoadingState(button, true);
            const localKey = this._getLocalKey(profileName);
            let successCount = 0;
            let totalCount = 0;

            try {
                const rawData = await this.storage.get(localKey);
                if (!rawData) throw new Error(t("notificationProfileNotFound"));

                const data = JSON.parse(rawData);
                const cookiesToImport = data.cookies;
                if (!Array.isArray(cookiesToImport)) throw new Error(t("notificationProfileInvalid"));

                totalCount = cookiesToImport.length;
                await CookieManager.clearAll();

                for (const cookie of cookiesToImport) {
                    try {
                        await CookieManager.set(cookie);
                        successCount++;
                    } catch (e) {
                        console.error("CookieShare: Failed to set cookie. Details:", { cookie, error: e.message });
                    }
                }

                this.ui.showNotification(t("notificationAppliedSuccess", { successCount, totalCount }), "success");
                setTimeout(() => window.location.reload(), 500);
            } catch (error) {
                this.ui.showNotification(t("notificationApplyFailed", { message: error.message }), "error");
                this.ui.setLoadingState(button, false);
            }
        }

        async handleDelete(profileName, source, button) {
            if (!await this.ui.confirm(t('confirmDeleteTitle'), t('confirmDeleteMessage', { profileName }))) return;
            this.ui.setLoadingState(button, true);
            const localKey = this._getLocalKey(profileName);
            let remoteDeleteFailed = false;
            try {
                if (await this.storage.get(this.config.STORAGE_KEYS.WEBDAV_URL)) {
                    const filename = `${this.currentHost}_${profileName}.json`;
                    try {
                        await this.webdav.delete(this.config.WEBDAV_BASE_PATH + filename);
                    } catch (err) {
                        if (err.status !== 404) {
                            remoteDeleteFailed = true;
                            this.ui.showNotification(t("notificationDeleteFailed", { message: this.webdav._translateError(err) }), "error");
                        }
                    }
                }
                await this.storage.delete(localKey);
                if (remoteDeleteFailed) {
                    this.ui.showNotification(t("notificationDeleteRemoteFailed"), "error");
                } else {
                    this.ui.showNotification(t("notificationLocalDeleted"), "success");
                }
            } catch (error) {
                this.ui.showNotification(t("notificationDeleteFailed", { message: error.message }), "error");
            } finally {
                this.showCookieList();
            }
        }
    }

    new CookieShareApp();
})();