import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import uWebKoa from '@/uWebKoa.js';

// 模拟 uWebSockets.js
vi.mock('uWebSockets.js', () => {
  return {
    App: vi.fn(() => ({
      any: vi.fn(),
      listen: vi.fn((port, cb) => {
        cb(true);
        return { token: true };
      }),
      getDescriptor: vi.fn(() => ({})),
      addChildAppDescriptor: vi.fn()
    })),
    SSLApp: vi.fn(() => ({
      any: vi.fn(),
      listen: vi.fn((port, cb) => {
        cb(true);
        return { token: true };
      }),
      getDescriptor: vi.fn(() => ({})),
      addChildAppDescriptor: vi.fn()
    }))
  };
});

// 创建模拟请求和响应对象
function createMockReq(method = 'GET', url = '/', headers = {}, query = '') {
  return {
    getMethod: vi.fn(() => method),
    getUrl: vi.fn(() => url),
    getQuery: vi.fn(() => query),
    getHeader: vi.fn((name) => headers[name] || ''),
    forEach: vi.fn((cb) => {
      Object.entries(headers).forEach(([key, value]) => {
        cb(key, value);
      });
    })
  };
}

function createMockRes() {
  return {
    aborted: false,
    onData: vi.fn((cb) => {
      // 模拟数据到达
      const buffer = Buffer.from('{"test":"data"}');
      cb(buffer, true);
    }),
    onAborted: vi.fn(function(cb) { // 将箭头函数改为普通函数
      this.abortCb = cb; // 此时 this 指向 res 对象
    }),
    writeStatus: vi.fn(),
    writeHeader: vi.fn(),
    end: vi.fn(),
    cork: vi.fn((cb) => cb()),
    getRemoteAddressAsText: () => Buffer.from('203.0.113.7'),
    sendFile: vi.fn()
  };
}

describe('uWebKoa', () => {
  let app;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    app = new uWebKoa({ disableDefaultErrorHandler: true });
    mockReq = createMockReq();
    mockRes = createMockRes();
    vi.clearAllMocks();
  });

  describe('基础功能', () => {
    it('应该创建一个新的 uWebKoa 实例', () => {
      expect(app).toBeInstanceOf(uWebKoa);
      expect(app.middlewares).toEqual([]);
      expect(app.context).toEqual({});
    });

    it('应该添加中间件', () => {
      const middleware = vi.fn();
      app.use(middleware);
      expect(app.middlewares).toContain(middleware);
    });

    it('应该创建上下文对象', () => {
      const ctx = app.createContext(mockRes, mockReq);
      expect(ctx.req).toBe(mockReq);
      expect(ctx.res).toBe(mockRes);
      expect(ctx.request.url).toBe('/');
      expect(ctx.request.method).toBe('GET');
    });
  });

  describe('中间件执行', () => {
    it('应该按顺序执行中间件', async () => {
      const order = [];

      app.use(async (ctx, next) => {
        order.push(1);
        await next();
        order.push(3);
      });

      app.use(async (ctx, next) => {
        order.push(2);
      });

      await app.handleRequest(mockRes, mockReq);

      expect(order).toEqual([1, 2, 3]);
    });

    it('应该在中间件中修改上下文', async () => {
      app.use(async (ctx, next) => {
        ctx.response.status = 201;
        ctx.response.body = { success: true };
        await next();
      });

      await app.handleRequest(mockRes, mockReq);

      expect(mockRes.writeStatus).toHaveBeenCalledWith('201');
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ success: true }));
    });
  });

  describe('路由功能', () => {
    it('应该匹配简单路由', () => {
      expect(app.matchPattern('/users', '/users')).toBe(true);
      expect(app.matchPattern('/users', '/posts')).toBe(false);
    });

    it('应该匹配带参数的路由', () => {
      expect(app.matchPattern('/users/123', '/users/:id')).toBe(true);
      expect(app.matchPattern('/users/123/posts', '/users/:id/posts')).toBe(true);
    });

    it('应该处理 GET 请求', async () => {
      const handler = vi.fn(ctx => {
        ctx.json({ success: true });
      });

      app.get('/test', handler);

      const req = createMockReq('GET', '/test');
      await app.handleRequest(mockRes, req);

      expect(handler).toHaveBeenCalled();
      expect(mockRes.writeHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    });

    it('应该处理 POST 请求', async () => {
      const handler = vi.fn(ctx => {
        ctx.json({ success: true });
      });

      app.post('/test', handler);

      const req = createMockReq('POST', '/test');
      await app.handleRequest(mockRes, req);

      expect(handler).toHaveBeenCalled();
    });

    it('应该解析路径参数', async () => {
      let params;

      app.get('/users/:id', ctx => {
        params = ctx.request.params;
        ctx.json({ success: true });
      });

      const req = createMockReq('GET', '/users/123');
      await app.handleRequest(mockRes, req);

      expect(params).toEqual({ id: '123' });
    });
  });

  describe('请求处理', () => {
    it('应该解析查询参数', async () => {
      let query;

      app.get('/search', ctx => {
        query = ctx.request.query;
        ctx.json({ success: true });
      });

      const req = createMockReq('GET', '/search', {}, 'q=test&page=1');
      await app.handleRequest(mockRes, req);

      expect(query).toEqual({ q: 'test', page: '1' });
    });

    it('应该解析 JSON 请求体', async () => {
      let body;

      app.post('/api', ctx => {
        body = ctx.request.body;
        ctx.json({ success: true });
      });

      const req = createMockReq('POST', '/api', { 'content-type': 'application/json' });
      await app.handleRequest(mockRes, req);

      expect(body).toEqual({ test: 'data' });
    });

    it('应该处理请求中止', async () => {
      const middleware = vi.fn(async (ctx, next) => {
        // 触发中断回调（正确方式）
        if (ctx.res.abortCb) {
          ctx.res.abortCb();
        }
        await next();
      });

      app.use(middleware);

      // 清除之前的调用记录
      mockRes.end.mockClear();

      await app.handleRequest(mockRes, mockReq);

      // 中间件应该被调用，但不应该发送响应
      expect(middleware).toHaveBeenCalled();
      expect(mockRes.end).not.toHaveBeenCalled();
    });
    it('应该优雅处理请求中途中断', async () => {
      // 模拟一个延迟执行的中间件
      const delayMiddleware = vi.fn(async (ctx, next) => {
        // 触发中断回调（正确方式）
        if (ctx.res.abortCb) {
          ctx.res.abortCb();
        }
        await next();
      });

      app.use(delayMiddleware);
      app.use(ctx => {
        ctx.json({ success: true });
      });

      // 清除之前的调用记录
      mockRes.end.mockClear();

      await app.handleRequest(mockRes, mockReq);

      // 验证中间件被调用但响应未发送
      expect(delayMiddleware).toHaveBeenCalled();
      expect(mockRes.end).not.toHaveBeenCalled();
    });
    // 新增测试用例：处理错误的JSON请求体
    it('应该处理错误的JSON请求体', async () => {
      let body;

      app.post('/api', ctx => {
        body = ctx.request.body;
        ctx.json({ success: true });
      });

      // 创建带有错误JSON的请求
      const mockReqWithInvalidJSON = createMockReq('POST', '/api', { 'content-type': 'application/json' });

      // 覆盖onData方法，返回无效的JSON
      mockRes.onData = vi.fn((cb) => {
        const buffer = Buffer.from('{invalid:json}');
        cb(buffer, true);
      });

      // 捕获控制台错误
      // 正确地模拟 console.error
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      await app.handleRequest(mockRes, mockReqWithInvalidJSON);

      // 验证错误被捕获且请求体被设置为原始字符串
      expect(errorSpy).toHaveBeenCalled();
      expect(body).toBe('{invalid:json}');

      // 恢复 console.error
      errorSpy.mockRestore();
    });
    // 新增测试用例：处理URL编码表单数据
    it('应该解析URL编码表单数据', async () => {
      let body;

      app.post('/form', ctx => {
        body = ctx.request.body;
        ctx.json({ success: true });
      });

      // 创建带有表单数据的请求
      const mockReqWithForm = createMockReq('POST', '/form', { 'content-type': 'application/x-www-form-urlencoded' });

      // 覆盖onData方法，返回表单数据
      mockRes.onData = vi.fn((cb) => {
        const buffer = Buffer.from('name=test&age=25');
        cb(buffer, true);
      });

      await app.handleRequest(mockRes, mockReqWithForm);

      // 验证表单数据被正确解析
      expect(body).toEqual({ name: 'test', age: '25' });
    });

  });

  describe('基础功能', () => {
    it('应该创建一个新的 uWebKoa 实例', () => {
      expect(app).toBeInstanceOf(uWebKoa);
      expect(app.middlewares).toEqual([]);
      expect(app.context).toEqual({});
    });

    it('应该添加中间件', () => {
      const middleware = vi.fn();
      app.use(middleware);
      expect(app.middlewares).toContain(middleware);
    });

    it('应该创建上下文对象', () => {
      const ctx = app.createContext(mockRes, mockReq);
      expect(ctx.req).toBe(mockReq);
      expect(ctx.res).toBe(mockRes);
      expect(ctx.request.url).toBe('/');
      expect(ctx.request.method).toBe('GET');
    });

    it('应该合并全局上下文到请求上下文', () => {
      // 设置全局上下文
      app.context = {
        db: { query: vi.fn() },
        config: { apiVersion: 'v1' },
        utils: { formatDate: vi.fn() }
      };

      const ctx = app.createContext(mockRes, mockReq);

      // 验证全局上下文被合并到请求上下文
      expect(ctx.db).toBeDefined();
      expect(ctx.config).toBeDefined();
      expect(ctx.utils).toBeDefined();
      expect(ctx.db.query).toBeDefined();
      expect(ctx.config.apiVersion).toBe('v1');
      expect(ctx.utils.formatDate).toBeDefined();
    });
  });

  describe('静态文件服务', () => {
    it('应该设置静态文件服务中间件', () => {
      app.serveStatic('/static', './public');
      expect(app.middlewares.length).toBe(1);
    });

    it('应该拒绝无效的根目录', () => {
      expect(() => app.serveStatic('/static', '')).toThrow();
      expect(() => app.serveStatic('/static', '/')).toThrow();
    });

    it('应该处理静态文件请求', async () => {
      // 重置中间件
      app.middlewares = [];

      app.serveStatic('/static', './public');

      // 创建模拟上下文（带GET方法和匹配URL）
      const ctx = app.createContext(
        mockRes,
        createMockReq('GET', '/static/image.jpg')
      );

      // 模拟sendFile方法
      ctx.sendFile = vi.fn().mockResolvedValue(true);

      // 执行中间件
      await app.middlewares[0](ctx, vi.fn());

      // 验证调用参数（兼容Windows路径）
      expect(ctx.sendFile).toHaveBeenCalledWith(
        expect.stringMatching(/public[\\/]image\.jpg$/)
      );
    });

    it('应该阻止目录遍历攻击', async () => {
      app.serveStatic('/static', './public');

      // 模拟 ctx.send 方法以捕获状态码
      const originalSend = mockRes.cork;
      mockRes.cork = vi.fn(cb => {
        cb();
        return mockRes;
      });

      const req = createMockReq('GET', '/static/../config.js');
      await app.handleRequest(mockRes, req);

      // 检查是否设置了 403 状态码
      expect(mockRes.writeStatus).toHaveBeenCalledWith('403');

      // 恢复原始方法
      mockRes.cork = originalSend;
    });
  });

  describe('服务器启动', () => {
    it('应该创建 uWebSockets.js 应用', async () => {
      const uWebApp = await app.createApp();
      expect(uWebApp).toBeDefined();
    });

    it('应该启动服务器', async () => {
      const uWebApp = await app.createApp();
      const result = await app.listen(uWebApp, 3000);
      expect(result).toBeTruthy();
    });
  });

  describe('错误处理', () => {
    it('应该捕获中间件中的错误', async () => {
      app.use(() => {
        throw new Error('测试错误');
      });

      console.error = vi.fn(); // 抑制控制台错误输出

      await app.handleRequest(mockRes, mockReq);

      expect(mockRes.writeStatus).toHaveBeenCalledWith('500');
    });

    it('应该支持 throw 方法', async () => {
      app.use(ctx => {
        ctx.throw(404, '未找到');
      });

      console.error = vi.fn(); // 抑制控制台错误输出

      await app.handleRequest(mockRes, mockReq);

      expect(mockRes.writeStatus).toHaveBeenCalledWith('404');
    });
  });

  describe('参数验证', () => {
    // 模拟 yup 验证中间件
    const mockValidate = (schema, type) => {
      return async (ctx, next) => {
        try {
          // 模拟验证逻辑
          const dataToValidate = type === 'query' ? ctx.request.query :
            type === 'params' ? ctx.request.params :
              ctx.request.body;

          // 简单验证：检查必需字段是否存在
          if (type === 'query') {
            if (!dataToValidate.page) {
              ctx.status = 400;
              ctx.json({ success: false, error: '页码参数是必需的' });
              return;
            }
            if (!dataToValidate.limit) {
              ctx.status = 400;
              ctx.json({ success: false, error: '每页数量参数是必需的' });
              return;
            }
            // 检查是否为数字
            if (!/^\d+$/.test(dataToValidate.page)) {
              ctx.status = 400;
              ctx.json({ success: false, error: '页码必须是数字' });
              return;
            }
            if (!/^\d+$/.test(dataToValidate.limit)) {
              ctx.status = 400;
              ctx.json({ success: false, error: '每页数量必须是数字' });
              return;
            }
          }

          await next();
        } catch (error) {
          ctx.status = 400;
          ctx.json({ success: false, error: error.message });
        }
      };
    };

    it('应该验证有效的查询参数', async () => {
      let responseData;

      app.get('/api/users',
        mockValidate({ page: true, limit: true }, 'query'),
        ctx => {
          const { page, limit } = ctx.request.query;
          responseData = {
            success: true,
            message: '获取用户列表成功',
            data: { page, limit, total: 100, items: [] }
          };
          ctx.json(responseData);
        }
      );

      const req = createMockReq('GET', '/api/users', {}, 'page=1&limit=10');
      await app.handleRequest(mockRes, req);

      expect(mockRes.writeStatus).toHaveBeenCalledWith('200');
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(responseData));
      expect(responseData.data).toEqual({ page: '1', limit: '10', total: 100, items: [] });
    });

    it('应该拒绝缺少必需查询参数的请求', async () => {
      app.get('/api/users',
        mockValidate({ page: true, limit: true }, 'query'),
        ctx => {
          const { page, limit } = ctx.request.query;
          ctx.json({
            success: true,
            message: '获取用户列表成功',
            data: { page, limit, total: 100, items: [] }
          });
        }
      );

      // 缺少 limit 参数
      const req = createMockReq('GET', '/api/users', {}, 'page=1');
      await app.handleRequest(mockRes, req);

      expect(mockRes.writeStatus).toHaveBeenCalledWith('400');
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: '每页数量参数是必需的'
      }));
    });

    it('应该拒绝无效格式的查询参数', async () => {
      app.get('/api/users',
        mockValidate({ page: true, limit: true }, 'query'),
        ctx => {
          const { page, limit } = ctx.request.query;
          ctx.json({
            success: true,
            message: '获取用户列表成功',
            data: { page, limit, total: 100, items: [] }
          });
        }
      );

      // page 参数不是数字
      const req = createMockReq('GET', '/api/users', {}, 'page=abc&limit=10');
      await app.handleRequest(mockRes, req);

      expect(mockRes.writeStatus).toHaveBeenCalledWith('400');
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        success: false,
        error: '页码必须是数字'
      }));
    });
  });

  describe('重定向与 assert', () => {
    it('redirect 应设置 302 与 Location 头', async () => {
      app.use(ctx => { ctx.redirect('/login'); });
      await app.handleRequest(mockRes, mockReq);
      expect(mockRes.writeStatus).toHaveBeenCalledWith('302');
      expect(mockRes.writeHeader).toHaveBeenCalledWith('Location', '/login');
      expect(mockRes.end).toHaveBeenCalledWith('Redirecting to /login');
    });

    it('redirect 支持自定义状态码(301)', async () => {
      app.use(ctx => { ctx.redirect('/new', 301); });
      await app.handleRequest(mockRes, mockReq);
      expect(mockRes.writeStatus).toHaveBeenCalledWith('301');
    });

    it('assert 条件为假时应以对应状态码返回', async () => {
      app.use(ctx => { ctx.assert(false, 403, '禁止访问'); });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      await app.handleRequest(mockRes, mockReq);
      expect(mockRes.writeStatus).toHaveBeenCalledWith('403');
      errorSpy.mockRestore();
    });

    it('assert 条件为真时应继续执行', async () => {
      app.use(ctx => { ctx.assert(true, 400, '不应触发'); ctx.json({ ok: true }); });
      await app.handleRequest(mockRes, mockReq);
      expect(mockRes.writeStatus).toHaveBeenCalledWith('200');
    });
  });

  describe('更多路由方法与匹配', () => {
    it('应该处理 PUT 请求并解析参数', async () => {
      let id;
      app.put('/item/:id', ctx => { id = ctx.request.params.id; ctx.json({ m: 'put' }); });
      const res = createMockRes();
      await app.handleRequest(res, createMockReq('PUT', '/item/7'));
      expect(id).toBe('7');
      expect(res.writeStatus).toHaveBeenCalledWith('200');
    });

    it('应该处理 DELETE 请求', async () => {
      let hit = false;
      app.delete('/item/:id', ctx => { hit = true; ctx.json({ m: 'del' }); });
      const res = createMockRes();
      await app.handleRequest(res, createMockReq('DELETE', '/item/9'));
      expect(hit).toBe(true);
    });

    it('路径参数应进行 URL 解码', async () => {
      let name;
      app.get('/u/:name', ctx => { name = ctx.request.params.name; ctx.json({ ok: true }); });
      const res = createMockRes();
      await app.handleRequest(res, createMockReq('GET', '/u/hello%20world'));
      expect(name).toBe('hello world');
    });

    it('应该匹配通配符路由', () => {
      expect(app.matchPattern('/files/a/b.txt', '/files/*')).toBe(true);
      expect(app.matchPattern('/files', '/files/*')).toBe(true);
      expect(app.matchPattern('/other', '/files/*')).toBe(false);
      expect(app.matchPattern('/a/b', '/a/*')).toBe(true);
    });
  });

  describe('默认 404', () => {
    it('未匹配任何路由时应返回 404', async () => {
      app.get('/exists', ctx => ctx.json({ ok: true }));
      const res = createMockRes();
      await app.handleRequest(res, createMockReq('GET', '/nope'));
      expect(res.writeStatus).toHaveBeenCalledWith('404');
    });

    it('显式设置状态码时不应被 404 覆盖', async () => {
      app.use(ctx => { ctx.status = 204; });
      const res = createMockRes();
      await app.handleRequest(res, createMockReq('GET', '/'));
      expect(res.writeStatus).toHaveBeenCalledWith('204');
    });
  });

  describe('资源与生命周期', () => {
    it('每个请求只注册一次 res.onAborted', async () => {
      app.post('/p', ctx => ctx.json({ ok: true }));
      let count = 0;
      const res = createMockRes();
      res.onAborted = vi.fn(function (cb) { count++; this.abortCb = cb; });
      await app.handleRequest(res, createMockReq('POST', '/p', { 'content-type': 'application/json' }));
      expect(count).toBe(1);
    });

    it('中间件正常完成后不残留超时计时器', async () => {
      vi.useFakeTimers();
      try {
        const a = new uWebKoa({ disableDefaultErrorHandler: true, timeout: { request: 30000, middleware: 5000 } });
        a.get('/x', ctx => ctx.json({ ok: true }));
        const res = createMockRes();
        await a.handleRequest(res, createMockReq('GET', '/x'));
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });

    it('中间件执行超时应返回 503(显式配置 timeout.middleware)', async () => {
      const a = new uWebKoa({ disableDefaultErrorHandler: true, timeout: { request: 30000, middleware: 20 } });
      a.use(async (ctx, next) => {
        await new Promise(r => setTimeout(r, 60));
        ctx.json({ ok: true });
      });
      const res = createMockRes();
      await a.handleRequest(res, createMockReq('GET', '/'));
      expect(res.writeStatus).toHaveBeenCalledWith('503');
    });

    it('默认关闭中间件超时：慢中间件不触发 503，也不创建链级计时器', async () => {
      vi.useFakeTimers();
      try {
        // 默认 timeout.middleware = 0 (关闭)
        const a = new uWebKoa({ disableDefaultErrorHandler: true });
        a.use(async (ctx) => { ctx.json({ ok: true }); });
        const res = createMockRes();
        await a.handleRequest(res, createMockReq('GET', '/'));
        // 只应有 handleRequest 的请求级计时器，且已在 finally 清除 => 0
        expect(vi.getTimerCount()).toBe(0);
        expect(res.writeStatus).toHaveBeenCalledWith('200');
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    });
  });

  describe('请求体处理边界', () => {
    it('请求体超过 10MB 上限应返回 413', async () => {
      app.post('/upload', ctx => ctx.json({ ok: true }));
      const res = createMockRes();
      res.onData = vi.fn(cb => { cb(Buffer.alloc(10 * 1024 * 1024 + 16), true); });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      await app.handleRequest(res, createMockReq('POST', '/upload', { 'content-type': 'application/octet-stream' }));
      expect(res.writeStatus).toHaveBeenCalledWith('413');
      errorSpy.mockRestore();
    });

    it('应正确拼接多个数据分片', async () => {
      let body;
      app.post('/api', ctx => { body = ctx.request.body; ctx.json({ ok: true }); });
      const res = createMockRes();
      res.onData = vi.fn(cb => {
        cb(Buffer.from('{"a":1,'), false);
        cb(Buffer.from('"b":2}'), true);
      });
      await app.handleRequest(res, createMockReq('POST', '/api', { 'content-type': 'application/json' }));
      expect(body).toEqual({ a: 1, b: 2 });
    });
  });

  describe('SSL', () => {
    it('提供 SSL 配置时应创建 SSLApp', async () => {
      const uws = await import('uWebSockets.js');
      uws.SSLApp.mockClear();
      const sslApp = new uWebKoa({
        disableDefaultErrorHandler: true,
        ssl: { key_file_name: 'k', cert_file_name: 'c' }
      });
      expect(uws.SSLApp).toHaveBeenCalledTimes(1);
      expect(sslApp.getUWebSocketApp()).toBeDefined();
    });
  });

  describe('sendFile 文件发送', () => {
    it('应发送小文件(<=1MB)', async () => {
      const { tmpdir } = await import('os');
      const fsMod = await import('fs');
      const pathMod = await import('path');
      const tmp = pathMod.join(tmpdir(), `uwebkoa-small-${Date.now()}.txt`);
      fsMod.writeFileSync(tmp, 'hello small file');
      try {
        const res = createMockRes();
        const ctx = app.createContext(res, createMockReq('GET', '/'));
        const ok = await ctx.sendFile(tmp);
        expect(ok).toBe(true);
        expect(res.writeStatus).toHaveBeenCalledWith('200 OK');
        expect(res.writeHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
        const sent = res.end.mock.calls[0][0];
        expect(Buffer.from(sent).toString()).toBe('hello small file');
      } finally {
        fsMod.unlinkSync(tmp);
      }
    });

    it('应流式发送大文件并处理背压', async () => {
      const { tmpdir } = await import('os');
      const fsMod = await import('fs');
      const pathMod = await import('path');
      const size = 1.5 * 1024 * 1024; // 1.5MB，超过 1MB 小文件阈值
      const content = Buffer.alloc(size, 0x61);
      const tmp = pathMod.join(tmpdir(), `uwebkoa-large-${Date.now()}.bin`);
      fsMod.writeFileSync(tmp, content);
      try {
        // 模拟 uWebSockets.js 的背压语义：首次 tryEnd 制造一次背压，随后经 onWritable 排空
        const received = [];
        let confirmed = 0;
        let writableCb = null;
        let backpressureUsed = false;
        const res = {
          onAborted(cb) { this.abortCb = cb; },
          cork(cb) { cb(); },
          writeStatus: vi.fn(),
          writeHeader: vi.fn(),
          end: vi.fn(),
          onWritable(cb) { writableCb = cb; return this; },
          tryEnd(chunk, totalSize) {
            if (!backpressureUsed) {
              backpressureUsed = true;
              queueMicrotask(() => {
                const cb = writableCb; writableCb = null;
                if (cb) cb(confirmed);
              });
              return [false, false];
            }
            received.push(Buffer.from(chunk));
            confirmed += chunk.length;
            return [true, confirmed >= totalSize];
          }
        };
        const ctx = app.createContext(res, createMockReq('GET', '/'));
        const ok = await ctx.sendFile(tmp);
        expect(ok).toBe(true);
        expect(res.writeStatus).toHaveBeenCalledWith('200 OK');
        expect(backpressureUsed).toBe(true);
        const assembled = Buffer.concat(received);
        expect(assembled.length).toBe(size);
        expect(assembled.equals(content)).toBe(true);
      } finally {
        fsMod.unlinkSync(tmp);
      }
    });

    it('文件不存在时应返回 404', async () => {
      const res = createMockRes();
      const ctx = app.createContext(res, createMockReq('GET', '/'));
      const ok = await ctx.sendFile('this/file/does/not/exist-xyz.txt');
      expect(ok).toBe(false);
      expect(res.writeStatus).toHaveBeenCalledWith('404');
    });
  });

  describe('Koa 兼容功能 (cookies / ip / 自动 Content-Type)', () => {
    it('ctx.ip 返回客户端地址', () => {
      const ctx = app.createContext(createMockRes(), createMockReq('GET', '/'));
      expect(ctx.ip).toBe('203.0.113.7');
    });

    it('ctx.get 读取请求头(不区分大小写)', () => {
      const ctx = app.createContext(createMockRes(), createMockReq('GET', '/', { 'x-custom': 'yes' }));
      expect(ctx.get('X-Custom')).toBe('yes');
    });

    it('ctx.cookies.get 解析 Cookie 头', () => {
      const req = createMockReq('GET', '/', { cookie: 'sid=abc123; theme=dark' });
      const ctx = app.createContext(createMockRes(), req);
      expect(ctx.cookies.get('sid')).toBe('abc123');
      expect(ctx.cookies.get('theme')).toBe('dark');
      expect(ctx.cookies.get('nope')).toBeUndefined();
    });

    it('ctx.cookies.set 支持多个 Set-Cookie 并逐个写出', async () => {
      const res = createMockRes();
      app.use((ctx) => {
        ctx.cookies.set('a', '1', { path: '/' });
        ctx.cookies.set('b', '2', { httpOnly: false, sameSite: 'Lax' });
        ctx.json({ ok: true });
      });
      await app.handleRequest(res, createMockReq('GET', '/'));
      const setCookieCalls = res.writeHeader.mock.calls.filter((c) => c[0] === 'Set-Cookie');
      expect(setCookieCalls.length).toBe(2);
      expect(setCookieCalls[0][1]).toContain('a=1');
      expect(setCookieCalls[0][1]).toContain('HttpOnly'); // 默认 HttpOnly
      expect(setCookieCalls[1][1]).toContain('b=2');
      expect(setCookieCalls[1][1]).toContain('SameSite=Lax');
      expect(setCookieCalls[1][1]).not.toContain('HttpOnly'); // httpOnly:false 关闭
    });

    it('对象 body 自动推断为 application/json', async () => {
      const res = createMockRes();
      app.use((ctx) => { ctx.body = { a: 1 }; });
      await app.handleRequest(res, createMockReq('GET', '/'));
      expect(res.writeHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    });

    it('字符串 body：< 开头 -> text/html，否则 text/plain', async () => {
      const r1 = createMockRes();
      const a1 = new uWebKoa({ disableDefaultErrorHandler: true });
      a1.use((ctx) => { ctx.body = '<h1>hi</h1>'; });
      await a1.handleRequest(r1, createMockReq('GET', '/'));
      expect(r1.writeHeader).toHaveBeenCalledWith('Content-Type', 'text/html');

      const r2 = createMockRes();
      const a2 = new uWebKoa({ disableDefaultErrorHandler: true });
      a2.use((ctx) => { ctx.body = 'plain'; });
      await a2.handleRequest(r2, createMockReq('GET', '/'));
      expect(r2.writeHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
    });

    it('Buffer body 原样发送并推断为 application/octet-stream', async () => {
      const res = createMockRes();
      const payload = Buffer.from('binary-data');
      app.use((ctx) => { ctx.body = payload; });
      await app.handleRequest(res, createMockReq('GET', '/'));
      expect(res.writeHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
      expect(res.end).toHaveBeenCalledWith(payload);
    });

    it('显式设置 Content-Type 时不被自动推断覆盖', async () => {
      const res = createMockRes();
      app.use((ctx) => { ctx.set('Content-Type', 'application/xml'); ctx.body = '<x/>'; });
      await app.handleRequest(res, createMockReq('GET', '/'));
      expect(res.writeHeader).toHaveBeenCalledWith('Content-Type', 'application/xml');
      expect(res.writeHeader).not.toHaveBeenCalledWith('Content-Type', 'text/html');
    });
  });
});