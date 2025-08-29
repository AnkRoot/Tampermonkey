# QuantumDOM 简明指南

一个能无缝穿透 Shadow DOM 和 Iframe 的终极 DOM 实用工具库。

## 核心特性: `>>>` 穿透语法

- `shadow-root`: 进入 Shadow DOM。
- `iframe-content`: 等待并进入 `<iframe>` 的文档。

## 核心 API

- **`get(selectors, options?)`**: 异步获取元素，支持 `>>>` 穿透和缓存。

  - `selectors`: `string | string[]` - 单个或多个选择器。
  - `options`: `{ parent?: Node, timeout?: number }` - 起始节点和超时。
  - **返回**: `Promise<Element | Element[] | null>`

- **`each(selector, callback, options?)`**: 持续处理元素，支持 `>>>`。

  - `callback`: `(element) => boolean | void` - 返回 `false` 可停止。
  - `options`: `{ parent?: Node }`
  - **返回**: `function` - 停止函数。

- **`on(eventName, selector, callback, options?)`**: 事件委托，支持 `>>>`。

  - `callback`: `(event, element) => void`
  - `options`: `{ parent?: Node }`
  - **返回**: `Promise<function>` - Promise 解析后为停止函数。

- **`create(html, options?)`**: 从 HTML 字符串创建元素。

  - `options`: `{ parent?: Element, mapIds?: boolean }`
  - **返回**: `Element | { [id: string]: Element } | null`

- **`css(cssText, id?)`**: 注入样式，可通过 ID 防止重复。

  - **返回**: `HTMLStyleElement`

- **`configure(options)`**: 配置全局行为。

  - `options`: `{ timeout?, cacheEnabled?, cacheTTL?, debug? }`

- **`clearCache()`**: 清除 `get()` 的查询缓存。

## 快速使用

### 获取元素 (get)

```js
// 1. 获取主文档元素
const el = await QuantumDOM.get("#myElement");

// 2. 穿透 Shadow DOM 获取元素
const shadowEl = await QuantumDOM.get("#host >>> shadow-root >>> .button");

// 3. 穿透 Iframe 获取元素
const iframeEl = await QuantumDOM.get(
  "#editor-iframe >>> iframe-content >>> #save-btn"
);

// 4. 批量获取，支持混合穿透
const [header, deepItem] = await QuantumDOM.get([
  "#header",
  "#host >>> shadow-root >>> .item",
]);
```

### 监听元素 (each)

```js
// 持续高亮 Shadow DOM 中动态添加的卡片
const stopEach = QuantumDOM.each("#host >>> shadow-root >>> .card", (card) => {
  card.style.border = "1px solid blue";
});

// 在不再需要时停止监听
// stopEach();
```

### 事件委托 (on)

```js
// 为 Iframe 中未来出现的所有按钮绑定点击事件
const stopListener = await QuantumDOM.on(
  "click",
  "#my-iframe >>> iframe-content >>> .action-btn",
  (event, btn) => {
    console.log(`Iframe 中的按钮 "${btn.textContent}" 被点击`);
  }
);

// 在不再需要时移除监听
// stopListener();
```

### DOM 工具

```js
// 创建含 ID 映射的元素
const ui = QuantumDOM.create(
  '<div id="app"><button id="save"></button></div>',
  { mapIds: true }
);
ui.save.textContent = "保存";

// 注入样式
QuantumDOM.css(".highlight { color: red; }", "my-unique-style");
```

### 配置与缓存

```js
// 配置全局超时和 1 分钟缓存
QuantumDOM.configure({ timeout: 15000, cacheTTL: 60000, cacheEnabled: true });

// 第一次调用会查询 DOM 并缓存结果
const element1 = await QuantumDOM.get("#main-content");
// 第二次调用会直接从缓存返回
const element2 = await QuantumDOM.get("#main-content");

// 手动清除缓存
QuantumDOM.clearCache();
```

## 错误类型

- `QuantumDOM.TimeoutError`: 查找超时。
- `QuantumDOM.ParseError`: 选择器语法错误。
- `QuantumDOM.TraversalError`: 穿透边界时出错 (如 Iframe 未加载)。
