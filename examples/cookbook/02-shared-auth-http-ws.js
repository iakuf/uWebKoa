// 配方 02：一份鉴权中间件，同时守护 HTTP 与 WebSocket（uWebKoa 的招牌能力）
// 关键：中间件只依赖 ctx.request.headers / ctx.state / ctx.throw / next，两侧通用。
// 试验：
//   curl -H "Authorization: Bearer secret" http://localhost:3000/me     -> 200
//   curl http://localhost:3000/me                                       -> 401
//   WS  ws://localhost:3000/live  (带同样的 Authorization 头才能连上)
import uWebKoa from '../../src/uWebKoa.js';

const app = new uWebKoa();

async function auth(ctx, next) {
    if (ctx.request.headers['authorization'] !== 'Bearer secret') {
        ctx.throw(401, '未授权'); // HTTP 返回 401；WS 升级期则拒绝升级并回 401
    }
    ctx.state.user = { id: 1, name: 'alice' }; // 升级期设置的 state 会带入连接期
    await next();
}

// HTTP：把 auth 当普通中间件用
app.get('/me', auth, (ctx) => { ctx.json(ctx.state.user); });

// WS：把同一个 auth 放进 upgrade 数组
app.ws('/live', {
    upgrade: [auth],
    open(ctx) { ctx.send({ hello: ctx.state.user.name }); },
    message(ctx, data) { ctx.send({ echo: data.toString(), by: ctx.state.user.name }); },
});

await app.listen(3000);
console.log('http://localhost:3000/me  ·  ws://localhost:3000/live');
