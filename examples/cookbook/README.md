# uWebKoa Cookbook

照着抄就能用的配方。每个文件都是**可直接运行**的完整示例：

```bash
node examples/cookbook/01-minimal-graceful-shutdown.js
```

> 需要 Node.js 22 或 24（uWebSockets.js 原生二进制要求）。多数配方默认监听 3000 端口，请一次只跑一个。

| # | 文件 | 内容 |
|---|------|------|
| 01 | `01-minimal-graceful-shutdown.js` | 最小启动 + `us_listen_socket_close` 优雅关停 |
| 02 | `02-shared-auth-http-ws.js` | 一份鉴权中间件同时守护 HTTP 与 WebSocket（共享 `ctx.state`） |
| 03 | `03-body-and-file-download.js` | 读取请求体（自动 `parseBody`）+ `ctx.sendFile` 下载 |
| 04 | `04-static-and-spa.js` | 静态资源 + 单页应用回退到 `index.html` |
| 05 | `05-middleware-stack.js` | CORS + 日志 + 限流 + 统一错误处理 + 404 的完整栈 |
| 06 | `06-ws-chatroom.js` | WebSocket 房间 pub/sub 广播 + HTTP 触发推送（互通） |
| 07 | `07-cookies.js` | Cookie 读写（当前需手动处理，框架尚未内置 `ctx.cookies`） |

## 关键约定 / 常见坑
- **HTTP 方法**：`ctx.method` 已统一为大写（如 `GET`）。
- **请求体**：进入中间件前已自动解析，直接读 `ctx.request.body`（JSON/表单会解析为对象）。
- **默认 404**：没有任何中间件设置响应体且未显式设状态码时，自动返回 404。
- **请求体上限**：超过 10MB 返回 413。
- **发送文件**：`ctx.sendFile` 小文件缓冲、大文件流式 + 背压；对不存在的文件会自动回 404 并返回 `false`。
- **WebSocket**：`ctx.send` / `ctx.publish` 返回发送状态（`uWebKoa.SendStatus`：`BACKPRESSURE`/`SUCCESS`/`DROPPED`）。
- **不要手写 `Content-Length`**：`res.end`/`tryEnd` 会由 uWS 自动设置，重复设置会导致协议错误（框架内部已处理）。

其它示例见上级 `examples/` 目录（`validate.js`、`websocket.js`、`middlewares/`）。
