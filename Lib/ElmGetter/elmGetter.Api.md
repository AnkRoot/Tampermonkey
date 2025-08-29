# elmGetter 简明指南

一个为用户脚本设计的高性能异步 DOM 操作库。

## 核心 API

- **`get(selectors, options?)`**: 异步获取元素。

  - `selectors`: `string | string[]` - 单个或多个选择器。
  - `options`: `{ parent?: Node, timeout?: number }` - 起始节点和超时。
  - **返回**: `Promise<Element | Element[] | null>`

- **`each(selector, callback, options?)`**: 持续处理现在和未来的元素。

  - `callback`: `(element, isNew) => boolean | void` - 返回 `false` 可停止。
  - `options`: `{ parent?: Node }`
  - **返回**: `function` - 停止函数。

- **`on(eventName, selector, callback, options?)`**: 高效的事件委托。

  - `callback`: `(event, element) => void`
  - `options`: `{ parent?: Node }`
  - **返回**: `function` - 停止函数。

- **`create(html, options?)`**: 从 HTML 字符串创建元素。

  - `options`: `{ parent?: Element, mapIds?: boolean }`
  - **返回**: `Element | { [id: string]: Element } | null`

- **`css(cssText, id?)`**: 注入样式，可通过 ID 防止重复。

  - **返回**: `HTMLStyleElement`

- **`config(options)`**: 配置全局行为。
  - `options`: `{ selectorMode: 'css' | 'xpath' }`

## 快速使用

### 获取元素 (get)

```js
// 1. 获取单个元素，最多等待 5 秒
const el = await elmGetter.get("#myElement", { timeout: 5000 });

// 2. 批量获取多个元素
const [header, footer] = await elmGetter.get(["#header", "#footer"]);

// 3. 在指定容器内查找
const container = await elmGetter.get(".container");
if (container) {
  const item = await elmGetter.get(".item", { parent: container });
}
```

### 监听元素 (each)

```js
// 持续高亮所有现在和未来的 '.item' 元素
const stopEach = elmGetter.each(".item", (el, isNew) => {
  if (isNew) {
    el.style.backgroundColor = "yellow";
    console.log("新元素出现:", el);
  }
});

// 在需要时调用 stopEach() 来停止监听
// stopEach();
```

### 事件委托 (on)

```js
// 为所有现在和未来的 '.btn' 元素绑定点击事件
const stopClick = elmGetter.on("click", ".btn", (event, element) => {
  console.log(`按钮 "${element.textContent}" 被点击了!`);
  event.preventDefault();
});

// 在需要时调用 stopClick() 来移除监听器
// stopClick();
```

### 创建元素 (create)

```js
// 1. 仅创建元素
const div = elmGetter.create("<div>Hello</div>");

// 2. 创建并直接附加到父元素
elmGetter.create("<p>新段落</p>", { parent: document.body });

// 3. 创建并返回 ID 映射表，方便内部元素操作
const ui = elmGetter.create('<div id="main"><p id="text"></p></div>', {
  mapIds: true,
});
// ui.main 是 <div>, ui.text 是 <p>
ui.text.textContent = "修改后的文本";
```

### 工具与配置

```js
// 注入 CSS, 'my-styles' ID 防止重复
elmGetter.css(".important { color: red; }", "my-styles");

// 切换到 XPath 模式进行查询
elmGetter.config({ selectorMode: "xpath" });
const title = await elmGetter.get("//div[@id='title']");
elmGetter.config({ selectorMode: "css" }); // 切换回来
```
