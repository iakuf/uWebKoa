// 配方 06：WebSocket 聊天室（房间 pub/sub）+ HTTP 触发推送（互通）
// 每个连接订阅 room:<房间名>；收到消息就广播到同房间；HTTP 接口也能往房间推。
// 试验（用任意 WS 客户端）：
//   连 ws://localhost:3000/room/lobby ，发文本即广播给同房间所有人
//   curl -XPOST http://localhost:3000/push/lobby -H "Content-Type: application/json" -d "{\"msg\":\"hi\"}"
import uWebKoa from '../../src/uWebKoa.js';

const app = new uWebKoa();

app.ws('/room/:name', {
    config: { idleTimeout: 120, maxBackpressure: 1024 * 1024 }, // 心跳由 uWS 自动 ping(默认开)
    open(ctx) {
        const room = ctx.request.params.name;
        ctx.subscribe(`room:${room}`);
        ctx.send({ type: 'joined', room });
    },
    message(ctx, data) {
        const room = ctx.request.params.name;
        // publish 向主题广播，返回 boolean(是否有订阅者)。逐订阅者的背压由 uWS 内部处理。
        ctx.publish(`room:${room}`, data.toString());
        // 若要对"某个连接直接发送"做背压感知，用 ctx.send 的返回值判断：
        //   if (ctx.send(msg) === uWebKoa.SendStatus.BACKPRESSURE) { ...等 drain... }
    },
    drain(ctx) { console.log(`背压缓解，剩余 ${ctx.getBufferedAmount()} 字节`); },
    close(ctx, code) { console.log(`离开房间，code=${code}`); },
});

// HTTP -> WS 推送
app.post('/push/:name', (ctx) => {
    ctx.app.publish(`room:${ctx.request.params.name}`, { type: 'push', payload: ctx.request.body });
    ctx.json({ ok: true });
});

await app.listen(3000);
console.log('ws://localhost:3000/room/:name  ·  POST /push/:name');
