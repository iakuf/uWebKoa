# uWebKoa

[English Documentation](./README.en.md)
# uWebKoa

[English Documentation](./README.en.md) - 新一代高性能 Web 框架

uWebKoa 是一个基于 uWebSockets.js 的异步高性能 Node.js 的 Web 框架，采用类似 Koa 的中间件架构设计，提供了更简洁的 API 和更好的开发体验，同时保持了 uWebSocket.js 的高性能特性。

原生的多 CPU 使用的支持。原生非阻塞I/O模型, 流式的 JSON 解析， 支持 WebSocket 混合部署， 支持静态资源缓存。

非常简洁的接口机制和中间件机制。没有了 uWebSocket.js 复杂的接口和回调地狱， 并且兼容了 Koa 生态的所有功能，包括中间件、路由、错误处理等。

对比 Koa 框架， 在请求是 POST 请求带 JSON 需要解析超过 60% 性能提升，在 i5 12490F 的 CPU 达到 4万每秒的 QPS ，标准 GET 有近 30% 的提升，理论上复杂任务本框架会有更好的性能。如果是响应时间比较久的任务，可以开启多线程或多进程模式，来保持性能不下降的前提，来给 CPU 用光。

## 🚀 核心特性

主要特性
- 极高性能：比 Express/Koa 快 2-5 倍
- 类 Koa API：熟悉接口和中件间架构，学习成本低
- 内置路由：支持 RESTful 路由和参数解析
- 静态文件服务：直接操作内存缓冲区，避免数据复制，高效的文件传输支持
- 多核多线程支持：自动利用多核 CPU
- 轻量级：核心代码精简，无冗余依赖

## 性能对比
| 指标          | uWebKoa   QPS   | Koa    QPS     | 提升幅度 |
|---------------|-------------|-------------|--------|
| GET吞吐量      | 38,822 RPS  | 30,370 RPS  | +28%   |
| POST JSON吞吐量|  34,161 RPS  | 20,927 RPS | +63%   |

*测试环境：i5 12490F / 32GB DDR4 / Windows 11*


## 快速开始

### 快速入门
```shell
npm install uWebKoa
# 或
yarn add uWebKoa
```

### 基础示例
```javascript
import uWebKoa from 'uWebKoa';

const app = new uWebKoa();

// 使用中间件
app.use(async (ctx, next) => {
  console.log(`请求: ${ctx.method} ${ctx.url}`);
  await next();
});

// 路由示例
app.get('/', (ctx) => {
  ctx.body = 'Hello uWebKoa!';
});

app.get('/user/:id', (ctx) => {
  ctx.body = `用户ID: ${ctx.request.params.id}`;
});

// 启动服务器
app.listen(3000, () => {
  console.log('服务器运行在 http://localhost:3000');
});
```

## API 文档
### 应用

```shell
import uWebKoa from 'uWebKoa';
const app = new uWebKoa();
```
选项:

* rootDir: 项目根目录（默认: process.cwd()）
* staticDirs: 静态文件目录映射
* ssl: SSL 配置对象（{ key_file_name, cert_file_name, passphrase }）

### 中间件

```javascript
app.use(async (ctx, next) => {
  // 请求处理前
  await next();
  // 请求处理后
});
```

### 上下文 (Context)

每个请求都会创建一个 `ctx` 对象，包含：

- `ctx.request`: 请求对象
- `ctx.response`: 响应对象
- `ctx.method`: 请求方法
- `ctx.url`: 请求URL
- `ctx.query`: 查询参数对象
- `ctx.params`: 路由参数对象
- `ctx.body`: 响应体
- `ctx.status`: 响应状态码

### 路由

```javascript
app.get('/path', ...handlers);
app.post('/path', ...handlers);
app.put('/path', ...handlers);
app.delete('/path', ...handlers);
app.get('/path/:id',...handlers);
app.get('/path/*',...handlers);
```

支持多个处理函数：

```javascript
app.get('/user', 
  (ctx, next) => { /* 验证 */ next() },
  (ctx) => { /* 处理 */ }
);
```

### 静态文件服务

```javascript
app.serveStatic('/public', './static');
```

### 响应方法

- `ctx.json(data)`: 发送JSON响应
- `ctx.sendFile(path)`: 发送文件
- `ctx.redirect(url)`: 重定向
- `ctx.throw(status, message)`: 抛出错误

## 高级特性

### 多核模式

```javascript
app.listen(3000, { 
  cluster: true,
  workers: 4 // 可选，默认使用所有CPU核心
});
```

### 多线程模式

```javascript
// 线程模式（多线程）
app.listen(3000, {
  threads: true,
  workers: 8 // 8个工作线程
});
```

这时是使用的句柄迁移的技术实现的。如果线程内部有 carsh 可能会引起整个主进程退出。

### SSL/TLS 支持

```javascript
const app = new uWebKoa({
  ssl: {
    key_file_name: 'key.pem',
    cert_file_name: 'cert.pem',
    passphrase: 'your-passphrase' // 可选
  }
});
```

### 原生支持 WebSocket 支持

```javascript
app.getUWebSocketApp().ws('/chat', {
  open: (ws) => {...},
  message: (ws, msg) => {...}
});
```

### 原生支持 Socket.IO 集成支持

```javascript
// 创建 socket.io 实例
const io = new Server({
    cors: {
        origin: '*',
    },
})

// 获取 uWebSocket.js 应用实例
const uWebSocketApp = app.getUWebSocketApp();
io.attachApp(uWebSocketApp);
app.context.io = io; // 把 socket.io 实例挂载到 ctx 上
app.get('/path/:id', (ctx) => {
  ctx.io.to(id).emit("server_notify_update", {}); 
});
```

可以让 https 或 http 服务直接与 socket.io 相互通信。



## 最佳实践

1. **中间件顺序**：通用中间件放在前面，路由特定中间件放在后面
2. **错误处理**：使用 try/catch 或添加错误处理中间件
3. **静态文件**：对小文件使用缓存，对大文件使用流式传输
4. **生产环境**：启用多核模式充分利用CPU资源

## 迁移指南

### 从 Koa 迁移

1. 替换 `require('koa')` 为 `import uWebKoa from 'uwebkoa'`
2. 注意 `ctx.res` 和 `ctx.req` 是 uWebSockets.js 原生对象
3. 文件操作使用 `ctx.sendFile()` 替代 `ctx.send()`
4. 请求体解析使用 `await ctx.parseBody()` 自动在进入中间件时执行



## 示例项目

```javascript
import uWebKoa from 'uwebkoa';

const app = new uWebKoa();

// 日志中间件
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${ctx.method} ${ctx.url} - ${ms}ms`);
});

// API路由
app.get('/api/users', async (ctx) => {
  ctx.body = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
});

app.post('/api/users', async (ctx) => {
  await ctx.parseBody();
  // 处理创建用户逻辑
  ctx.status = 201;
  ctx.body = { success: true };
});

// 静态文件
app.serveStatic('/public', './assets');

// 错误处理
app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { error: 'Not Found' };
});

// 启动
app.listen(3000, { cluster: true });
```

## 常见问题
- 为什么选择 uWebKoa 而不是 Koa 或 Express?

uWebKoa 在保持 Koa 优雅 API 的同时，通过 uWebSockets.js 底层提供了显著的性能提升，特别适合高并发场景。

- 是否支持 WebSocket 和 Socket.io ?

当前版本主要关注 HTTP 服务，原生 WebSocket 与 Socket.io 的支持。

- 如何获取原始请求对象?

通过 ctx.req 和 ctx.res 可以访问 uWebSockets.js 的原始对象。app.getUWebSocketApp() 可以取得原生的 uWebSocket.js 的对象。

## 贡献

欢迎提交 issue 和 pull request。请确保代码风格一致并通过所有测试。  有任何问题或建议。
1. 请在 GitHub 上提出
2. 发邮件给 iakuf@163.com 注意标题注明 uWebKoa。

## 压力测试
autocannon -c 100 -d 10 http://localhost:3000/api/users