# Super Drag and Go / 超级拖曳

A small Manifest V3 Chrome extension for opening dragged links and images in adjacent tabs. No build step or runtime dependencies. Originally created by Wenzhang Zhu.

轻量的 Manifest V3 Chrome 扩展，拖拽链接和图片即可在相邻标签页打开。无需构建，无运行依赖。原作者：Wenzhang Zhu。

## Install / 安装

Chrome 99 or later: download and extract this repository, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`. After updating the files, reload the extension and refresh any existing web pages.

Chrome 99 及以上：下载并解压仓库，打开 `chrome://extensions`，开启**开发者模式**，点击**加载已解压的扩展程序**，选择包含 `manifest.json` 的目录。更新文件后重新加载扩展，并刷新已打开的网页。

## Use / 使用

Drag a link or image at least 16 CSS pixels and release it in an ordinary area of the same page or frame. Direction is measured from where the drag started.

拖拽链接或图片至少 16 CSS 像素，在同一网页或框架的普通区域松开。方向相对于拖拽起点判断。

| Direction / 方向 | Position / 位置 | Activation / 打开方式 |
| --- | --- | --- |
| ↖ | Immediately before the source tab / 来源标签紧邻左侧 | Foreground / 前台 |
| ↙ | Immediately before the source tab / 来源标签紧邻左侧 | Background / 后台 |
| ↗ | Immediately after the source tab / 来源标签紧邻右侧 | Foreground / 前台 |
| ↘ | Immediately after the source tab / 来源标签紧邻右侧 | Background / 后台 |

Linked images open the enclosing link. Other images open their displayed resource (`currentSrc`, falling back to `src`). Exactly horizontal drags open in the background; exactly vertical drags open to the right. Text searches, mouse gestures, modifier-key disabling, and settings are not included. Old settings are ignored. The name and description follow Chrome's locale: Simplified Chinese or English, with English as the fallback.

带链接的图片打开外层链接，独立图片打开当前显示的图片资源（优先 `currentSrc`，其次 `src`）。恰好水平的拖拽在后台打开，恰好垂直的拖拽在右侧打开。不提供文字搜索、鼠标手势、按键禁用和设置页，旧设置不会生效。名称和描述随 Chrome 语言使用简体中文或英文，其他语言回退英文。

## Limits and privacy / 限制与隐私

- Only HTTP, HTTPS, and file URLs are handled. For local pages, enable **Allow access to file URLs** in the extension's details. `javascript:`, `data:`, `blob:`, and browser-internal URLs are not handled.
- Chrome prevents extensions from running on internal pages, the Chrome Web Store, and other protected pages. Only matching frames are supported; dragging between frames is not supported.
- Editable fields, file uploads, external drags, and selected text keep their native behavior. No key is reserved to disable the extension; native browser or OS shortcuts still apply.
- New tabs are unpinned. Chrome's pinned-tab area can prevent immediate placement beside a pinned source tab.
- Static content scripts need access to matching pages. There are no additional API/host permissions, storage, telemetry, remote code, or URL logging. Opening a tab makes the usual navigation request to its destination.

- 仅处理 HTTP、HTTPS 和文件地址；本地页面需在扩展详情中开启**允许访问文件网址**。不处理 `javascript:`、`data:`、`blob:` 和浏览器内部地址。
- Chrome 内部页面、Chrome 应用商店及其他受保护页面无法运行扩展；仅支持匹配的框架，不支持跨框架拖拽。
- 编辑区、文件上传、外部拖入和选中文字保留原生行为。不设置禁用扩展的快捷键；浏览器和系统自身快捷键仍有效。
- 新标签不固定，Chrome 的固定标签区域可能限制紧邻固定来源标签的位置。
- 静态内容脚本仍需要访问匹配网页；无额外 API/主机权限、存储、遥测、远程代码或 URL 日志。打开标签会正常请求目标地址。

## Tests / 测试

Run the dependency-free unit checks with Node.js 22 or later:

使用 Node.js 22 及以上执行无第三方依赖的单元检查：

```sh
node --test tests/unit.test.cjs
```

For real browser drag tests, provide Playwright and a Chrome for Testing executable. The browser script uses a temporary profile and local fixtures; it does not use your regular Chrome profile. Playwright is only needed for testing.

实际浏览器拖拽测试需提供 Playwright 和 Chrome for Testing。测试使用临时配置及本地测试页面，不使用日常 Chrome 配置。Playwright 仅用于测试。

```sh
CHROME_PATH="/path/to/chrome-for-testing" \
PLAYWRIGHT_MODULE="/path/to/playwright" \
node tests/browser.cjs
```
