import uWebKoa from '../src/uWebKoa.js';
import { createRateLimit } from '../src/middlewares/rateLimit.js';

// 创建 uWebKoa 实例
const webKoa = new uWebKoa();

// 创建应用
const app = await webKoa.createApp();

// 创建限速中间件 - 每 60 秒允许 10 个请求
const rateLimitMiddleware = createRateLimit(10, 60000)();

// 全局应用限速中间件
webKoa.use(rateLimitMiddleware);

// 或者针对特定路由应用不同的限速规则
const apiLimiter = createRateLimit(5, 60000)({
    keyGenerator: (ctx) => ctx.request.headers['api-key'] || ctx.req.getRemoteAddress().toString(),
    handler: async (ctx) => {
        ctx.status(429);
        ctx.json({
            error: 'API 请求过于频繁，请稍后再试',
            retryAfter: 60
        });
    }
});

// 为 API 路由添加更严格的限速
webKoa.get('/api/*', async (ctx, next) => {
    await apiLimiter(ctx, next);
});

// 添加路由
webKoa.get('/', async (ctx) => {
    ctx.json({ message: '欢迎访问首页' });
});

webKoa.get('/api/data', async (ctx) => {
    ctx.json({ data: '这是 API 数据' });
});

// 应用中间件
webKoa.applyToApp(app);

// 启动服务器
const port = 3000;
webKoa.listen(app, port).then(token => {
    if (token) {
        console.log('服务器启动成功');
    }
});