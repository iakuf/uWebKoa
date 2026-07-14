# uWebKoa

[Chinese Documentation](./README.cn.md) - Next Generation High Performance Web Framework

uWebKoa is an asynchronous high-performance Node.js web framework based on uWebSockets.js, adopting a Koa-like middleware architecture design. It provides a cleaner API and better development experience while maintaining the high-performance characteristics of uWebSockets.js.

- Native multi-CPU support
- Native non-blocking I/O model
- Streamlined JSON parsing
- WebSocket hybrid deployment support
- Static resource caching

Simplified interface mechanism and middleware architecture. Eliminates uWebSockets.js's complex interfaces and callback hell, while maintaining full compatibility with Koa ecosystem features including middleware, routing, and error handling.

Performance positioning (numbers are reproducible — see the "Performance & Benchmarking" section and `pnpm run bench`):
- Built on uWebSockets.js, which bypasses Node's built-in `http` server, so the throughput ceiling sits well above `node:http`-based frameworks (Express / Koa / Fastify).
- On an i5-12490F: JSON GET ~37k req/s and JSON POST ~35k req/s (50 conns, pipelining=10). Reproduce on your own hardware with `pnpm run bench`.
- For long-running work, enable cluster/thread mode to keep throughput up.

## 🚀 Core Features

Main Features:
- High throughput: built on uWebSockets.js (bypasses `node:http`), substantially faster than Express/Koa for raw HTTP — reproduce with `pnpm run bench`
- Koa-like API: Familiar interface and middleware architecture, low learning curve
- Built-in Routing: Supports RESTful routing and parameter parsing
- Static File Service: Direct memory buffer operations avoid data copying, efficient file transfer
- Multi-core/Multi-thread Support: Automatic utilization of multi-core CPUs
- Lightweight: Minimal core code with zero redundant dependencies

## Performance Comparison
The authoritative, reproducible numbers live in the "Performance & Benchmarking" section below
(run `pnpm run bench`). The historical vs-Koa figures are kept here for context:

| Metric         | uWebKoa QPS | Koa QPS (historical) | Improvement |
|----------------|-------------|----------------------|-------------|
| GET Throughput | ~37,600 RPS | 30,370 RPS           | ~+24%       |
| POST JSON      | ~35,300 RPS | 20,927 RPS           | ~+69%       |

*Environment: i5-12490F / 32GB DDR4 / Windows 11. uWebKoa column re-measured with the current code
(pipelining=10); the Koa column is the original author's measurement — for an apples-to-apples
comparison run both under identical settings (see `tests/benchmark/koa-benchmark.js`).*

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
- disableDefaultErrorHandler: Skip the built-in error-handling middleware (default: false)
- timeout: { request, middleware }
  - request: overall request timeout in ms (default: 30000)
  - middleware: middleware-chain timeout in ms (default: 0 = disabled for zero hot-path overhead; set a positive value to return 503 if the chain exceeds it)

> Requires Node.js 22 or 24 (the bundled uWebSockets.js native binary targets these). Node 20 is no longer supported by the current uWS build.

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
- `ctx.method`: HTTP method (normalized to uppercase, e.g. `GET`)
- `ctx.url`: Request URL
- `ctx.query`: Query parameters
- `ctx.request.params`: Route parameters
- `ctx.body`: Response body
- `ctx.status`: HTTP status code
- `ctx.state`: Per-request scratch space for user data (e.g. `ctx.state.user`); shared contract with WS
- `ctx.type`: `'http'` or `'ws'`
- `ctx.app`: The uWebKoa instance (e.g. `ctx.app.publish(...)`)

Behavior notes:
- Unmatched routes return a default `404` (Koa-style: when no body is set and no explicit status).
- Request bodies over 10MB are rejected with `413`.

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
- `ctx.sendFile(path)`: Send file (small files buffered; large files streamed with backpressure)
- `ctx.set(key, value)`: Set a response header
- `ctx.redirect(url, status = 302)`: Redirect
- `ctx.throw(status, message)`: Throw an error (handled by the error middleware)
- `ctx.assert(condition, status, message)`: Throw if condition is falsy

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

WebSocket is a first-class citizen. `app.ws()` shares the same middleware contract and `ctx`
as HTTP, so an auth middleware can guard both worlds, and HTTP handlers can push to WS clients
via native pub/sub.

```javascript
// A middleware reused for both HTTP and WS (only depends on ctx.headers / ctx.state / ctx.throw)
async function auth(ctx, next) {
  if (ctx.request.headers['authorization'] !== 'Bearer secret') ctx.throw(401);
  ctx.state.user = { id: 1, name: 'alice' };   // carried from upgrade into the connection ctx
  await next();
}
app.get('/me', auth, ctx => ctx.json(ctx.state.user)); // HTTP

app.ws('/chat/:room', {
  // uWS native connection options
  config: {
    idleTimeout: 60,                 // auto-close idle conns; auto-ping (heartbeat) at idleTimeout/2
    maxBackpressure: 1024 * 1024,    // 1MB backpressure cap
    // rawMessage: true,             // deliver raw ArrayBuffer (zero-copy) instead of Buffer
  },
  upgrade: [auth],                   // upgrade middleware: ctx.throw / setting a status rejects the upgrade
  open(ctx)  { ctx.subscribe(`room:${ctx.request.params.room}`); ctx.send({ joined: true }); },
  message(ctx, data, isBinary) {
    // ctx.send/ctx.publish return a send status (see uWebKoa.SendStatus): BACKPRESSURE/SUCCESS/DROPPED
    ctx.publish(`room:${ctx.request.params.room}`, data.toString());
  },
  drain(ctx) { /* backpressure relieved; ctx.getBufferedAmount() to inspect */ },
  close(ctx, code, message) { /* cleanup */ },
});

// HTTP endpoint pushing to a WS room (HTTP <-> WS interop)
app.post('/broadcast/:room', (ctx) => {
  ctx.app.publish(`room:${ctx.request.params.room}`, { sys: 'notice' }); // objects auto JSON-serialized
  ctx.json({ ok: true });
});
```

Connection `ctx` methods: `ctx.send(data, isBinary?, compress?)`, `ctx.publish(topic, data)`,
`ctx.subscribe(topic)` / `ctx.unsubscribe(topic)` / `ctx.isSubscribed(topic)`,
`ctx.getBufferedAmount()`, `ctx.ping(msg)`, `ctx.cork(cb)`, `ctx.close(code?, msg?)`,
`ctx.getRemoteAddress()`, plus `ctx.state` (carried from the upgrade phase).

Lifecycle handlers: `open`, `message`, `drain`, `ping`, `pong`, `dropped`, `close`.
Global WS upgrade middleware can be registered with `app.wsUse(mw)`.
Broadcast from anywhere with `app.publish(topic, message)`.

You can still access the raw uWS app via `app.getUWebSocketApp()` if you need lower-level control.

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
Yes. Native WebSocket is a first-class feature via `app.ws()` (shared middleware/ctx with HTTP, pub/sub, backpressure, heartbeat) — see "Native WebSocket Support". Socket.io also works by attaching it to the underlying uWS app (see "Socket.IO Integration").

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

## Testing
```bash
pnpm test          # unit tests (fast, uWS mocked)
pnpm run test:e2e  # integration tests (real server: HTTP + WebSocket)
pnpm run test:all  # everything
```

## Performance & Benchmarking
```bash
pnpm run bench                                   # default: 100 conns, 10s, no pipelining
$env:PIPELINING=10; $env:CONNECTIONS=50; pnpm run bench   # comparable to the numbers below
```
The runner (`tests/benchmark/bench.js`) spawns a real server (many routes registered) and drives
several scenarios with autocannon, then prints a table.

Measured on i5-12490F / Windows 11, `connections=50 duration=8s pipelining=10`:

| Scenario | req/sec |
|---|---|
| GET / (baseline) | ~37,600 |
| POST /echo (JSON body) | ~35,300 |
| GET /route/0 (1st of 200) | ~39,900 |
| GET /route/199 (200th of 200) | ~37,100 |

Two things worth knowing before you compare numbers:
- **Pipelining matters.** Without it, and with the load generator sharing CPU with the server on one
  box, throughput *drops* as connections rise (client starves the server). The same GET / measured
  ~12k without pipelining vs ~37k with `pipelining=10`. Always match methodology when comparing.
- **Routing is constant-time.** Hitting the 1st vs the 200th registered route yields the same req/sec
  (radix-tree router), unlike a linear scan that degrades as routes grow.

For the most trustworthy absolute numbers, run the load generator on a *separate* machine from the server.

## Stress Test
```bash
autocannon -c 100 -d 10 http://localhost:3000/api/users
```

## License
MIT