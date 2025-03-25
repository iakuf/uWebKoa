# uWebKoa

[Chinese Documentation](./README.cn.md) - Next Generation High Performance Web Framework

uWebKoa is an asynchronous high-performance Node.js web framework based on uWebSockets.js, adopting a Koa-like middleware architecture design. It provides a cleaner API and better development experience while maintaining the high-performance characteristics of uWebSockets.js.

- Native multi-CPU support
- Native non-blocking I/O model
- Streamlined JSON parsing
- WebSocket hybrid deployment support
- Static resource caching

Simplified interface mechanism and middleware architecture. Eliminates uWebSockets.js's complex interfaces and callback hell, while maintaining full compatibility with Koa ecosystem features including middleware, routing, and error handling.

Compared to Koa framework:
- Over 60% performance improvement for POST requests with JSON parsing
- Achieves 40,000 QPS on i5 12490F CPU
- 30% improvement for standard GET requests
- Theoretically better performance for complex tasks
- Enable multi-threading/multi-process mode for long-response tasks to maintain performance

## 🚀 Core Features

Main Features:
- Extreme Performance: 2-5x faster than Express/Koa
- Koa-like API: Familiar interface and middleware architecture, low learning curve
- Built-in Routing: Supports RESTful routing and parameter parsing
- Static File Service: Direct memory buffer operations avoid data copying, efficient file transfer
- Multi-core/Multi-thread Support: Automatic utilization of multi-core CPUs
- Lightweight: Minimal core code with zero redundant dependencies

## Performance Comparison
| Metric         | uWebKoa QPS | Koa QPS   | Improvement |
|----------------|-------------|-----------|-------------|
| GET Throughput | 38,822 RPS  | 30,370 RPS| +28%        |
| POST JSON      | 34,161 RPS  | 20,927 RPS| +63%        |

*Test Environment: i5 12490F / 32GB DDR4 / Windows 11*

## Quick Start

### Installation
```shell
npm install uWebKoa
# or
yarn add uWebKoa
```

### Basic Example
```javascript
import uWebKoa from 'uWebKoa';

const app = new uWebKoa();

// Middleware usage
app.use(async (ctx, next) => {
  console.log(`Request: ${ctx.method} ${ctx.url}`);
  await next();
});

// Route example
app.get('/', (ctx) => {
  ctx.body = 'Hello uWebKoa!';
});

app.get('/user/:id', (ctx) => {
  ctx.body = `User ID: ${ctx.request.params.id}`;
});

// Start server
app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
```

## API Documentation
### Application

```javascript
import uWebKoa from 'uWebKoa';
const app = new uWebKoa();
```
Options:
- rootDir: Project root directory (default: process.cwd())
- staticDirs: Static file directory mapping
- ssl: SSL configuration object ({ key_file_name, cert_file_name, passphrase })

### Middleware

```javascript
app.use(async (ctx, next) => {
  // Pre-request processing
  await next();
  // Post-request processing
});
```

### Context
Each request creates a `ctx` object containing:
- `ctx.request`: Request object
- `ctx.response`: Response object
- `ctx.method`: HTTP method
- `ctx.url`: Request URL
- `ctx.query`: Query parameters
- `ctx.params`: Route parameters
- `ctx.body`: Response body
- `ctx.status`: HTTP status code

### Routing
```javascript
app.get('/path', ...handlers);
app.post('/path', ...handlers);
app.put('/path', ...handlers);
app.delete('/path', ...handlers);
app.get('/path/:id',...handlers);
app.get('/path/*',...handlers);
```

Support multiple handlers:
```javascript
app.get('/user', 
  (ctx, next) => { /* Validation */ next() },
  (ctx) => { /* Processing */ }
);
```

### Static File Service
```javascript
app.serveStatic('/public', './static');
```

### Response Methods
- `ctx.json(data)`: Send JSON response
- `ctx.sendFile(path)`: Send file
- `ctx.redirect(url)`: Redirect
- `ctx.throw(status, message)`: Throw error

## Advanced Features

### Multi-core Mode
```javascript
app.listen(3000, { 
  cluster: true,
  workers: 4 // Optional, uses all CPU cores by default
});
```

### Multi-thread Mode
```javascript
// Thread mode (multi-threading)
app.listen(3000, {
  threads: true,
  workers: 8 // 8 worker threads
});
```
*Note: Uses handle migration technology. Thread crashes may cause main process termination.*

### SSL/TLS Support
```javascript
const app = new uWebKoa({
  ssl: {
    key_file_name: 'key.pem',
    cert_file_name: 'cert.pem',
    passphrase: 'your-passphrase' // Optional
  }
});
```

### Native WebSocket Support
```javascript
app.getUWebSocketApp().ws('/chat', {
  open: (ws) => {...},
  message: (ws, msg) => {...}
});
```

### Socket.IO Integration
```javascript
// Create socket.io instance
const io = new Server({
  cors: {
    origin: '*',
  },
});

// Get uWebSocket.js app instance
const uWebSocketApp = app.getUWebSocketApp();
io.attachApp(uWebSocketApp);
app.context.io = io; // Pass socket.io instance to context

app.get('/path/:id', (ctx) => {
  ctx.io.to(id).emit("server_notify_update", {}); 
});
```

## Best Practices
1. **Middleware Order**: Place general middleware before route-specific ones
2. **Error Handling**: Use try/catch or error handling middleware
3. **Static Files**: Enable cache for small files, streaming for large files
4. **Production**: Enable multi-core mode for full CPU utilization

## Migration Guide

### From Koa
1. Replace `require('koa')` with `import uWebKoa from 'uwebkoa'`
2. Note `ctx.res` and `ctx.req` are native uWebSockets.js objects
3. Use `ctx.sendFile()` instead of `ctx.send()` for file operations
4. Request body parsing uses `await ctx.parseBody()` automatically

## Example Project
```javascript
import uWebKoa from 'uwebkoa';

const app = new uWebKoa();

// Logger middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${ctx.method} ${ctx.url} - ${ms}ms`);
});

// API Routes
app.get('/api/users', async (ctx) => {
  ctx.body = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
});

app.post('/api/users', async (ctx) => {
  await ctx.parseBody();
  // User creation logic
  ctx.status = 201;
  ctx.body = { success: true };
});

// Static Files
app.serveStatic('/public', './assets');

// Error Handling
app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { error: 'Not Found' };
});

// Start Server
app.listen(3000, { cluster: true });
```
## FAQ
- Why choose uWebKoa over Koa or Express?
uWebKoa maintains Koa's elegant API while providing significant performance improvements through the uWebSockets.js foundation, making it particularly suitable for high-concurrency scenarios.

- Does it support WebSocket and Socket.io?
The current version primarily focuses on HTTP services, with native WebSocket and Socket.io support planned for future releases.

- How to access the raw request object?
You can access uWebSockets.js' native objects through ctx.req and ctx.res. Additionally, app.getUWebSocketApp() retrieves the native uWebSockets.js application instance.

## Contribution
We welcome issues and pull requests. Please ensure:

- Consistent code style
- Passing all tests
- Comprehensive test coverage for new features

For questions or suggestions:

Open an issue on GitHub

1. mail iakuf@163.com with subject line "[uWebKoa] Your Subject"
2. Please include detailed reproduction steps for bug reports and clear rationale for feature requests.

## Stress Test
```bash
autocannon -c 100 -d 10 http://localhost:3000/api/users
```

## License
MIT