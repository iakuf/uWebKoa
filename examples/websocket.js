// WebSocket 示例：心跳(idleTimeout)、背压(drain)处理、pub/sub 房间、HTTP -> WS 推送。
// 运行：node examples/websocket.js  然后用任意 WS 客户端连 ws://localhost:9001/chat/lobby
import uWebKoa from '../src/uWebKoa.js';

const app = new uWebKoa();

// 可复用于 HTTP 与 WS 的鉴权中间件(只依赖 ctx.headers / ctx.state / ctx.throw)
async function auth(ctx, next) {
    const token = ctx.request.headers['authorization'];
    if (token !== 'Bearer secret') {
        ctx.throw(401, '未授权'); // WS 升级期抛错即拒绝升级并回 401；HTTP 里同样返回 401
    }
    ctx.state.user = { id: 1, name: 'alice' };
    await next();
}

app.ws('/chat/:room', {
    // uWS 原生连接配置
    config: {
        idleTimeout: 60,               // 60s 无数据则关闭；sendPingsAutomatically(默认开)会在 30s 自动 ping 做心跳
        maxPayloadLength: 16 * 1024,   // 单帧上限 16KB
        maxBackpressure: 1 * 1024 * 1024, // 积压上限 1MB，超过则丢弃(触发 dropped)
        // rawMessage: true,           // 打开则 message 回调收到原始 ArrayBuffer(零拷贝)
    },

    // 升级前中间件(与 HTTP 复用同一个 auth)
    upgrade: [auth],

    open(ctx) {
        const room = ctx.request.params.room;
        ctx.subscribe(`room:${room}`);
        ctx.send({ type: 'joined', room, user: ctx.state.user.name }); // state 从升级期带过来
        console.log(`${ctx.state.user.name} 加入房间 ${room}`);
    },

    message(ctx, data, isBinary) {
        const room = ctx.request.params.room;
        // publish 广播到主题(返回 boolean)；逐订阅者背压由 uWS 内部处理。
        ctx.publish(`room:${room}`, data.toString(), isBinary);
        // 对"直接发给某连接"才用 send 的返回值做背压判断：
        //   if (ctx.send(msg) === uWebKoa.SendStatus.BACKPRESSURE) { /* 等 drain */ }
    },

    drain(ctx) {
        // 背压缓解，可在此续发之前因背压暂停的数据
        console.log(`背压缓解，剩余积压 ${ctx.getBufferedAmount()} 字节`);
    },

    // 收到客户端 pong(uWS 自动 ping 的回应)
    pong(ctx) {
        // 可在此更新"最近活跃时间"等
    },

    // 出站消息因超过 maxBackpressure 被丢弃
    dropped(ctx, data, isBinary) {
        console.warn('消息被丢弃(背压超限)');
    },

    close(ctx, code, message) {
        console.log(`连接关闭 code=${code} user=${ctx.state?.user?.name}`);
    },
});

// HTTP 接口向 WS 房间推送(HTTP <-> WS 互通)
app.post('/broadcast/:room', async (ctx) => {
    await ctx.parseBody();
    ctx.app.publish(`room:${ctx.request.params.room}`, {
        type: 'broadcast',
        payload: ctx.request.body,
    });
    ctx.json({ ok: true });
});

app.listen(9001).then(() => {
    console.log('WS 示例服务器: ws://localhost:9001/chat/:room  (需带 header  Authorization: Bearer secret)');
    console.log('HTTP 推送:      POST http://localhost:9001/broadcast/:room');
});
