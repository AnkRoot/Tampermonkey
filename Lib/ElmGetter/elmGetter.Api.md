# elmGetter 2.0 简明指南

## 核心 API

- `get(selectors, options?)`: 异步获取一个或多个元素。
- `each(selector, callback, options?)`: 遍历并监听匹配的元素，返回一个停止函数。
- `on(eventName, selector, callback, options?)`: 为现在和未来的元素进行事件委托。
- `create(htmlString, options?)`: 从 HTML 字符串创建 DOM 元素。
- `css(cssText, id?)`: 向页面注入 CSS 样式，可通过 ID 防止重复。
- `config(options)`: 配置 `elmGetter` 实例 (例如选择器模式)。

## 快速使用

```js
// 异步获取单个元素，超时 5 秒
const element = await elmGetter.get('#myElement', { timeout: 5000 });
if (element) console.log(element);

// 异步获取多个元素
const [el1, el2] = await elmGetter.get(['#el1', '.class2']);

// 在指定父元素中查找
const parent = document.querySelector('.container');
const child = await elmGetter.get('.child', { parent });

// 遍历元素 (包括未来新增的)
const stopEach = elmGetter.each('p', (el, isNew) => {
  el.style.color = 'blue';
  if (isNew) console.log('新段落出现:', el);
  // 返回 false 可停止遍历
});
// 在需要时调用 stopEach() 来停止监听

// 事件委托：为所有现在和未来的 .btn 元素绑定点击事件
const stopClick = elmGetter.on('click', '.btn', (event, element) => {
  console.log(`${element.textContent} 被点击了!`);
  event.preventDefault();
});
// 在需要时调用 stopClick() 来移除监听器

// 创建元素
const div = elmGetter.create('<div>Hello</div>', { parent: document.body });

// 创建元素并返回 ID 映射表
const list = elmGetter.create('<div id="main"><p id="text"></p></div>', { mapIds: true });
// list 包含: list=div元素, list.main=div元素, list.text=p元素

// 注入 CSS
elmGetter.css('.important { color: red; }', 'my-styles');

// 设置选择器模式
elmGetter.config({ selectorMode: 'xpath' });
console.log(elmGetter.currentSelectorMode); // 'xpath'
elmGetter.config({ selectorMode: 'css' }); // 切换回来
```

## 参数说明

所有方法的 `options` 均为可选对象：

- `get`: `{ parent?: Node, timeout?: number }`
- `each`: `{ parent?: Node }`
- `on`: `{ parent?: Node }`
- `create`: `{ parent?: Element, mapIds?: boolean }`
- `config`: `{ selectorMode: 'css'|'xpath' }`