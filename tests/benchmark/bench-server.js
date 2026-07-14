// 基准测试用服务器：注册大量路由，用于验证基数树路由的常数级匹配。
// 由 bench.js 以子进程方式启动；就绪后打印 "READY <port>"。
import uWebKoa from '../../src/uWebKoa.js';

const app = new uWebKoa();

// 基线：简单 JSON
app.get('/', (ctx) => { ctx.json({ message: 'Hello World!' }); });

// 参数路由
app.get('/users/:id', (ctx) => { ctx.json({ id: ctx.request.params.id }); });

// 大 JSON 响应(1000 项数组)——与文档里原始基准场景一致
app.get('/large', (ctx) => {
    const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i, name: `Item ${i}`, value: Math.random() * 1000,
    }));
    ctx.json(data);
});

// POST JSON 回显(触发 parseBody)
app.post('/echo', (ctx) => { ctx.json(ctx.request.body); });

// 注册大量静态路由：用于对比"命中第 1 条"与"命中第 N 条"的 QPS 是否一致。
// 基数树是 O(路径段数)，两者应基本相等；线性扫描会随路由数增大而变慢。
const N = Number(process.env.ROUTES || 200);
for (let i = 0; i < N; i++) {
    app.get(`/route/${i}`, (ctx) => { ctx.json({ route: i }); });
}

const port = Number(process.env.PORT || 3000);
app.listen(port).then((token) => {
    if (token) console.log(`READY ${port}`);
    else { console.error('listen failed'); process.exit(1); }
});
