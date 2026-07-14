// WebSocket 端到端集成测试：真实 uWebSockets.js 服务器 + 真实 ws 客户端。
// 验证：echo、升级鉴权(共享中间件/ctx.state)、房间 pub/sub 广播、HTTP -> WS 推送互通。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import uWebKoa from '@/uWebKoa.js';
import { us_listen_socket_close } from 'uWebSockets.js';
import WebSocket from 'ws';

const PORT = 43221;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;

let listenSocket = null;

// 复用于 HTTP 与 WS 的鉴权中间件：只依赖 ctx.headers / ctx.state / ctx.throw
async function auth(ctx, next) {
  if (ctx.request.headers['authorization'] !== 'secret') {
    ctx.throw(401, 'unauthorized');
  }
  ctx.state.user = 'alice';
  await next();
}

// 从连接建立起就缓冲消息，避免 open 时服务端立即下发的帧在监听器挂上前丢失(竞态)
function connect(path, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}${path}`, options);
    ws._queue = [];
    ws._waiters = [];
    ws.on('message', (data) => {
      const waiter = ws._waiters.shift();
      if (waiter) waiter(data);
      else ws._queue.push(data);
    });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => {
      reject(Object.assign(new Error('unexpected-response'), { statusCode: res.statusCode }));
    });
    ws.once('error', (err) => reject(err));
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    if (ws._queue.length) resolve(ws._queue.shift());
    else ws._waiters.push(resolve);
  });
}

beforeAll(async () => {
  const app = new uWebKoa();

  // echo：把收到的消息原样发回
  app.ws('/echo', {
    message(ctx, data, isBinary) { ctx.send(data, isBinary); },
  });

  // 房间：open 订阅房间主题并回执 joined；message 广播到房间
  app.ws('/chat/:room', {
    open(ctx) {
      ctx.subscribe(`room:${ctx.request.params.room}`);
      ctx.send({ joined: ctx.request.params.room });
    },
    message(ctx, data) {
      ctx.publish(`room:${ctx.request.params.room}`, data.toString());
    },
  });

  // 受保护的 WS：复用 auth 中间件；通过后用 ctx.state.user 回欢迎语
  app.ws('/secure', {
    upgrade: [auth],
    open(ctx) { ctx.send(`welcome ${ctx.state.user}`); },
  });

  // HTTP 接口向 WS 房间推送(互通)
  app.post('/push/:room', (ctx) => {
    ctx.app.publish(`room:${ctx.request.params.room}`, { sys: 'hello' });
    ctx.json({ ok: true });
  });

  listenSocket = await app.listen(PORT);
  if (!listenSocket) throw new Error(`无法在端口 ${PORT} 启动测试服务器(可能被占用)`);
});

afterAll(() => {
  if (listenSocket) {
    us_listen_socket_close(listenSocket);
    listenSocket = null;
  }
});

describe('WebSocket e2e (真实 uWebSockets.js)', () => {
  it('echo：发什么收什么', async () => {
    const ws = await connect('/echo');
    ws.send('ping');
    const msg = await nextMessage(ws);
    expect(msg.toString()).toBe('ping');
    ws.close();
  });

  it('升级鉴权失败返回 401 且不建立连接', async () => {
    await expect(connect('/secure')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('升级鉴权通过：共享 ctx.state 传到连接期', async () => {
    const ws = await connect('/secure', { headers: { authorization: 'secret' } });
    const msg = await nextMessage(ws);
    expect(msg.toString()).toBe('welcome alice');
    ws.close();
  });

  it('房间广播：一个客户端发消息，同房间另一个收到', async () => {
    const a = await connect('/chat/lobby');
    const b = await connect('/chat/lobby');
    // 消费各自 open 时的 joined 回执
    expect(JSON.parse((await nextMessage(a)).toString())).toEqual({ joined: 'lobby' });
    expect(JSON.parse((await nextMessage(b)).toString())).toEqual({ joined: 'lobby' });

    a.send('hello room');
    const received = await nextMessage(b);
    expect(received.toString()).toBe('hello room');
    a.close();
    b.close();
  });

  it('HTTP 接口通过 app.publish 向 WS 房间推送(互通)', async () => {
    const c = await connect('/chat/news');
    await nextMessage(c); // joined

    const r = await fetch(`${HTTP}/push/news`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });

    const pushed = await nextMessage(c);
    expect(JSON.parse(pushed.toString())).toEqual({ sys: 'hello' });
    c.close();
  });
});
