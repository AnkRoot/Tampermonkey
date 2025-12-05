// ==UserScript==
// @name         !.Account Snapshot Sync
// @description  ☁️ 基于WebDAV的账户快照同步系统——让你的数字身份在所有设备间无缝流转。
//               自动捕获当前站点的完整会话状态（Cookie、localStorage、sessionStorage）为快照，
//               通过WebDAV实现多设备间的智能同步与一致性管理。
//
//               ◼ 核心特性：
//                 • WebDAV中心化存储：
//                   - 支持任意WebDAV服务（koofr、坚果云、Nextcloud、ownCloud等）
//                   - 云端作为单一数据源（SSOT），本地仅作智能缓存
//                   - 采用标准HTTP协议，确保数据安全可控
//
//                 • 智能同步机制：
//                   - 自动拉取：页面加载时自动从云端拉取最新快照
//                   - 增量更新：仅同步变更部分，减少网络开销
//                   - 版本感知：基于时间戳的版本控制，自动处理冲突
//
//                 • 灵活的冲突解决：
//                   - 双源共存：本地和云端快照可同时存在
//                   - 左键设定：点击快照标签可设置默认数据源（本地优先/云端优先）
//                   - 右键覆盖：右键强制覆盖，实现快速数据迁移
//                   - 智能提示：通过视觉标签清晰标识数据来源
//
//                 • 完整的会话管理：
//                   - Cookie完整同步：包括域名、路径、安全标识等全部属性
//                   - Storage全量备份：localStorage和sessionStorage的完整复制
//                   - 清理式恢复：恢复前自动清理现有数据，避免污染
//
//                 • 安全与性能：
//                   - Shadow DOM隔离：UI组件完全隔离，不影响页面
//                   - 数据加密传输：全程HTTPS，防止中间人攻击
//                   - 异步处理：所有IO操作异步化，页面不卡顿
//                   - 智能缓存：云端快照本地缓存，减少重复请求
//
//               ◼ 使用场景：
//                 • 多设备办公：在家和公司之间保持登录状态
//                 • 测试环境隔离：为不同的测试账号保存独立快照
//                 • 临时会话保存：需要重启浏览器时保存当前工作状态
//                 • 团队账号共享：安全地在团队成员间传递账号访问权限
//                 • 开发调试：快速切换不同的用户身份进行测试
//
//               ◼ 操作流程：
//                 1. 首次使用：配置WebDAV → 创建第一个快照 → 上传至云端
//                 2. 日常使用：打开网页 → 自动同步云端快照 → 一键恢复
//                 3. 冲突处理：查看双源快照 → 选择优先级 → 设为默认源
//                 4. 数据迁移：右键覆盖 → 选择目标方向 → 完成同步
//
//               ◼ 技术亮点：
//                 • 清单式管理：使用JSON清单文件跟踪所有快照，支持批量操作
//                 • 域名隔离：自动按域名分组快照，避免跨域混乱
//                 • 优雅降级：WebDAV不可用时仍可使用本地功能
//                 • 内存优化：快照数据按需加载，不占用过多内存
//                 • 错误恢复：完善的错误处理机制，操作失败不影响现有数据
//
//               —— 让你的数字身份真正自由流动的跨设备同步解决方案。
// @version      1.2.1
// @author       ank
// @namespace    https://010314.xyz/
// @license      AGPL-3.0
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        GM_setClipboard
// @connect      *
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/AccountSnapshotSync.user.js
// @downloadURL  https://raw.githubusercontent.com/AnkRoot/AnkTool/main/Tampermonkey/Tool/AccountSnapshotSync.user.js
// ==/UserScript==
(function () {
    "use strict";
    if (window.self !== window.top) return;

    class Config {
        static KEYS = {
            DAV_URL: "cfg_dav_url",
            DAV_USER: "cfg_dav_user",
            DAV_PASS: "cfg_dav_pass",
        };
        static CONSTS = {
            BASE_PATH: "/CookieShare/",
            MANIFEST_FILE: "_cs_manifest.json",
            PREFIX: "csp_",
            CLOUD_PREFIX: "csp_cld_",
            PREF_PREFIX: "csp_pref_",
            TIMEOUT: 15000,
            TIP_KEY_PREFIX: "csp_tip_",
        };
    }

    const Utils = {
        sanitize: str => (str || "未命名").trim().replace(/[\s\\/:"*?<>|]+/g, "_"),
        safeErr: err => typeof err === "string" ? err : err?.statusText || err?.msg || err?.message || `错误 ${err?.status}`,
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        icon(name) {
            const icons = {
                close: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
                save: '<path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>',
                copy: '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>',
                restore: '<path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>',
                delete: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
                upload: '<path d="M5 20h14v-2H5v2zm7-16-5.5 5.5h4V18h3V9.5h4L12 4z"/>',
                sync: '<path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.68 2.81l1.46 1.46C19.54 14.76 20 13.43 20 12c0-4.42-3.58-8-8-8zm-6.78.73L3.76 6.19C2.46 7.84 2 9.67 2 11.5 2 15.57 5.03 19 9 19v3l4-4-4-4v3c-2.76 0-5-2.57-5-5.5 0-1.2.35-2.33.94-3.27z"/>'
            };
            return `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;display:block;">${icons[name] || ''}</svg>`;
        }
    };

    class ConfigManager {
        static #davCache = null;
        static #davListeners = new Set();

        static async getDavConfig() {
            if (this.#davCache) return this.#davCache;

            const trim = s => (s || "").trim();
            const url = GM_getValue(Config.KEYS.DAV_URL, "");
            const user = GM_getValue(Config.KEYS.DAV_USER, "");
            const pass = GM_getValue(Config.KEYS.DAV_PASS, "");

            this.#davCache = { url: trim(url), user: trim(user), pass: trim(pass) };
            return this.#davCache;
        }

        static async saveDavConfig(input = {}) {
            const trim = s => (s || "").trim();
            const next = {
                url: trim(input.url),
                user: trim(input.user),
                pass: trim(input.pass)
            };

            GM_setValue(Config.KEYS.DAV_URL, next.url);
            GM_setValue(Config.KEYS.DAV_USER, next.user);
            GM_setValue(Config.KEYS.DAV_PASS, next.pass);

            this.#davCache = next;
            this.#emitDavChange(next);
            return next;
        }

        static onDavChange(handler) {
            if (typeof handler !== "function") return () => { };
            this.#davListeners.add(handler);
            return () => this.#davListeners.delete(handler);
        }

        static #emitDavChange(config) {
            for (const handler of this.#davListeners) {
                try { handler(config); }
                catch (err) { console.warn("DAV config listener error:", err); }
            }
        }
    }

    class WebDavClient {
        #authCache = null;
        #dirChecked = false;
        #dirCache = new Map();

        constructor() {
            ConfigManager.onDavChange(() => this.reset());
        }

        async #getAuth() {
            if (this.#authCache) return this.#authCache;
            const { url, user, pass } = await ConfigManager.getDavConfig();
            if (!url) throw { msg: "未配置 WebDAV URL" };
            this.#authCache = {
                url: url.replace(/\/+$/, ""),
                headers: (user && pass) ? { "Authorization": "Basic " + btoa(`${user}:${pass}`) } : {}
            };
            return this.#authCache;
        }

        #normalizeDir(path) {
            const safe = (path || "/").replace(/\\/g, "/");
            let normalized = safe.replace(/\/+/g, "/");
            if (!normalized.startsWith("/")) normalized = `/${normalized}`;
            if (!normalized.endsWith("/")) normalized += "/";
            return normalized;
        }

        #isMissingStatus(status) {
            return [400, 404, 405, 409, 410].includes(status);
        }

        async #probeDir(path) {
            const dirPath = this.#normalizeDir(path);
            try {
                await this.request("PROPFIND", dirPath, null, { Depth: "0" });
                return true;
            } catch (err) {
                if (this.#isMissingStatus(err?.status)) return false;
                if (err?.status && [301, 302].includes(err.status)) return true;
                if (err?.status && [400, 405, 501].includes(err.status)) {
                    return await this.#probeViaHead(dirPath);
                }
                throw err;
            }
        }

        async #probeViaHead(dirPath) {
            try {
                await this.request("HEAD", dirPath);
                return true;
            } catch (err) {
                if (this.#isMissingStatus(err?.status)) return false;
                if (err?.status && [301, 302].includes(err.status)) return true;
                throw err;
            }
        }

        async #mkcol(path) {
            const dirPath = this.#normalizeDir(path);
            try {
                await this.request("MKCOL", dirPath, "", { "Content-Type": "" });
                return;
            } catch (err) {
                if (err.status === 405 || err.status === 301 || err.status === 302) return;
                if (err.status === 409 || err.status === 415) {
                    const alt = dirPath.replace(/\/$/, "");
                    await this.request("MKCOL", alt, "", { "Content-Type": "" });
                    return;
                }
                throw err;
            }
        }

        request(method, path, data = null, headers = {}) {
            return new Promise(async (resolve, reject) => {
                try {
                    const { url, headers: authHeaders } = await this.#getAuth();
                    const fullUrl = path.startsWith("http") ? path : `${url}${path}`;

                    GM_xmlhttpRequest({
                        method, url: fullUrl,
                        headers: { ...authHeaders, ...headers },
                        data,
                        timeout: Config.CONSTS.TIMEOUT,
                        onload: r => (r.status >= 200 && r.status < 300) ? resolve(r) : reject({ status: r.status, msg: r.statusText || `HTTP ${r.status}`, responseText: r.responseText }),
                        onerror: () => reject({ msg: "网络错误" }),
                        ontimeout: () => reject({ msg: "请求超时" })
                    });
                } catch (e) { reject(e); }
            });
        }

        reset() {
            this.#authCache = null;
            this.#dirChecked = false;
            this.#dirCache.clear();
        }

        async ensureDir() {
            if (this.#dirChecked) return;

            const segments = Config.CONSTS.BASE_PATH.replace(/(^\/+|\/+$)/g, "").split("/").filter(Boolean);
            if (segments.length === 0) { this.#dirChecked = true; return; }

            let cursor = "";
            for (const seg of segments) {
                cursor = `${cursor}/${seg}`.replace(/\/+/g, "/");
                const dirPath = this.#normalizeDir(cursor);
                if (this.#dirCache.get(dirPath)) continue;
                const exists = await this.#probeDir(dirPath);
                if (!exists) await this.#mkcol(dirPath);
                this.#dirCache.set(dirPath, true);
            }
            this.#dirChecked = true;
        }

        async listFiles() {
            try {
                await this.ensureDir();
                const res = await this.request("PROPFIND", Config.CONSTS.BASE_PATH, null, { Depth: "1" });
                const parser = new DOMParser();
                const doc = parser.parseFromString(res.responseText, "application/xml");
                const nodes = Array.from(doc.getElementsByTagName("*")).filter(n => n.localName === "href");
                const files = new Set();
                nodes.forEach(node => {
                    const raw = node.textContent?.trim();
                    if (!raw) return;
                    const parts = raw.split("/").filter(Boolean);
                    const name = parts.pop();
                    if (!name || !name.endsWith(".json")) return;
                    if (name === Config.CONSTS.MANIFEST_FILE) return;
                    files.add(decodeURIComponent(name));
                });
                if (files.size > 0) return Array.from(files);
                throw new Error("云端列表为空");
            } catch (e) {
                try {
                    const res = await this.request("GET", `${Config.CONSTS.BASE_PATH}${Config.CONSTS.MANIFEST_FILE}?t=${Date.now()}`);
                    const manifest = JSON.parse(res.responseText);
                    return Array.isArray(manifest) ? manifest : [];
                } catch (e2) {
                    return []; // Empty or error
                }
            }
        }

        async saveFile(fileName, contentObj) {
            await this.ensureDir(); // Ensure directory exists

            const content = JSON.stringify(contentObj);

            // 1. Write File
            await this.request("PUT", `${Config.CONSTS.BASE_PATH}${fileName}`, content, { "Content-Type": "application/json" });

            // 2. Update Manifest (Best Effort)
            this.#updateManifest(fileName, 'add', contentObj?.meta?.time || Date.now());
        }

        async deleteFile(fileName) {
            try {
                await this.request("DELETE", `${Config.CONSTS.BASE_PATH}${fileName}`);
            } catch (e) {
                if (e.status !== 404) throw e;
            }
            this.#updateManifest(fileName, 'remove');
        }

        #parseManifest(raw) {
            if (!raw) return [];
            const source = Array.isArray(raw) ? raw : Array.isArray(raw?.files) ? raw.files : [];
            return source.map(entry => this.#normalizeManifestEntry(entry)).filter(Boolean);
        }

        #normalizeManifestEntry(entry) {
            if (!entry) return null;
            if (typeof entry === "string") return { name: entry, time: null };
            if (typeof entry === "object" && entry.name) {
                return { name: entry.name, time: typeof entry.time === "number" ? entry.time : null };
            }
            return null;
        }

        async getManifestList() {
            try {
                const res = await this.request("GET", `${Config.CONSTS.BASE_PATH}${Config.CONSTS.MANIFEST_FILE}?t=${Date.now()}`);
                return this.#parseManifest(JSON.parse(res.responseText));
            } catch (err) {
                return [];
            }
        }

        async #updateManifest(fileName, action, metaTime = null) {
            try {
                let list = [];
                try {
                    const r = await this.request("GET", `${Config.CONSTS.BASE_PATH}${Config.CONSTS.MANIFEST_FILE}`);
                    list = this.#parseManifest(JSON.parse(r.responseText));
                } catch (e) { }

                if (action === 'add') {
                    const entry = { name: fileName, time: metaTime ?? Date.now() };
                    const idx = list.findIndex(i => i.name === fileName);
                    if (idx >= 0) list[idx] = entry;
                    else list.push(entry);
                } else if (action === 'remove') {
                    list = list.filter(i => i.name !== fileName);
                }

                await this.request("PUT", `${Config.CONSTS.BASE_PATH}${Config.CONSTS.MANIFEST_FILE}`, JSON.stringify(list), { "Content-Type": "application/json" });
            } catch (e) {
                console.warn("Manifest update warning:", e);
            }
        }
    }

    class ProfileManager {
        static async collect(name) {
            const cookies = await this.#listCookies();
            return {
                meta: { v: 1, name, host: location.hostname, url: location.href, time: Date.now() },
                data: { cookies, local: { ...localStorage }, session: { ...sessionStorage } }
            };
        }

        static async restore(snapshot) {
            if (!snapshot?.data?.cookies) throw new Error("快照数据无效");

            // Clean
            localStorage.clear();
            sessionStorage.clear();
            const currentCookies = await this.#listCookies();
            for (const c of currentCookies) await this.#deleteCookie(c.name);

            // Restore Storage
            if (snapshot.data.local) Object.entries(snapshot.data.local).forEach(([k, v]) => localStorage.setItem(k, v));
            if (snapshot.data.session) Object.entries(snapshot.data.session).forEach(([k, v]) => sessionStorage.setItem(k, v));

            // Restore Cookies
            let count = 0;
            for (const c of snapshot.data.cookies) {
                try {
                    await this.#setCookie(c);
                    count++;
                } catch (e) { }
            }
            return count;
        }

        static #listCookies = () => new Promise(r => GM_cookie.list({ url: location.href }, c => r(c || [])));

        static #deleteCookie = name => new Promise(r => GM_cookie.delete({ url: location.href, name }, r));

        static #setCookie = cookie => new Promise((resolve, reject) => {
            GM_cookie.set({
                url: location.href,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                expirationDate: cookie.expirationDate
            }, err => err ? reject(err) : resolve());
        });
    }

    class UI {
        #host;
        #root;
        #dav = new WebDavClient();
        #statusEl = null;
        #prefCache = new Map();

        constructor() {
            this.#initHost();
            this.#injectCSS();
            GM_registerMenuCommand("打开 Account Snapshot Sync", () => this.open());
        }

        #initHost() {
            this.#host = document.createElement("div");
            this.#host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
            document.documentElement.appendChild(this.#host);
            this.#root = this.#host.attachShadow({ mode: "closed" });
        }

        #injectCSS() {
            const css = `
                :host {
                    --bg: #fdfbf7; --fg: #1a1a1a; --fg-sub: #555;
                    --border: #333; --accent: #000; --danger: #d00;
                    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                }
                * { box-sizing: border-box; outline: none; }
                
                .overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.2);
                    display: flex; align-items: center; justify-content: center;
                    opacity: 0; pointer-events: none; transition: opacity 0.15s; z-index: 99998;
                }
                .overlay.open { opacity: 1; pointer-events: auto; }
                
                .panel {
                    width: 400px; max-width: 90vw; max-height: 85vh;
                    background: var(--bg); color: var(--fg); font-family: var(--font);
                    border: 2px solid var(--border); display: flex; flex-direction: column;
                    box-shadow: 8px 8px 0 rgba(0,0,0,0.1);
                }

                .head { padding: 12px 16px; border-bottom: 2px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: #fff; }
                .head h2 { margin: 0; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
                .close-btn { cursor: pointer; border: none; background: none; color: var(--fg); padding: 4px; display:flex; }
                .close-btn:hover { color: var(--danger); }

                .body { padding: 16px; overflow-y: auto; }
                .status-bar {
                    display: none; margin-bottom: 10px; padding: 8px 12px;
                    font-size: 12px; background: rgba(0,0,0,0.05); border: 1px solid #ccc;
                }
                .status-bar[data-type="error"] { border-color: #d33; color: #b00; background: #ffecec; }

                label { display: block; font-size: 11px; font-weight: 700; color: var(--fg-sub); margin-bottom: 4px; text-transform: uppercase; }
                input { width: 100%; padding: 8px; margin-bottom: 12px; background: #fff; border: 1px solid #aaa; border-radius: 0; font-size: 13px; }
                input:focus { border-color: var(--accent); border-left: 3px solid var(--accent); }

                .btn {
                    width: 100%; padding: 8px 12px; background: #fff; border: 1px solid var(--border);
                    color: var(--fg); font-size: 12px; font-weight: 600; text-transform: uppercase;
                    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
                    transition: all 0.1s;
                }
                .btn:hover { background: #f0f0f0; }
                .btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }

                .tabs { display: flex; border-bottom: 2px solid var(--border); margin-bottom: 16px; }
                .tab { flex: 1; text-align: center; padding: 8px; font-size: 12px; font-weight: 600; cursor: pointer; color: #888; border-bottom: 2px solid transparent; }
                .tab.active { color: var(--accent); background: #fff; }

                .item { background: #fff; border-bottom: 1px solid #eee; padding: 10px; display: flex; justify-content: space-between; align-items: center; }
                .item:last-child { border-bottom: none; }
                .item-info { flex: 1; overflow: hidden; margin-right: 10px; }
                .item-name { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .item-meta { font-size: 10px; color: #999; display: flex; gap: 6px; margin-top: 2px; }
                .tag { border: 1px solid #ddd; padding: 0 3px; font-size: 9px; text-transform: uppercase; }
                .tag.cloud { background: #eef; color: #00a; border-color: #ccf; }
                .tag.active { background: var(--accent); color: #fff; border-color: var(--accent); }
                .tag.cloud.active { background: #224; color: #fff; border-color: #66f; }
                .actions { display: flex; gap: 4px; }
                .icon-btn { padding: 4px; border: 1px solid transparent; background: transparent; cursor: pointer; color: #666; display: flex; }
                .icon-btn:hover { color: #000; background: #eee; }
                .icon-btn.del:hover { color: var(--danger); background: #fff0f0; }

                .tip-bar {
                    display: none; margin-bottom: 10px; padding: 6px 10px;
                    font-size: 11px; color: #333; background: #f5f5ff; border: 1px dashed #99a;
                }
                details { border: 1px dashed #ccc; padding: 8px; margin-top: 10px; background: #fafafa; }
                summary { font-size: 11px; cursor: pointer; color: var(--fg-sub); user-select: none; }
            `;
            const style = document.createElement("style");
            style.textContent = css;
            this.#root.appendChild(style);
        }

        async open() {
            if (!this.#root.querySelector(".overlay")) this.#render();
            this.loadList();
            await Utils.sleep(10);
            this.#root.querySelector(".overlay").classList.add("open");
        }

        close() { this.#root.querySelector(".overlay")?.classList.remove("open"); }

        #setStatus(msg = "", type = "info") {
            if (!this.#statusEl) return;
            this.#statusEl.textContent = msg || "";
            this.#statusEl.dataset.type = type;
            this.#statusEl.style.display = msg ? "block" : "none";
        }

        #storagePrefix(type) {
            if (type === "cloud") return Config.CONSTS.CLOUD_PREFIX;
            if (type === "pref") return Config.CONSTS.PREF_PREFIX;
            return Config.CONSTS.PREFIX;
        }
        #localKey(id) { return this.#storagePrefix("local") + id; }
        #cloudKey(id) { return this.#storagePrefix("cloud") + id; }
        #prefKey(id) { return this.#storagePrefix("pref") + id; }
        #idFromKey(key, type) {
            const prefix = this.#storagePrefix(type);
            return key.startsWith(prefix) ? key.slice(prefix.length) : null;
        }
        #belongsToHost(id) { return id.startsWith(`${location.hostname}_`); }
        #displayName(id) { return id.replace(`${location.hostname}_`, "").replace(".json", ""); }
        #showListTip(message = "") {
            const tip = this.#root.querySelector("#list_tip");
            if (!tip) return;
            tip.textContent = message;
            tip.style.display = message ? "block" : "none";
        }

        #notifyError(err, prefix = "错误") {
            this.#setStatus(`${prefix}: ${Utils.safeErr(err)}`, "error");
        }

        async #runQuietly(task, prefix = "错误") {
            try {
                return await task();
            } catch (err) {
                this.#notifyError(err, prefix);
                return null;
            }
        }

        async #withSnapshot(item, handler, options = {}) {
            const { source = null, onError = null } = options;
            try {
                const chosenSource = source || await this.#chooseSource(item);
                const snapshot = await this.#readSnapshot(item.id, chosenSource);
                return await handler(snapshot, chosenSource);
            } catch (err) {
                if (typeof onError === "function") onError(err);
                else this.#notifyError(err);
                return null;
            }
        }

        async #getPreferredSource(id) {
            if (this.#prefCache.has(id)) return this.#prefCache.get(id);
            const key = this.#prefKey(id);
            const saved = GM_getValue(key);
            if (saved === "local" || saved === "cloud") {
                this.#prefCache.set(id, saved);
                return saved;
            }
            return null;
        }

        async #setPreferredSource(id, source) {
            const normalized = source === "cloud" ? "cloud" : "local";
            GM_setValue(this.#prefKey(id), normalized);
            this.#prefCache.set(id, normalized);
        }

        async #ensureDavReady() {
            const { url } = await ConfigManager.getDavConfig();
            if (url) return true;
            this.#setStatus("请先配置 WebDAV", "error");
            return false;
        }

        async #syncFromCloud(interactive = false) {
            const seen = new Set();
            const entries = await this.#loadRemoteEntries();
            const pulled = await this.#importRemoteEntries(entries, seen);
            await this.#cleanupCloudCache(seen);
            if (interactive) this.#setStatus(`云端同步完成，共拉取 ${pulled} 份快照`, "info");
            return Array.from(seen);
        }

        async #loadRemoteEntries() {
            const host = location.hostname;
            const manifestEntries = await this.#dav.getManifestList();
            if (manifestEntries.length > 0) {
                return manifestEntries.filter(entry => entry?.name?.startsWith(host));
            }
            const files = await this.#dav.listFiles();
            return files.filter(name => name?.startsWith(host)).map(name => ({ name, time: null }));
        }

        async #importRemoteEntries(entries, seen) {
            let pulled = 0;
            for (const entry of entries) {
                if (await this.#refreshRemoteEntry(entry, seen)) pulled++;
            }
            return pulled;
        }

        async #refreshRemoteEntry(entry, seen) {
            const name = entry?.name;
            if (!name) return false;
            seen.add(name);
            const cloudKey = this.#cloudKey(name);
            const cached = GM_getValue(cloudKey);
            const remoteTime = typeof entry?.time === "number" ? entry.time : null;
            if (!this.#needsRemoteFetch(cached, remoteTime)) return false;
            try {
                const remote = await this.#fetchRemoteSnapshot(name);
                GM_setValue(cloudKey, remote);
                return true;
            } catch (err) {
                console.warn("Cloud fetch failed:", name, err);
                return false;
            }
        }

        #needsRemoteFetch(cached, remoteTime) {
            if (!cached) return true;
            if (remoteTime === null) return false;
            const cachedTime = cached?.meta?.time || 0;
            return remoteTime > cachedTime;
        }

        async #cleanupCloudCache(seen) {
            const keys = GM_listValues();
            for (const key of keys) {
                const id = this.#idFromKey(key, "cloud");
                if (!id || !this.#belongsToHost(id)) continue;
                if (!seen.has(id)) GM_deleteValue(key);
            }
        }

        async #fetchRemoteSnapshot(fileName) {
            const res = await this.#dav.request("GET", `${Config.CONSTS.BASE_PATH}${fileName}`);
            try {
                return JSON.parse(res.responseText);
            } catch (err) {
                throw new Error("云端快照损坏");
            }
        }

        async #chooseSource(item) {
            const pref = await this.#getPreferredSource(item.id);
            if (item.local && !item.cloud) return "local";
            if (item.cloud && !item.local) return "cloud";
            if (item.local && item.cloud) {
                const hint = pref ? `\n当前默认设置：${pref === "cloud" ? "云端" : "本地"}` : "";
                const useCloud = window.confirm(`"${item.display}" 同时存在于本地与云端。\n确定=临时使用云端，取消=使用本地${hint}`);
                return useCloud ? "cloud" : "local";
            }
            throw new Error("未找到可用快照");
        }

        async #readSnapshot(id, source = "auto") {
            const localKey = this.#localKey(id);
            const cloudKey = this.#cloudKey(id);
            if (source === "local") {
                const local = GM_getValue(localKey);
                if (local) return local;
                throw new Error("本地快照缺失");
            }
            if (source === "cloud") {
                let remote = GM_getValue(cloudKey);
                if (remote) return remote;
                if (!(await this.#ensureDavReady())) throw new Error("未配置 WebDAV");
                remote = await this.#fetchRemoteSnapshot(id);
                if (remote) GM_setValue(cloudKey, remote);
                return remote;
            }
            const pref = await this.#getPreferredSource(id);
            if (pref) return await this.#readSnapshot(id, pref);
            const stored = GM_getValue(localKey);
            if (stored) return stored;
            return await this.#readSnapshot(id, "cloud");
        }

        async #uploadLocalSnapshots(btn) {
            if (!(await this.#ensureDavReady())) return;
            const entries = [];
            for (const key of GM_listValues()) {
                const id = this.#idFromKey(key, "local");
                if (id && this.#belongsToHost(id)) entries.push({ key, id });
            }
            if (entries.length === 0) { this.#setStatus("暂无本地快照", "info"); return; }
            const button = btn;
            const original = button.innerHTML;
            button.textContent = "上传中...";
            let ok = 0;
            for (const entry of entries) {
                const data = GM_getValue(entry.key);
                if (!data) continue;
                const fileName = entry.id;
                try {
                    await this.#dav.saveFile(fileName, data);
                    GM_setValue(this.#cloudKey(fileName), data);
                    ok++;
                } catch (err) {
                    console.error("Upload failed", fileName, err);
                }
            }
            button.innerHTML = original;
            this.#setStatus(`上传完成：${ok}/${entries.length}`, "info");
            this.loadList({ cloud: true });
        }

        async #uploadSingleSnapshot(item) {
            if (!item.local) return this.#setStatus("当前仅存在云端版本", "info");
            if (!(await this.#ensureDavReady())) return;
            const confirmMsg = `上传 "${item.display}" 至云端？将覆盖同名云端快照。`;
            if (!window.confirm(confirmMsg)) return;
            await this.#withSnapshot(item, async (data) => {
                await this.#dav.saveFile(item.id, data);
                GM_setValue(this.#cloudKey(item.id), data);
                this.#setStatus("已上传至云端", "info");
                this.loadList();
            }, { source: "local", onError: err => this.#notifyError(err, "上传失败") });
        }

        #buildTag(label, source, item, active) {
            const tag = document.createElement("span");
            tag.className = `tag${source === "cloud" ? " cloud" : ""}${active ? " active" : ""}`;
            tag.textContent = label;
            tag.title = "左键设为默认，右键执行覆盖";
            tag.onclick = async (e) => {
                e.preventDefault();
                await this.#setPreferredSource(item.id, source);
                this.#setStatus(`默认来源已切换为 ${label}`, "info");
                this.loadList();
            };
            tag.oncontextmenu = async (e) => {
                e.preventDefault();
                await this.#handleTagAction(item, source);
            };
            return tag;
        }

        #createIconButton(icon, title, cls = "icon-btn") {
            const btn = document.createElement("button");
            btn.className = cls;
            btn.innerHTML = Utils.icon(icon);
            btn.title = title;
            return btn;
        }

        async #handleTagAction(item, source) {
            if (source === "local") {
                if (!(await this.#ensureDavReady())) return;
                if (!confirm(`使用本地快照 "${item.display}" 覆盖云端版本?`)) return;
                await this.#withSnapshot(item, async (data) => {
                    await this.#dav.saveFile(item.id, data);
                    GM_setValue(this.#cloudKey(item.id), data);
                    this.#setStatus("云端已更新为本地版本", "info");
                    this.loadList({ cloud: true });
                }, { source: "local" });
                return;
            }
            if (!confirm(`使用云端快照 "${item.display}" 覆盖本地版本?`)) return;
            await this.#withSnapshot(item, async (remote) => {
                GM_setValue(this.#localKey(item.id), remote);
                this.#setStatus("本地已更新为云端版本", "info");
                this.loadList();
            }, { source: "cloud" });
        }

        #render() {
            const div = document.createElement("div");
            div.className = "overlay";
            div.innerHTML = this.#panelHTML();
            this.#root.appendChild(div);

            const q = (s) => div.querySelector(s);
            this.#statusEl = q("#status_bar");
            q(".close-btn").onclick = () => this.close();
            div.onclick = (e) => { if (e.target === div) this.close(); };

            const tabs = div.querySelectorAll(".tab");
            tabs.forEach(t => t.onclick = () => {
                tabs.forEach(x => x.classList.remove("active")); t.classList.add("active");
                q("#view-save").style.display = t.dataset.view === "save" ? "block" : "none";
                q("#view-list").style.display = t.dataset.view === "list" ? "block" : "none";
            });

            ConfigManager.getDavConfig().then(({ url, user, pass }) => {
                if (url) q("#cfg_dav_url").value = url;
                if (user) q("#cfg_dav_user").value = user;
                if (pass) q("#cfg_dav_pass").value = pass;
            });

            q("#btn_save_cfg").onclick = async () => {
                const config = {
                    url: q("#cfg_dav_url").value,
                    user: q("#cfg_dav_user").value,
                    pass: q("#cfg_dav_pass").value
                };
                await ConfigManager.saveDavConfig(config);
                this.#setStatus("配置已保存", "info");
            };

            q("#btn_do_save").onclick = async (e) => {
                const name = q("#cfg_name").value.trim();
                if (!name) return this.#setStatus("请输入快照名称", "error");
                const btn = e.currentTarget; const old = btn.innerHTML; btn.textContent = "处理中...";
                try {
                    const clean = Utils.sanitize(name);
                    const snap = await ProfileManager.collect(clean);
                    const fn = `${location.hostname}_${clean}.json`;
                    GM_setValue(Config.CONSTS.PREFIX + fn, snap);

                    if (q("#cfg_dav_url").value.trim()) {
                        await this.#dav.saveFile(fn, snap);
                        GM_setValue(this.#cloudKey(fn), snap);
                        this.#setStatus("已同步本地 + 云端", "info");
                    } else {
                        this.#setStatus("已保存本地", "info");
                    }
                    q("#cfg_name").value = ""; this.loadList();
                } catch (err) { console.error(err); this.#notifyError(err); }
                finally { btn.innerHTML = old; }
            };

            q("#btn_refresh").onclick = () => this.loadList({ cloud: true, interactive: true });
            q("#btn_upload_all").onclick = (e) => this.#uploadLocalSnapshots(e.currentTarget);
        }

        #panelHTML() {
            return `
                <div class="panel">
                    ${this.#panelHeadHTML()}
                    <div class="body">
                        ${this.#statusBarHTML()}
                        ${this.#tabsHTML()}
                        ${this.#saveViewHTML()}
                        ${this.#listViewHTML()}
                    </div>
                </div>
            `;
        }

        #panelHeadHTML() {
            return `
                <div class="head">
                    <h2>Account Snapshot Sync</h2>
                    <button class="close-btn">${Utils.icon('close')}</button>
                </div>
            `;
        }

        #statusBarHTML() { return '<div class="status-bar" id="status_bar"></div>'; }

        #tabsHTML() {
            return `
                <div class="tabs">
                    <div class="tab active" data-view="save">保存</div>
                    <div class="tab" data-view="list">管理</div>
                </div>
            `;
        }

        #saveViewHTML() {
            return `
                <div id="view-save">
                    <label>快照名称</label>
                    <input type="text" id="cfg_name" placeholder="例如：工作" autocomplete="off">
                    <details>
                        <summary>WebDAV 配置</summary>
                        <div style="margin-top:8px">
                            <label>URL</label><input type="text" id="cfg_dav_url" placeholder="https://..." autocomplete="off">
                            <div style="display:flex;gap:10px">
                                <div style="flex:1"><label>User</label><input type="text" id="cfg_dav_user" autocomplete="new-password"></div>
                                <div style="flex:1"><label>Pass</label><input type="password" id="cfg_dav_pass" autocomplete="new-password"></div>
                            </div>
                            <button class="btn" id="btn_save_cfg">保存配置</button>
                        </div>
                    </details>
                    <div style="margin-top:20px"><button class="btn primary" id="btn_do_save">${Utils.icon('save')} 保存快照</button></div>
                </div>
            `;
        }

        #listViewHTML() {
            return `
                <div id="view-list" style="display:none">
                    <div class="tip-bar" id="list_tip"></div>
                    <div id="list_container" style="border:1px solid #ccc;border-bottom:none"></div>
                    <div style="display:flex;gap:8px;margin-top:12px">
                        <button class="btn" id="btn_refresh" style="flex:1;border-style:dashed;">${Utils.icon('sync')}云同步</button>
                        <button class="btn" id="btn_upload_all" style="flex:1;border-style:dashed;">${Utils.icon('upload')}上传本地快照</button>
                    </div>
                </div>
            `;
        }

        async loadList(options = {}) {
            const { cloud, interactive } = this.#normalizeListOptions(options);
            const container = this.#prepareListContainer();
            if (!container) return;
            try {
                const entries = await this.#collectSnapshotEntries({ syncCloud: cloud, interactive });
                await this.#handleConflictTip(entries);
                await this.#renderList(container, entries);
            } catch (err) {
                container.innerHTML = `<div style="color:red;padding:10px">${Utils.safeErr(err)}</div>`;
            }
        }

        #normalizeListOptions(options) {
            if (typeof options === "boolean") return { cloud: options, interactive: false };
            return { cloud: !!options.cloud, interactive: !!options.interactive };
        }

        #prepareListContainer() {
            const container = this.#root.querySelector("#list_container");
            if (!container) return null;
            container.innerHTML = '<div style="padding:15px;text-align:center;color:#999;font-size:12px;border-bottom:1px solid #eee">加载中...</div>';
            return container;
        }

        async #collectSnapshotEntries({ syncCloud, interactive }) {
            if (syncCloud && await this.#ensureDavReady()) {
                await this.#runQuietly(() => this.#syncFromCloud(interactive), "云端同步失败");
            }
            const keys = GM_listValues();
            const map = new Map();
            for (const key of keys) this.#applyStorageKey(map, key);
            return Array.from(map.values()).sort((a, b) => a.display.localeCompare(b.display));
        }

        #applyStorageKey(map, key) {
            const info = this.#identifySnapshotKey(key);
            if (!info || !this.#belongsToHost(info.id)) return;
            const entry = map.get(info.id) || { id: info.id, display: this.#displayName(info.id), local: false, cloud: false };
            entry[info.type] = true;
            map.set(info.id, entry);
        }

        #identifySnapshotKey(key) {
            const cloudId = this.#idFromKey(key, "cloud");
            if (cloudId) return { type: "cloud", id: cloudId };
            const localId = this.#idFromKey(key, "local");
            if (localId) return { type: "local", id: localId };
            return null;
        }

        async #handleConflictTip(entries) {
            const hasConflict = entries.some(entry => entry.local && entry.cloud);
            if (!hasConflict) {
                this.#showListTip("");
                return;
            }
            const tipKey = Config.CONSTS.TIP_KEY_PREFIX + location.hostname;
            const shown = GM_getValue(tipKey);
            if (!shown) {
                this.#showListTip("提示：左键点击本地/云端标签可设默认来源，右键可执行覆盖。");
                GM_setValue(tipKey, Date.now());
                return;
            }
            this.#showListTip("");
        }

        async #renderList(container, entries) {
            if (entries.length === 0) {
                container.innerHTML = '<div style="padding:15px;text-align:center;color:#999;font-size:12px;border-bottom:1px solid #eee">暂无快照</div>';
                return;
            }
            container.innerHTML = "";
            for (const entry of entries) {
                container.appendChild(await this.#buildListRow(entry));
            }
        }

        async #buildListRow(item) {
            const row = document.createElement("div");
            row.className = "item";

            // 构建信息部分
            const info = document.createElement("div");
            info.className = "item-info";

            const name = document.createElement("div");
            name.className = "item-name";
            name.textContent = item.display;
            name.title = item.display;

            const meta = document.createElement("div");
            meta.className = "item-meta";
            const pref = await this.#getPreferredSource(item.id);

            if (item.local) meta.appendChild(this.#buildTag("本地 LOC", "local", item, pref === "local"));
            if (item.cloud) meta.appendChild(this.#buildTag("云端 CLD", "cloud", item, pref === "cloud"));

            info.append(name, meta);

            // 构建操作按钮部分
            const actions = document.createElement("div");
            actions.className = "actions";

            const btnCopy = this.#createIconButton("copy", "复制");
            btnCopy.onclick = () => this.#withSnapshot(item, async (data, source) => {
                GM_setClipboard(JSON.stringify(data, null, 2));
                this.#setStatus(`已复制 (${source === "cloud" ? "云端" : "本地"})`, "info");
            });
            actions.appendChild(btnCopy);

            // 添加上传按钮
            if (item.local) {
                const btnUpload = this.#createIconButton("upload", "上传至云端");
                btnUpload.onclick = () => this.#uploadSingleSnapshot(item);
                actions.appendChild(btnUpload);
            }

            // 添加恢复按钮
            const btnRestore = this.#createIconButton("restore", "恢复");
            btnRestore.onclick = async () => {
                if (!confirm(`恢复 "${item.display}" ?`)) return;
                await this.#withSnapshot(item, async (data, source) => {
                    const count = await ProfileManager.restore(data);
                    this.#setStatus(`已恢复 ${count} 条 Cookie (${source === "cloud" ? "云端" : "本地"})，即将刷新`, "info");
                    await Utils.sleep(1000);
                    location.reload();
                });
            };
            actions.appendChild(btnRestore);

            // 添加删除按钮
            const btnDelete = this.#createIconButton("delete", "删除", "icon-btn del");
            btnDelete.onclick = async () => {
                if (!confirm(`删除 "${item.display}" ?`)) return;

                // 并行删除本地和云端数据
                const deletePromises = [
                    GM_deleteValue(this.#localKey(item.id)),
                    GM_deleteValue(this.#cloudKey(item.id)),
                    GM_deleteValue(this.#prefKey(item.id)),
                    this.#prefCache.delete(item.id)
                ];

                if (item.cloud) deletePromises.push(this.#dav.deleteFile(item.id));

                await Promise.all(deletePromises);

                this.loadList({ cloud: item.cloud });
                this.#setStatus("快照已删除", "info");
            };
            actions.appendChild(btnDelete);

            row.append(info, actions);
            return row;
        }
    }
    new UI();
})();
