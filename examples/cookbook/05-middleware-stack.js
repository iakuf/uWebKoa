// 配方 05：常用中间件栈（CORS + 请求日志 + 限流 + 统一错误处理 + 404）
// 全部内联，便于直接复制/理解；生产可拆到独立文件。
// 顺序很重要：错误处理最外层(最先 use)，业务中间件其次，404 最后。
import uWebKoa from '../../src/uWebKoa.js';

// 关掉内置默认错误处理，改用我们自己的(演示自定义)
const app = new uWebKoa({ disableDefaultErrorHandler: true });

// 1) 统一错误处理(最外层)
app.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        ctx.status = err.status || 500;
        ctx.json({ success: false, message: err.message || '服务器错误', code: err.code || 'ERROR' });
    }
});

// 2) 请求日志
app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.url} -> ${ctx.status} (${Date.now() - start}ms)`);
});

// 3) CORS
app.use(async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    ctx.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (ctx.method === 'OPTIONS') { ctx.status = 204; return; } // 预检直接结束
    await next();
});

// 4) 简易内存限流(每 IP 每窗口 N 次)——演示用；生产建议用共享存储
const hits = new Map();
const WINDOW = 10_000, LIMIT = 100;
app.use(async (ctx, next) => {
    // 说明：HTTP 端目前没有内置 ctx.ip，这里用一个占位 key。
    // 待框架补上 ctx.ip 后可换成真实客户端 IP。
    const key = 'global';
    const now = Date.now();
    const rec = hits.get(key) || { count: 0, reset: now + WINDOW };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW; }
    rec.count++;
    hits.set(key, rec);
    if (rec.count > LIMIT) ctx.throw(429, '请求过于频繁');
    await next();
});

// 业务路由
app.get('/', (ctx) => { ctx.json({ ok: true }); });
app.get('/boom', () => { throw new Error('故意报错'); });

// 5) 404(最后)
app.use((ctx) => {
    if (ctx.response.body === null) { ctx.status = 404; ctx.json({ success: false, message: 'Not Found' }); }
});

await app.listen(3000);
console.log('http://localhost:3000  ·  /boom 触发错误  ·  连续刷会触发 429');
