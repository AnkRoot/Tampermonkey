# QuantumDOM v2.1.1 开发文档

**QuantumDOM** 是专为 UserScript 设计的现代化 DOM 操控库。
**核心特性**：ES2022 语法、内存安全缓存、轮询优化架构、遵循 DRY/KISS 原则、支持 `ShadowDOM` / `Iframe` 穿透。

## 1. 引入与初始化

在 Tampermonkey 头部引入：
```js
// @require https://path/to/QuantumDOM.user.js
// @grant   none
```
全局单例：`window.QuantumDOM`

---

## 2. 选择器语法 (Selector Syntax)

支持标准 CSS 选择器与穿透语法的混合使用。

*   **普通节点**：`.class #id [attr]` (标准 CSS)
*   **穿透符**：`>>>` (分隔不同上下文)
*   **Shadow DOM**：关键字 `shadow-root`
*   **Iframe**：关键字 `iframe-content` (自动等待加载完成)

**示例**：
```js
// 1. 普通查找
const s1 = '#nav .item';

// 2. 穿透 Shadow DOM
const s2 = '#app >>> shadow-root >>> sidebar-component >>> shadow-root >>> button';

// 3. 穿透 Iframe
const s3 = '#iframe-container >>> iframe-content >>> .login-btn';
```

---

## 3. 核心 API

### 3.1 获取元素 `get()`
异步等待元素出现。支持缓存与超时控制。

**签名**：
```ts
get(selector: string | string[], options?: GetOptions): Promise<Element | Element[] | null>
```
**Options**: `{ parent?: Node, timeout?: number, returnNullOnTimeout?: boolean }`

**使用**：
```js
// 单个获取 (默认超时 10s)
try {
    const btn = await QuantumDOM.get('#app >>> shadow-root >>> #submit');
    btn.click();
} catch (err) {
    if (err instanceof QuantumDOM.TimeoutError) console.error('超时');
}

// 批量获取 (并行)
const [header, footer] = await QuantumDOM.get(['#header', '#footer']);

// 超时不抛错模式
const optionalEl = await QuantumDOM.get('.ad-banner', { 
    timeout: 2000, 
    returnNullOnTimeout: true 
});
```

---

### 3.2 持续监听 `each()`
观察当前及**未来**出现的匹配节点。

**签名**：
```ts
each(selector: string, callback: EachCallback, options?: BaseOptions): StopFunction
```
**Callback**: `(element: Element, isAsync: boolean) => void`
*   `isAsync`: `false` 为初始扫描发现，`true` 为后续 MutationObserver 捕获。

**使用**：
```js
const stop = QuantumDOM.each('.video-card', (card, isAsync) => {
    // 无论是页面刚加载还是滚动加载的新卡片，都会触发
    card.style.border = '2px solid red';
});

// 页面卸载或不需要时停止监听，释放 Observer
// stop();
```

---

### 3.3 事件委托 `on()`
在最近的有效上下文中绑定事件，支持 ShadowRoot 内的事件委托。

**签名**：
```ts
on(event: string, selector: string, callback: EventCallback, options?: OnOptions): Promise<StopFunction>
```
**Callback**: `(e: Event, target: Element) => void`

**使用**：
```js
// 即使 button 是后来动态插入 shadow-root 的也能响应
const stopOn = await QuantumDOM.on('click', '#host >>> shadow-root >>> .btn-close', (e, target) => {
    console.log('Clicked:', target);
    e.stopPropagation();
});
```

**重要提示**：`on()` 方法的事件委托会为每次匹配的事件触发回调，不会对重复事件进行去重处理。

---

## 4. 工具 API

### 4.1 创建元素 `create()`
```ts
create(html: string, options?: { parent?: Node, mapIds?: boolean }): Element | IdMap
```
**使用**：
```js
// 返回 Map: { 0: rootDiv, title: h1, btn: button }
const ui = QuantumDOM.create(`
  <div id="panel">
    <h1 id="title">Hello</h1>
    <button id="btn">OK</button>
  </div>
`, { mapIds: true, parent: document.body });

ui.btn.onclick = () => console.log('Hi');
```

### 4.2 注入样式 `css()`
幂等注入，防止重复添加。
```ts
css(cssText: string, id?: string): HTMLStyleElement
```
**使用**：
```js
QuantumDOM.css('.dark-mode { background: #000; }', 'my-script-style');
```

---

## 5. 配置与管理

### 全局配置 `configure()`
```js
QuantumDOM.configure({
    timeout: 10000,       // get() 默认超时 (ms)
    cache: true,          // 是否启用 WeakRef 缓存
    cacheTTL: 300_000,    // 缓存有效期 (ms)
    debug: false          // 打印调试日志
});
```

### 缓存管理
由于使用了 `WeakRef`，通常不需要手动管理，但提供强制清理接口。
```js
QuantumDOM.clearCache(); // 清空所有缓存记录
```

---

## 6. 错误处理

库抛出的所有错误均为 `QuantumError` 子类。

| 错误类名 | 描述 | 建议处理 |
| :--- | :--- | :--- |
| `QuantumDOM.TimeoutError` | `get()` 在规定时间内未找到元素 | 使用 `try/catch` 或 `returnNullOnTimeout` |
| `QuantumDOM.QuantumError` | 解析错误、非法参数等通用错误 | 检查选择器语法 |

```js
try {
    await QuantumDOM.get('');
} catch (e) {
    if (e instanceof QuantumDOM.QuantumError && e.code === 'PARSE') {
        console.error('选择器写错了');
    }
}
```