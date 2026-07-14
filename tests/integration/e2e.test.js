// 端到端集成测试：使用真实的 uWebSockets.js，启动真实服务器并发起真实 HTTP 请求。
// 注意：本文件不 mock uWebSockets.js，与 tests/unit 里的 mock 相互独立(vitest 的 vi.mock 按文件隔离)。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import uWebKoa from '@/uWebKoa.js';
import { us_listen_socket_close } from 'uWebSockets.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const PORT = 43219;
const BASE = `http://127.0.0.1:${PORT}`;
const LARGE_SIZE = 5 * 1024 * 1024; // 5MB，超过 1MB 阈值，走大文件流式路径

let listenSocket = null;
let tmpDir = null;

beforeAll(async () => {
  // 准备静态资源目录
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uwebkoa-e2e-'));
  fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello world');
  fs.writeFileSync(path.join(tmpDir, 'big.bin'), Buffer.alloc(LARGE_SIZE, 0x41)); // 全 'A'

  const app = new uWebKoa();

  app.get('/hello', ctx => { ctx.json({ msg: 'hi', q: ctx.request.query }); });
  app.get('/users/:id', ctx => { ctx.json({ id: ctx.request.params.id }); });
  app.get('/decode/:name', ctx => { ctx.json({ name: ctx.request.params.name }); });
  app.post('/echo', ctx => { ctx.json({ received: ctx.request.body }); });
  app.put('/put/:id', ctx => { ctx.json({ method: 'PUT', id: ctx.request.params.id }); });
  app.delete('/del/:id', ctx => { ctx.json({ method: 'DELETE', id: ctx.request.params.id }); });
  app.get('/go', ctx => { ctx.redirect('/hello'); });
  app.get('/boom', ctx => { ctx.throw(418, 'teapot'); });
  app.serveStatic('/static', tmpDir);

  listenSocket = await app.listen(PORT);
  if (!listenSocket) {
    throw new Error(`无法在端口 ${PORT} 启动测试服务器(可能被占用)`);
  }
});

afterAll(() => {
  if (listenSocket) {
    us_listen_socket_close(listenSocket);
    listenSocket = null;
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('e2e (真实 uWebSockets.js)', () => {
  it('GET 路由 + 查询参数', async () => {
    const r = await fetch(`${BASE}/hello?a=1&b=two`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    const j = await r.json();
    expect(j.msg).toBe('hi');
    expect(j.q).toEqual({ a: '1', b: 'two' });
  });

  it('路径参数', async () => {
    const r = await fetch(`${BASE}/users/42`);
    expect(r.status).toBe(200);
    expect((await r.json()).id).toBe('42');
  });

  it('路径参数 URL 解码', async () => {
    const r = await fetch(`${BASE}/decode/hello%20world`);
    expect((await r.json()).name).toBe('hello world');
  });

  it('POST JSON 请求体', async () => {
    const r = await fetch(`${BASE}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 1, y: [2, 3], z: 'ok' })
    });
    expect(r.status).toBe(200);
    expect((await r.json()).received).toEqual({ x: 1, y: [2, 3], z: 'ok' });
  });

  it('PUT 与 DELETE', async () => {
    const rPut = await fetch(`${BASE}/put/7`, { method: 'PUT' });
    expect((await rPut.json())).toEqual({ method: 'PUT', id: '7' });
    const rDel = await fetch(`${BASE}/del/9`, { method: 'DELETE' });
    expect((await rDel.json())).toEqual({ method: 'DELETE', id: '9' });
  });

  it('未匹配路由返回 404', async () => {
    const r = await fetch(`${BASE}/nope`);
    expect(r.status).toBe(404);
  });

  it('redirect 返回 302 + Location', async () => {
    const r = await fetch(`${BASE}/go`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/hello');
  });

  it('ctx.throw 交由错误处理返回对应状态码', async () => {
    const r = await fetch(`${BASE}/boom`);
    expect(r.status).toBe(418);
    const j = await r.json();
    expect(j.success).toBe(false);
    expect(j.message).toBe('teapot');
  });

  it('静态小文件', async () => {
    const r = await fetch(`${BASE}/static/hello.txt`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('hello world');
  });

  it('静态大文件流式发送(5MB, 真实分块+背压路径)', async () => {
    const r = await fetch(`${BASE}/static/big.bin`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe(String(LARGE_SIZE));
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.length).toBe(LARGE_SIZE);
    // 首尾字节校验，确认内容完整无损
    expect(buf[0]).toBe(0x41);
    expect(buf[buf.length - 1]).toBe(0x41);
  });

  it('目录遍历不应泄露 root 之外的文件', async () => {
    // 用底层 http 请求绕过 fetch 客户端对 ../ 的规范化。
    // uWS 可能会规范化路径：被拦截时返回 403，被规范化后无匹配路由则 404 —— 两者都表示文件未被泄露。
    const { status, body } = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: '/static/../e2e.test.js', method: 'GET' },
        res => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect([403, 404]).toContain(status);
    expect(body).not.toContain('端到端集成测试'); // 不应把本测试文件内容返回出去
  });
});
