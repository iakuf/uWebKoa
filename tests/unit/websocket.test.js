import { describe, it, expect, vi, beforeEach } from 'vitest';
import uWebKoa from '@/uWebKoa.js';

// 模拟 uWebSockets.js，App/SSLApp 带 ws/any/publish
vi.mock('uWebSockets.js', () => {
  const makeApp = () => ({
    any: vi.fn(),
    ws: vi.fn(),
    listen: vi.fn((port, cb) => { cb(true); return {}; }),
    publish: vi.fn(() => true),
    getDescriptor: vi.fn(() => ({})),
    addChildAppDescriptor: vi.fn(),
  });
  return { App: vi.fn(makeApp), SSLApp: vi.fn(makeApp) };
});

function mockUpgradeReq(url = '/', headers = {}, query = '') {
  return {
    getUrl: () => url,
    getMethod: () => 'get',
    getQuery: () => query,
    getHeader: (h) => headers[h] || '',
    forEach: (cb) => Object.entries(headers).forEach(([k, v]) => cb(k, v)),
  };
}

function mockUpgradeRes() {
  return {
    onAborted: vi.fn(function (cb) { this.abortCb = cb; }),
    cork: vi.fn(function (cb) { cb(); }),
    upgrade: vi.fn(),
    writeStatus: vi.fn(),
    writeHeader: vi.fn(),
    end: vi.fn(),
  };
}

function mockWs(userData = {}, sendStatus = 1) {
  return {
    getUserData: () => userData,
    send: vi.fn(() => sendStatus),
    getBufferedAmount: vi.fn(() => 42),
    ping: vi.fn(() => 1),
    cork: vi.fn((cb) => cb()),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isSubscribed: vi.fn(() => true),
    publish: vi.fn(),
    close: vi.fn(),
    end: vi.fn(),
    getRemoteAddressAsText: () => Buffer.from('127.0.0.1'),
  };
}

function toArrayBuffer(str) {
  const buf = Buffer.from(str);
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

// 注册 ws 路由后，从 uWS mock 里取出对应的 behavior 对象
function getBehavior(app, pattern) {
  const mockApp = app.getUWebSocketApp();
  app.applyToApp(mockApp);
  const call = mockApp.ws.mock.calls.find(c => c[0] === pattern);
  return call ? call[1] : null;
}

describe('WebSocket (app.ws)', () => {
  let app;
  beforeEach(() => {
    app = new uWebKoa({ disableDefaultErrorHandler: true });
    vi.clearAllMocks();
  });

  it('注册路由并在 applyToApp 时先于 any(/*) 挂到 uWS', () => {
    app.ws('/chat/:room', { message() { } });
    const mockApp = app.getUWebSocketApp();
    app.applyToApp(mockApp);
    expect(mockApp.ws).toHaveBeenCalledWith('/chat/:room', expect.any(Object));
    expect(mockApp.any).toHaveBeenCalledWith('/*', expect.any(Function));
    // ws 必须先于 any 注册，否则升级请求会被 HTTP catch-all 抢走
    expect(mockApp.ws.mock.invocationCallOrder[0])
      .toBeLessThan(mockApp.any.mock.invocationCallOrder[0]);
  });

  it('升级通过后 res.upgrade 携带 state/params 和升级三件套', async () => {
    app.ws('/chat/:room', {
      upgrade: async (ctx, next) => { ctx.state.user = 'alice'; await next(); },
      open() { }, message() { },
    });
    const behavior = getBehavior(app, '/chat/:room');
    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/chat/lobby', { 'sec-websocket-key': 'K' }), { c: 1 });

    expect(res.upgrade).toHaveBeenCalledTimes(1);
    const args = res.upgrade.mock.calls[0];
    expect(args[0].carry.state).toEqual({ user: 'alice' });
    expect(args[0].carry.params).toEqual({ room: 'lobby' });
    expect(args[1]).toBe('K');       // sec-websocket-key
    expect(args[4]).toEqual({ c: 1 }); // uWS context
  });

  it('升级中间件 throw 时拒绝升级并返回对应 HTTP 状态码', async () => {
    app.ws('/secure', { upgrade: (ctx) => { ctx.throw(401, '未授权'); }, open() { } });
    const behavior = getBehavior(app, '/secure');
    const res = mockUpgradeRes();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    await behavior.upgrade(res, mockUpgradeReq('/secure', { 'sec-websocket-key': 'K' }), {});

    expect(res.upgrade).not.toHaveBeenCalled();
    expect(res.writeStatus).toHaveBeenCalledWith('401');
    errorSpy.mockRestore();
  });

  it('升级中间件显式设置状态码即拒绝升级', async () => {
    app.ws('/gated', {
      upgrade: (ctx) => { ctx.status = 403; ctx.body = { error: 'nope' }; },
      open() { },
    });
    const behavior = getBehavior(app, '/gated');
    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/gated', { 'sec-websocket-key': 'K' }), {});

    expect(res.upgrade).not.toHaveBeenCalled();
    expect(res.writeStatus).toHaveBeenCalledWith('403');
  });

  it('open/message 共享 ctx 与 state，message 默认收到 Buffer', async () => {
    let openCtx, msgCtx, msgData, isBin;
    app.ws('/chat/:room', {
      upgrade: async (ctx, next) => { ctx.state.user = 'bob'; await next(); },
      open(ctx) { openCtx = ctx; ctx.subscribe('room:' + ctx.request.params.room); },
      message(ctx, data, binary) { msgCtx = ctx; msgData = data; isBin = binary; },
    });
    const behavior = getBehavior(app, '/chat/:room');

    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/chat/lobby', { 'sec-websocket-key': 'K' }), {});
    const ws = mockWs(res.upgrade.mock.calls[0][0]); // { carry }

    behavior.open(ws);
    expect(openCtx.state.user).toBe('bob');
    expect(openCtx.request.params.room).toBe('lobby');
    expect(ws.subscribe).toHaveBeenCalledWith('room:lobby');

    behavior.message(ws, toArrayBuffer('hi'), false);
    expect(Buffer.isBuffer(msgData)).toBe(true);
    expect(msgData.toString()).toBe('hi');
    expect(isBin).toBe(false);
    expect(msgCtx).toBe(openCtx); // 同一连接复用同一个 ctx
  });

  it('config.rawMessage=true 时 message 收到原始 ArrayBuffer(零拷贝)', async () => {
    let received;
    app.ws('/raw', {
      config: { rawMessage: true },
      open() { }, message(ctx, data) { received = data; },
    });
    const behavior = getBehavior(app, '/raw');
    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/raw', { 'sec-websocket-key': 'K' }), {});
    const ws = mockWs(res.upgrade.mock.calls[0][0]);
    behavior.open(ws);

    const ab = toArrayBuffer('bytes');
    behavior.message(ws, ab, true);
    expect(received).toBe(ab);
  });

  it('ctx.send / ctx.publish 会把对象序列化为 JSON；app.publish 委派给 uWS', async () => {
    let ctxRef;
    app.ws('/x', { open(ctx) { ctxRef = ctx; }, message() { } });
    const behavior = getBehavior(app, '/x');
    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/x', { 'sec-websocket-key': 'K' }), {});
    const ws = mockWs(res.upgrade.mock.calls[0][0]);
    behavior.open(ws);

    ctxRef.send({ a: 1 });
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ a: 1 }), false, false);

    ctxRef.publish('t', { b: 2 });
    expect(ws.publish).toHaveBeenCalledWith('t', JSON.stringify({ b: 2 }), false, false);

    app.publish('topic', { c: 3 });
    expect(app.getUWebSocketApp().publish).toHaveBeenCalledWith('topic', JSON.stringify({ c: 3 }), false, false);
  });

  it('wsUse 全局中间件在路由 upgrade 中间件之前执行', async () => {
    const order = [];
    app.wsUse(async (ctx, next) => { order.push('global'); await next(); });
    app.ws('/y', {
      upgrade: async (ctx, next) => { order.push('route'); await next(); },
      open() { }, message() { },
    });
    const behavior = getBehavior(app, '/y');
    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/y', { 'sec-websocket-key': 'K' }), {});

    expect(order).toEqual(['global', 'route']);
    expect(res.upgrade).toHaveBeenCalled();
  });

  it('config 透传给 uWS(idleTimeout/maxBackpressure)，但 rawMessage 不透传', () => {
    app.ws('/cfg', {
      config: { idleTimeout: 60, maxBackpressure: 1024, sendPingsAutomatically: true, rawMessage: true },
      message() { },
    });
    const behavior = getBehavior(app, '/cfg');
    expect(behavior.idleTimeout).toBe(60);
    expect(behavior.maxBackpressure).toBe(1024);
    expect(behavior.sendPingsAutomatically).toBe(true);
    expect(behavior.rawMessage).toBeUndefined(); // 自定义字段不应泄漏给 uWS
  });

  it('ctx.send 透传 uWS 发送状态；getBufferedAmount/ping/cork 委派到 ws', async () => {
    let ctxRef;
    app.ws('/bp', { open(ctx) { ctxRef = ctx; }, message() { } });
    const behavior = getBehavior(app, '/bp');
    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/bp', { 'sec-websocket-key': 'K' }), {});
    // 模拟一个处于背压状态(send 返回 0=BACKPRESSURE)的连接
    const ws = mockWs(res.upgrade.mock.calls[0][0], 0);
    behavior.open(ws);

    expect(ctxRef.send('x')).toBe(uWebKoa.SendStatus.BACKPRESSURE);
    expect(ctxRef.getBufferedAmount()).toBe(42);
    ctxRef.ping();
    expect(ws.ping).toHaveBeenCalled();
    let corked = false;
    ctxRef.cork(() => { corked = true; });
    expect(corked).toBe(true);
  });

  it('ping/pong/dropped 生命周期回调被正确接线', async () => {
    const seen = {};
    app.ws('/lc', {
      open() { }, message() { },
      ping(ctx, msg) { seen.ping = msg; },
      pong(ctx, msg) { seen.pong = msg; },
      dropped(ctx, data) { seen.dropped = data; },
    });
    const behavior = getBehavior(app, '/lc');
    const res = mockUpgradeRes();
    await behavior.upgrade(res, mockUpgradeReq('/lc', { 'sec-websocket-key': 'K' }), {});
    const ws = mockWs(res.upgrade.mock.calls[0][0]);
    behavior.open(ws);

    behavior.ping(ws, toArrayBuffer('p'));
    behavior.pong(ws, toArrayBuffer('q'));
    behavior.dropped(ws, toArrayBuffer('d'), false);

    expect(seen.ping.toString()).toBe('p');
    expect(seen.pong.toString()).toBe('q');
    expect(Buffer.isBuffer(seen.dropped)).toBe(true);
    expect(seen.dropped.toString()).toBe('d');
  });

  it('SendStatus 常量可用且被冻结', () => {
    expect(uWebKoa.SendStatus).toEqual({ BACKPRESSURE: 0, SUCCESS: 1, DROPPED: 2 });
    expect(Object.isFrozen(uWebKoa.SendStatus)).toBe(true);
  });
});
