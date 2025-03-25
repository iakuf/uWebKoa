# uWebKoa - 新一代高性能 Web 框架

基于 uWebSockets.js 构建的异步 Web 框架，提供 Koa 风格的完全异步 API 和突破性的性能表现.
原生的多 CPU 使用的支持。原生非阻塞I/O模型, 流式的 JSON 解析， 支持 WebSocket 混合部署， 支持静态资源缓存。
非常简洁的接口机制和中间件机制。并且了 Koa 生态的所有功能，包括中间件、路由、错误处理等。对比 koa 复杂 POST 带 JSON 解析超过 60% 性能提升，在 i5 12490F 的 CPU 达到 4万每秒的 QPS ，标准 GET 有近 30% 的提升，理论上复杂任务本框架会有更好的性能。如果是响应时间比较久的任务，可以开启多线程或多进程模式，来保持性能不下降给 CPU 用光。

## 🚀 核心特性

### 革命性性能
| 指标          | uWebKoa      | Koa         | 提升幅度 |
|---------------|-------------|-------------|--------|
| GET吞吐量      | 38,822 RPS  | 30,370 RPS  | +28%   |
| POST JSON吞吐量|  34,161 RPS  | 20,927 RPS | +63%   |

*测试环境：i5 12490F / 32GB DDR4 / Windows 11*

### 全兼容Koa生态
```javascript
// 完全支持Koa语法
app.use(koaLogger());
app.use(koaBody());

// 兼容Koa上下文API
ctx.status = 201;
ctx.body = { data: ... };
ctx.throw(404, 'Not Found');
```

### 多核并发支持
```javascript
// 集群模式（多进程）
app.listen(3000, {
  cluster: true,
  workers: 4 // 4个工作进程
});

// 线程模式（多线程）
app.listen(3000, {
  threads: true,
  workers: 8 // 8个工作线程
});
```

### 高性能路由
```javascript
// 动态路由参数
app.get('/users/:id', ctx => {
  const { id } = ctx.params;
  // ...
});

// 路由匹配算法
┌─────────┬───────────────┐
│ 模式     │ 匹配路径       │
├─────────┼───────────────┤
│ /api/*  │ /api/v1/users │
│ /:id    │ /123          │
└─────────┴───────────────┘
```

### 零拷贝架构- 
- 直接操作内存缓冲区，避免数据复制
- 智能响应分块(cork)机制
- 同步上下文初始化

### 企业级功能
原生静态文件支持， WebSocket 支持， 支持 WebSocket 混合部署， 支持静态资源缓存， 支持自动压缩。

```javascript
// 静态资源服务
app.serveStatic('/assets', 'public', {
  maxAge: 3600,   // 缓存控制
  gzip: true      // 自动压缩
});

// 支持WebSocket混合部署
app.ws('/chat', {
  open: (ws) => {...},
  message: (ws, msg) => {...}
});
```
原生可以和 socket.io 无缝集成。
```javascript
import { Server } from "socket.io";
const app = new uWebKoa();
 const io = new Server({
      cors: {
        origin: '*',
      },
    })

    io.use(socketAuthMiddleware());
    
    io.adapter(createAdapter(pubClient, subClient))
    
    io.of('/').on("connection", (socket) => {
        const namespace = socket.nsp
        const { id } = socket
    
        //...   
    });
io.attachApp(app);
await app.listen(3000);
```

# 快速开始
## 安装
```bash
npm install uwebsockets.js @geelevel/uwebkoa
```
## 基础示例
uWebSocket_new.js
应用
```javascript
import uWebKoa from './uWebKoa';
import { validate } from './middlewares/validation';

const app = new uWebKoa();

// 中间件链
app.use(requestLogger())
   .use(errorHandler())
   .use(cors());

// RESTful API
app.get('/api/users', 
  validate(querySchema), 
  ctx => {
    const { page, limit } = ctx.query;
    ctx.json({
      data: fetchUsers(page, limit)
    });
  }
);

// 启动集群
app.listen(3000, { cluster: true }).then(() => {
  console.log('Cluster mode running');
});
```
## 高级配置
### 性能调优
多进程模式下，每个工作进程都有自己的事件循环，因此可以根据工作进程的数量来调整性能。
```javascript
app.listen(3000, {
  cluster: true,
  workers: 0,          // CPU核心数
  maxBodySize: '1mb',  // 请求体限制
  idleTimeout: 30,     // 秒
  maxConnections: 10000
});
```
多线程模式下，每个工作线程都有自己的事件循环，因此可以根据工作线程的数量来调整性能。线程使用同一端口，通过句柄迁移来实现负载均衡。
```javascript
app.listen(3000, {
  thread: true
});
```

### SSL 配置
原生的 SSL  支持。无需第三方模块
```javascript
app.listen(443, {
  ssl: {
    key_file_name: 'privkey.pem',
    cert_file_name: 'fullchain.pem',
    passphrase: 'your_password'
  }
});
```

### 测试方法
# 压力测试
autocannon -c 100 -d 10 http://localhost:3000/api/users