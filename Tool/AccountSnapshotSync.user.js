// ==UserScript==
// @name         !.Account Snapshot Sync
// @description  Save Snapshot默认写入本地，配置WebDAV后自动镜像；跨站Cookie/Storage快照一键恢复
// @version      1.0.1
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
        };
    }

    const Utils = {
        sanitize(str) { return (str || "未命名").trim().replace(/[\s\\/:"*?<>|]+/g, "_"); },
        safeErr(err) {
            if (typeof err === "string") return err;
            return err?.statusText || err?.msg || err?.message || `错误 ${err?.status}`;
        },
        sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
        icon(name) {
            const icons = {
                close: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
                save: '<path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>',
                copy: '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>',
                restore: '<path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>',
                delete: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
                upload: '<path d="M5 20h14v-2H5v2zm7-16-5.5 5.5h4V18h3V9.5h4L12 4z"/>'
            };
            return `<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;display:block;">${icons[name] || ''}</svg>`;
        }
    };

    class Storage {
        static async get(k, d = null) { return await GM_getValue(k, d); }
        static async set(k, v) { return await GM_setValue(k, v); }
        static async del(k) { return await GM_deleteValue(k); }
        static async list() { return await GM_listValues(); }
    }

    class WebDavClient {
        #authCache = null;
        #dirChecked = false;
        #dirCache = new Map();

        async #getAuth() {
            if (this.#authCache) return this.#authCache;
            const [url, user, pass] = await Promise.all([
                Storage.get(Config.KEYS.DAV_URL),
                Storage.get(Config.KEYS.DAV_USER),
                Storage.get(Config.KEYS.DAV_PASS)
            ]);
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

        async #probeDir(path) {
            const dirPath = this.#normalizeDir(path);
            try {
                await this.request("PROPFIND", dirPath, null, { Depth: "0" });
                return true;
            } catch (err) {
                if (err.status === 404) return false;
                if (err.status && [301, 302].includes(err.status)) return true;
                if (err.status && [400, 405, 501].includes(err.status)) {
                    try {
                        await this.request("HEAD", dirPath);
                        return true;
                    } catch (headErr) {
                        if (headErr.status === 404) return false;
                        if (headErr.status === 400 || err.status === 400) return false;
                        throw headErr;
                    }
                }
                if (err.status === 400) return false;
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
            this.#updateManifest(fileName, 'add');
        }

        async deleteFile(fileName) {
            try {
                await this.request("DELETE", `${Config.CONSTS.BASE_PATH}${fileName}`);
            } catch (e) {
                if (e.status !== 404) throw e;
            }
            this.#updateManifest(fileName, 'remove');
        }

        async #updateManifest(fileName, action) {
            try {
                let list = [];
                try {
                    const r = await this.request("GET", `${Config.CONSTS.BASE_PATH}${Config.CONSTS.MANIFEST_FILE}`);
                    list = JSON.parse(r.responseText);
                } catch (e) {}

                let changed = false;
                if (action === 'add' && !list.includes(fileName)) {
                    list.push(fileName);
                    changed = true;
                } else if (action === 'remove' && list.includes(fileName)) {
                    list = list.filter(f => f !== fileName);
                    changed = true;
                }

                if (changed) {
                    await this.request("PUT", `${Config.CONSTS.BASE_PATH}${Config.CONSTS.MANIFEST_FILE}`, JSON.stringify(list), { "Content-Type": "application/json" });
                }
            } catch (e) {
                console.warn("Manifest update warning:", e);
            }
        }
    }

    class ProfileManager {
        static async collect(name) {
            const cookies = await new Promise(r => GM_cookie.list({ url: location.href }, (c) => r(c || [])));
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
            const currentCookies = await new Promise(r => GM_cookie.list({ url: location.href }, c => r(c||[])));
            for (const c of currentCookies) await new Promise(r => GM_cookie.delete({ url: location.href, name: c.name }, r));

            // Restore Storage
            if (snapshot.data.local) Object.entries(snapshot.data.local).forEach(([k, v]) => localStorage.setItem(k, v));
            if (snapshot.data.session) Object.entries(snapshot.data.session).forEach(([k, v]) => sessionStorage.setItem(k, v));

            // Restore Cookies
            let count = 0;
            for (const c of snapshot.data.cookies) {
                try {
                    await new Promise((resolve, reject) => {
                        GM_cookie.set({
                            url: location.href, name: c.name, value: c.value, domain: c.domain, path: c.path,
                            secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate
                        }, err => err ? reject(err) : resolve());
                    });
                    count++;
                } catch (e) {}
            }
            return count;
        }
    }

    class UI {
        #host;
        #root;
        #dav = new WebDavClient();
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
                
                .toast {
                    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px);
                    background: #222; color: #fff; padding: 10px 24px;
                    font-family: var(--font); font-size: 13px; font-weight: 500;
                    opacity: 0; pointer-events: none; transition: all 0.2s; z-index: 99999;
                }
                .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

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

        notify(msg) {
            let t = this.#root.querySelector(".toast");
            if (!t) { t = document.createElement("div"); t.className = "toast"; this.#root.appendChild(t); }
            t.textContent = msg; t.classList.add("show");
            if (t.dataset.timer) clearTimeout(parseInt(t.dataset.timer));
            t.dataset.timer = setTimeout(() => t.classList.remove("show"), 3000);
        }

        #localKey(id) { return Config.CONSTS.PREFIX + id; }
        #cloudKey(id) { return Config.CONSTS.CLOUD_PREFIX + id; }
        #prefKey(id) { return Config.CONSTS.PREF_PREFIX + id; }
        #belongsToHost(id) { return id.startsWith(`${location.hostname}_`); }

        async #getPreferredSource(id) {
            if (this.#prefCache.has(id)) return this.#prefCache.get(id);
            const key = this.#prefKey(id);
            const saved = await Storage.get(key);
            if (saved === "local" || saved === "cloud") {
                this.#prefCache.set(id, saved);
                return saved;
            }
            return null;
        }

        async #setPreferredSource(id, source) {
            const normalized = source === "cloud" ? "cloud" : "local";
            await Storage.set(this.#prefKey(id), normalized);
            this.#prefCache.set(id, normalized);
        }

        async #ensureDavReady() {
            const url = await Storage.get(Config.KEYS.DAV_URL);
            if (url) return true;
            this.notify("请先配置 WebDAV");
            return false;
        }

        async #syncFromCloud(interactive = false) {
            const files = await this.#dav.listFiles();
            const host = location.hostname;
            let pulled = 0;
            const seen = new Set();

            for (const file of files) {
                if (!file.startsWith(host)) continue;
                try {
                    const remote = await this.#fetchRemoteSnapshot(file);
                    await Storage.set(this.#cloudKey(file), remote);
                    seen.add(file);
                    pulled++;
                } catch (err) {
                    console.warn("Cloud fetch failed:", file, err);
                }
            }

            const keys = await Storage.list();
            for (const key of keys) {
                if (!key.startsWith(Config.CONSTS.CLOUD_PREFIX)) continue;
                const id = key.slice(Config.CONSTS.CLOUD_PREFIX.length);
                if (!this.#belongsToHost(id)) continue;
                if (!seen.has(id)) await Storage.del(key);
            }

            if (interactive) this.notify(`云端同步完成，共拉取 ${pulled} 份快照`);
            return files;
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
            if (pref && item[pref]) return pref;
            if (item.local && !item.cloud) return "local";
            if (item.cloud && !item.local) return "cloud";
            if (item.local && item.cloud) {
                this.notify("提示：左键标签可设为默认来源");
                const useCloud = window.confirm(`"${item.display}" 同时存在于本地与云端。\n确定=临时使用云端，取消=使用本地`);
                return useCloud ? "cloud" : "local";
            }
            throw new Error("未找到可用快照");
        }

        async #readSnapshot(id, source = "auto") {
            const localKey = this.#localKey(id);
            const cloudKey = this.#cloudKey(id);
            if (source === "local") {
                const local = await Storage.get(localKey);
                if (local) return local;
                throw new Error("本地快照缺失");
            }
            if (source === "cloud") {
                let remote = await Storage.get(cloudKey);
                if (remote) return remote;
                if (!(await this.#ensureDavReady())) throw new Error("未配置 WebDAV");
                remote = await this.#fetchRemoteSnapshot(id);
                if (remote) await Storage.set(cloudKey, remote);
                return remote;
            }
            const pref = await this.#getPreferredSource(id);
            if (pref) return await this.#readSnapshot(id, pref);
            const stored = await Storage.get(localKey);
            if (stored) return stored;
            return await this.#readSnapshot(id, "cloud");
        }

        async #uploadLocalSnapshots(btn) {
            if (!(await this.#ensureDavReady())) return;
            const prefix = Config.CONSTS.PREFIX;
            const keys = [];
            for (const key of await Storage.list()) {
                if (!key.startsWith(prefix)) continue;
                const id = key.slice(prefix.length);
                if (this.#belongsToHost(id)) keys.push(key);
            }
            if (keys.length === 0) { this.notify("暂无本地快照"); return; }
            const button = btn;
            const original = button.innerHTML;
            button.textContent = "上传中...";
            let ok = 0;
            for (const key of keys) {
                const data = await Storage.get(key);
                if (!data) continue;
                const fileName = key.replace(prefix, "");
                try {
                    await this.#dav.saveFile(fileName, data);
                    await Storage.set(this.#cloudKey(fileName), data);
                    ok++;
                } catch (err) {
                    console.error("Upload failed", fileName, err);
                }
            }
            button.innerHTML = original;
            this.notify(`上传完成：${ok}/${keys.length}`);
            this.loadList({ cloud: true });
        }

        #buildTag(label, source, item, active) {
            const tag = document.createElement("span");
            tag.className = `tag${source === "cloud" ? " cloud" : ""}${active ? " active" : ""}`;
            tag.textContent = label;
            tag.title = "左键设为默认，右键执行覆盖";
            tag.onclick = async (e) => {
                e.preventDefault();
                await this.#setPreferredSource(item.id, source);
                this.notify(`默认来源已切换为 ${label}`);
                this.loadList();
            };
            tag.oncontextmenu = async (e) => {
                e.preventDefault();
                await this.#handleTagAction(item, source);
            };
            return tag;
        }

        async #handleTagAction(item, source) {
            try {
                if (source === "local") {
                    if (!(await this.#ensureDavReady())) return;
                    const data = await this.#readSnapshot(item.id, "local");
                    if (!data) return this.notify("本地快照缺失");
                    if (!confirm(`使用本地快照 "${item.display}" 覆盖云端版本?`)) return;
                    await this.#dav.saveFile(item.id, data);
                    await Storage.set(this.#cloudKey(item.id), data);
                    this.notify("云端已更新为本地版本");
                    this.loadList({ cloud: true });
                    return;
                }
                const remote = await this.#readSnapshot(item.id, "cloud");
                if (!remote) return this.notify("云端快照缺失");
                if (!confirm(`使用云端快照 "${item.display}" 覆盖本地版本?`)) return;
                await Storage.set(this.#localKey(item.id), remote);
                this.notify("本地已更新为云端版本");
                this.loadList();
            } catch (err) {
                this.notify("错误: " + Utils.safeErr(err));
            }
        }

        #render() {
            const div = document.createElement("div");
            div.className = "overlay";
            div.innerHTML = `
                <div class="panel">
                    <div class="head">
                        <h2>Account Snapshot Sync</h2>
                        <button class="close-btn">${Utils.icon('close')}</button>
                    </div>
                    <div class="body">
                        <div class="tabs">
                            <div class="tab active" data-view="save">保存</div>
                            <div class="tab" data-view="list">管理</div>
                        </div>
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
                        <div id="view-list" style="display:none">
                            <div id="list_container" style="border:1px solid #ccc;border-bottom:none"></div>
                            <div style="display:flex;gap:8px;margin-top:12px">
                                <button class="btn" id="btn_refresh" style="flex:1;border-style:dashed;">Sync Cloud 云同步</button>
                                <button class="btn" id="btn_upload_all" style="flex:1;border-style:dashed;">${Utils.icon('upload')}上传本地</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            this.#root.appendChild(div);

            const q = (s) => div.querySelector(s);
            q(".close-btn").onclick = () => this.close();
            div.onclick = (e) => { if (e.target === div) this.close(); };
            
            const tabs = div.querySelectorAll(".tab");
            tabs.forEach(t => t.onclick = () => {
                tabs.forEach(x => x.classList.remove("active")); t.classList.add("active");
                q("#view-save").style.display = t.dataset.view === "save" ? "block" : "none";
                q("#view-list").style.display = t.dataset.view === "list" ? "block" : "none";
            });

            Promise.all([Storage.get(Config.KEYS.DAV_URL), Storage.get(Config.KEYS.DAV_USER), Storage.get(Config.KEYS.DAV_PASS)])
                .then(([u, n, p]) => { if(u) q("#cfg_dav_url").value=u; if(n) q("#cfg_dav_user").value=n; if(p) q("#cfg_dav_pass").value=p; });

            q("#btn_save_cfg").onclick = async () => {
                await Storage.set(Config.KEYS.DAV_URL, q("#cfg_dav_url").value.trim());
                await Storage.set(Config.KEYS.DAV_USER, q("#cfg_dav_user").value.trim());
                await Storage.set(Config.KEYS.DAV_PASS, q("#cfg_dav_pass").value.trim());
                this.notify("配置已保存");
            };

            q("#btn_do_save").onclick = async (e) => {
                const name = q("#cfg_name").value.trim();
                if (!name) return this.notify("请输入快照名称");
                const btn = e.currentTarget; const old = btn.innerHTML; btn.textContent = "处理中...";
                try {
                    const clean = Utils.sanitize(name);
                    const snap = await ProfileManager.collect(clean);
                    const fn = `${location.hostname}_${clean}.json`;
                    await Storage.set(Config.CONSTS.PREFIX + fn, snap);
                    
                    if (q("#cfg_dav_url").value.trim()) {
                        await this.#dav.saveFile(fn, snap);
                        await Storage.set(this.#cloudKey(fn), snap);
                        this.notify("已同步本地 + 云端");
                    } else {
                        this.notify("已保存本地");
                    }
                    q("#cfg_name").value = ""; this.loadList();
                } catch (err) { console.error(err); this.notify(Utils.safeErr(err)); } 
                finally { btn.innerHTML = old; }
            };

            q("#btn_refresh").onclick = () => this.loadList({ cloud: true, interactive: true });
            q("#btn_upload_all").onclick = (e) => this.#uploadLocalSnapshots(e.currentTarget);
        }

        async loadList(options = {}) {
            const opts = typeof options === "boolean" ? { cloud: options } : options;
            const cloud = !!opts.cloud;
            const interactive = !!opts.interactive;
            const c = this.#root.querySelector("#list_container");
            if (!c) return;
            c.innerHTML = '<div style="padding:15px;text-align:center;color:#999;font-size:12px;border-bottom:1px solid #eee">加载中...</div>';
            
            const host = location.hostname;
            const prefix = Config.CONSTS.PREFIX;
            const cloudPrefix = Config.CONSTS.CLOUD_PREFIX;
            const map = new Map();

            try {
                if (cloud && await this.#ensureDavReady()) {
                    try {
                        await this.#syncFromCloud(interactive);
                    } catch (err) {
                        this.notify("云端同步失败: " + Utils.safeErr(err));
                    }
                }

                const keys = await Storage.list();
                for (const key of keys) {
                    if (key.startsWith(prefix)) {
                        const id = key.slice(prefix.length);
                        if (!this.#belongsToHost(id)) continue;
                        const entry = map.get(id) || { id, display: id.replace(`${host}_`, "").replace(".json", ""), local: false, cloud: false };
                        entry.local = true;
                        map.set(id, entry);
                        continue;
                    }
                    if (key.startsWith(cloudPrefix)) {
                        const id = key.slice(cloudPrefix.length);
                        if (!this.#belongsToHost(id)) continue;
                        const entry = map.get(id) || { id, display: id.replace(`${host}_`, "").replace(".json", ""), local: false, cloud: false };
                        entry.cloud = true;
                        map.set(id, entry);
                    }
                }

                c.innerHTML = "";
                if (map.size === 0) c.innerHTML = '<div style="padding:15px;text-align:center;color:#999;font-size:12px;border-bottom:1px solid #eee">暂无快照</div>';

                for (const i of Array.from(map.values()).sort((a, b) => a.display.localeCompare(b.display))) {
                    const row = document.createElement("div"); row.className = "item";
                    const info = document.createElement("div"); info.className = "item-info";
                    const name = document.createElement("div"); name.className = "item-name"; name.title = i.display; name.textContent = i.display;
                    const meta = document.createElement("div"); meta.className = "item-meta";
                    const pref = await this.#getPreferredSource(i.id);
                    if (i.local) meta.appendChild(this.#buildTag("本地 LOC", "local", i, pref === "local"));
                    if (i.cloud) meta.appendChild(this.#buildTag("云端 CLD", "cloud", i, pref === "cloud"));
                    info.appendChild(name); info.appendChild(meta);
                    const actions = document.createElement("div"); actions.className = "actions";
                    actions.innerHTML = `
                        <button class="icon-btn" data-act="copy" title="复制">${Utils.icon('copy')}</button>
                        <button class="icon-btn" data-act="restore" title="恢复">${Utils.icon('restore')}</button>
                        <button class="icon-btn del" data-act="del" title="删除">${Utils.icon('delete')}</button>`;
                    row.appendChild(info); row.appendChild(actions);
                    c.appendChild(row);

                    actions.querySelector('[data-act="copy"]').onclick = async () => {
                        try {
                            const source = await this.#chooseSource(i);
                            const d = await this.#readSnapshot(i.id, source);
                            GM_setClipboard(JSON.stringify(d, null, 2));
                            this.notify(`已复制 (${source === "cloud" ? "云端" : "本地"})`);
                        } catch (e) { this.notify("错误: " + Utils.safeErr(e)); }
                    };
                    actions.querySelector('[data-act="restore"]').onclick = async () => {
                        if(!confirm(`恢复 "${i.display}" ?`)) return;
                        try {
                            const source = await this.#chooseSource(i);
                            const d = await this.#readSnapshot(i.id, source);
                            const count = await ProfileManager.restore(d);
                            this.notify(`已恢复 ${count} 条 Cookie (${source === "cloud" ? "云端" : "本地"})，即将刷新`);
                            await Utils.sleep(1000); location.reload();
                        } catch(e) { this.notify("错误: " + Utils.safeErr(e)); }
                    };
                    actions.querySelector('[data-act="del"]').onclick = async () => {
                        if(!confirm(`删除 "${i.display}" ?`)) return;
                        await Storage.del(this.#localKey(i.id));
                        await Storage.del(this.#cloudKey(i.id));
                        await Storage.del(this.#prefKey(i.id));
                        this.#prefCache.delete(i.id);
                        if(i.cloud) await this.#dav.deleteFile(i.id);
                        this.loadList({ cloud: i.cloud }); this.notify("已删除");
                    };
                }
            } catch(e) { c.innerHTML=`<div style="color:red;padding:10px">${Utils.safeErr(e)}</div>`; }
        }
    }
    new UI();
})();
