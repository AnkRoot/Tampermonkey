## **elmGetter API 文档**

**版本:** 1.0.0
**作者:** ank

`elmGetter` 是一个轻量级、高性能的异步 DOM 元素获取和操作库，专为 Tampermonkey 脚本设计。它提供了简洁的 API 来处理动态加载的元素、监听 DOM 变化以及创建 DOM 元素。

### **核心理念：简单、高效、可靠**

`elmGetter` 的设计目标是提供最简单易用的 API 来处理常见的 DOM 操作任务，特别是在动态网页环境中。它专注于三个核心功能：

- **元素获取 (`get`)**: 异步等待并获取元素，支持超时设置
- **元素监听 (`each`)**: 持续监听 DOM 变化，处理已存在和新添加的元素
- **元素创建 (`create`)**: 从 HTML 字符串创建 DOM 元素

---

### **核心方法**

#### `async elmGetter.get(selector, [parent], [timeout])`

异步获取匹配选择器的第一个元素。如果元素不存在，会等待元素出现或超时。

- **`selector`**: `string | string[]` - CSS 选择器字符串或选择器数组
- **`parent`**: `Element` (可选) - 查询的父元素，默认为 `document`
- **`timeout`**: `number` (可选) - 超时时间（毫秒），0 表示无限等待

**返回**: `Promise<Element | Element[] | null>` - 如果传入单个选择器，返回单个元素或 null；如果传入选择器数组，返回元素数组

**示例:**

```javascript
// 获取单个元素
const element = await elmGetter.get('#my-element');
if (element) {
  console.log('找到元素:', element);
}

// 获取多个元素
const elements = await elmGetter.get(['#el1', '.class2', '#el3']);
const [el1, el2, el3] = elements;

// 在指定父元素中查找
const parent = document.querySelector('.container');
const child = await elmGetter.get('.child', parent);

// 设置超时
const element = await elmGetter.get('.dynamic-element', document, 5000);
if (!element) {
  console.log('5秒内未找到元素');
}
```

#### `elmGetter.each(selector, [parent], callback)`

遍历并监听匹配选择器的元素。会处理所有已存在的元素，并持续监听新添加的元素。

- **`selector`**: `string` - CSS 选择器
- **`parent`**: `Element` (可选) - 监听的父元素，默认为 `document`
- **`callback`**: `function(element, isNew)` - 回调函数
  - `element` (`Element`): 当前处理的元素
  - `isNew` (`boolean`): 如果元素是新添加的则为 `true`，否则为 `false`
  - 如果回调函数返回 `false`，将停止处理和监听

**返回**: `function()` - 一个用于停止监听的函数

**示例:**

```javascript
// 处理所有已存在和新增的元素
const stopListening = elmGetter.each('.item', (item, isNew) => {
  console.log(`处理元素: ${item.textContent}, 是否新增: ${isNew}`);
  item.style.color = 'blue';
  
  // 返回 false 可以停止监听
  // return false;
});

// 在需要时停止监听
// stopListening();

// 在指定容器内监听
const container = document.querySelector('.container');
elmGetter.each('.card', container, (card, isNew) => {
  if (isNew) {
    card.classList.add('new-card');
  }
});
```

#### `elmGetter.create(domString, [returnList], [parent])`

从 HTML 字符串创建 DOM 元素。

- **`domString`**: `string` - HTML 字符串
- **`returnList`**: `boolean` (可选) - 是否返回包含 ID 映射的对象，默认为 `false`
- **`parent`**: `Element` (可选) - 如果提供，创建的元素会自动附加到此父元素下

**返回**: `Element | object | null` - 默认返回创建的根元素。如果 `returnList` 为 `true`，返回包含 ID 映射的对象

**示例:**

```javascript
// 创建单个元素
const div = elmGetter.create('<div class="box">Hello World</div>');
document.body.appendChild(div);

// 创建元素并附加到父元素
const container = document.querySelector('.container');
elmGetter.create('<p>新段落</p>', container);

// 创建元素并返回 ID 映射
const structure = elmGetter.create(`
  <div id="modal">
    <h2 id="modal-title">标题</h2>
    <p id="modal-content">内容</p>
    <button id="modal-close">关闭</button>
  </div>
`, true);

// 现在可以通过 ID 访问元素
structure.modalTitle.textContent = '新标题';
structure.modalClose.addEventListener('click', () => {
  structure.modal.remove();
});
```

---

### **工具方法**

#### `elmGetter.selector(mode)`

设置或获取当前的选择器模式。

- **`mode`**: `string` (可选) - 选择器模式：'css' 或 'xpath'

**返回**: `string` - 当前选择器模式

**示例:**

```javascript
// 设置为 CSS 模式（默认）
elmGetter.selector('css');

// 设置为 XPath 模式
elmGetter.selector('xpath');

// 获取当前模式
const currentMode = elmGetter.selector;
console.log(currentMode); // 'css' 或 'xpath'
```

#### `elmGetter.currentSelector`

获取当前的选择器模式（只读属性）。

**示例:**

```javascript
console.log(elmGetter.currentSelector); // 'css' 或 'xpath'
```

---

### **高级用法**

#### **批量获取元素**

`get` 方法支持传入选择器数组，可以同时获取多个元素：

```javascript
const selectors = ['#header', '.content', '#footer'];
const elements = await elmGetter.get(selectors);
const [header, content, footer] = elements;

// 检查是否所有元素都找到了
if (elements.every(el => el !== null)) {
  console.log('所有元素都已找到');
}
```

#### **使用 XPath 选择器**

通过设置选择器模式为 XPath，可以使用更复杂的选择器：

```javascript
// 切换到 XPath 模式
elmGetter.selector('xpath');

// 使用 XPath 选择器
const element = await elmGetter.get('//div[@class="item"]//a[contains(text(), "更多")]');

// 切换回 CSS 模式
elmGetter.selector('css');
```

#### **动态内容处理**

结合 `get` 和 `each` 方法，可以处理各种动态内容场景：

```javascript
// 等待某个容器加载完成
const container = await elmGetter.get('.dynamic-container');

// 在容器内监听特定元素
elmGetter.each('.item', container, (item, isNew) => {
  if (isNew) {
    console.log('新项目已添加:', item.textContent);
    // 处理新项目
  }
});
```

---

### **错误处理**

`elmGetter` 会在控制台输出错误信息，但不会抛出异常。对于无效的选择器或查询错误，会在控制台输出错误日志并返回 `null` 或空数组。

**示例:**

```javascript
// 无效的选择器
const element = await elmGetter.get('invalid[selector');
// 控制台会输出错误信息，element 为 null

// 超时处理
const element = await elmGetter.get('.slow-element', document, 3000);
if (!element) {
  console.log('元素加载超时');
}
```

---

### **性能考虑**

1. **观察者管理**: `elmGetter` 内部使用 `MutationObserver` 来监听 DOM 变化，会自动管理观察者的生命周期，避免内存泄漏。

2. **批量操作**: 当需要获取多个元素时，使用数组形式的选择器比多次调用 `get` 更高效。

3. **及时停止**: 使用 `each` 方法时，如果不再需要监听，记得调用返回的停止函数以释放资源。

4. **合理设置超时**: 对于可能不存在的元素，设置合理的超时时间，避免无限等待。

---

### **兼容性**

- 支持 Chrome、Firefox、Edge 等现代浏览器
- 专为 Tampermonkey 用户脚本设计
- 支持 CSS 和 XPath 选择器
- 在 Shadow DOM 和 iframe 中也能正常工作（需要正确设置父元素）