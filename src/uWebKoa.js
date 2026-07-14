/**
 * uWebKoa - 类似Koa的uWebSockets封装
 * 提供中间件支持和更简洁的API
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { App, SSLApp } from 'uWebSockets.js'

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取内容类型
const getContentType = (filePath) => {
    const extname = path.extname(filePath).toLowerCase();
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.txt': 'text/plain',
        '.pdf': 'application/pdf',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav'
    };
    return contentTypes[extname] || 'application/octet-stream';
};

// 添加全局错误处理器类
class ErrorHandler {
  static handleError(err, ctx) {
    if (!ctx || ctx._ended || ctx._aborted) return;
    
    // 记录错误
    console.error('请求处理错误:', err);
    
    // 设置状态和响应
    ctx.status = err.status || 500;
    const errorResponse = {
      success: false,
      message: err.message || '服务器内部错误',
      code: err.code || 'INTERNAL_ERROR'
    };
    
    // 在非生产环境下添加错误堆栈
    if (process.env.NODE_ENV !== 'production') {
      errorResponse.error = err.stack;
    }
    
    // 设置响应头和发送响应
    ctx.set('Content-Type', 'application/json');
    ctx.body = errorResponse;
    ctx.send();
    ctx._ended = true;
  }
}

// 对路径参数做安全 URL 解码
const decodeParam = (v) => {
    try { return decodeURIComponent(v); } catch { return v; }
};

/**
 * 基于路径分段的基数树(radix/trie)路由。
 * 匹配复杂度为 O(路径段数)，而不是 O(路由数量)；每个请求只做一次 split('/')。
 * 优先级：静态段 > :参数 > 通配符 *（与多数成熟框架一致）。
 */
class RadixRouter {
    constructor() {
        this.root = this._newNode();
    }

    _newNode() {
        return {
            statics: new Map(), // 静态子节点: segment -> node
            param: null,        // :param 子节点
            paramName: null,    // 参数名
            wildcard: null,     // * 子节点(匹配剩余全部)
            handlers: null,     // method(大写) -> Function[]
        };
    }

    /**
     * 注册路由
     * @param {string} method HTTP 方法(不区分大小写)
     * @param {string} pattern 路由模式，支持 :param 与结尾 /*
     * @param {Function[]} handlers 处理器数组
     */
    add(method, pattern, handlers) {
        const segments = pattern.split('/').filter(Boolean);
        let node = this.root;
        for (const seg of segments) {
            if (seg === '*') {
                node.wildcard = node.wildcard || this._newNode();
                node = node.wildcard;
                break; // 通配符吞掉剩余路径
            } else if (seg.startsWith(':')) {
                if (!node.param) {
                    node.param = this._newNode();
                    node.paramName = seg.slice(1);
                }
                node = node.param;
            } else {
                if (!node.statics.has(seg)) node.statics.set(seg, this._newNode());
                node = node.statics.get(seg);
            }
        }
        node.handlers = node.handlers || new Map();
        node.handlers.set(method.toUpperCase(), handlers);
    }

    /**
     * 查找匹配的路由
     * @returns {{handlers: Function[], params: Object}|null}
     */
    find(method, path) {
        const segments = path.split('/').filter(Boolean);
        const params = {};
        const node = this._walk(this.root, segments, 0, params);
        const m = method.toUpperCase();
        if (node && node.handlers && node.handlers.has(m)) {
            return { handlers: node.handlers.get(m), params };
        }
        return null;
    }

    _walk(node, segments, i, params) {
        if (i === segments.length) {
            if (node.handlers) return node;
            // 形如 /files/* 也应匹配 /files 本身
            if (node.wildcard && node.wildcard.handlers) return node.wildcard;
            return null;
        }
        const seg = segments[i];

        // 1) 静态段优先
        const staticChild = node.statics.get(seg);
        if (staticChild) {
            const r = this._walk(staticChild, segments, i + 1, params);
            if (r) return r;
        }
        // 2) 参数段
        if (node.param) {
            const had = Object.prototype.hasOwnProperty.call(params, node.paramName);
            const saved = params[node.paramName];
            params[node.paramName] = decodeParam(seg);
            const r = this._walk(node.param, segments, i + 1, params);
            if (r) return r;
            // 回溯
            if (had) params[node.paramName] = saved; else delete params[node.paramName];
        }
        // 3) 通配符：匹配剩余全部
        if (node.wildcard && node.wildcard.handlers) {
            return node.wildcard;
        }
        return null;
    }
}

// 解析 Cookie 请求头为对象
const parseCookieHeader = (raw) => {
    const out = {};
    if (!raw) return out;
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        const k = part.slice(0, i).trim();
        if (!k) continue;
        try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); }
        catch { out[k] = part.slice(i + 1).trim(); }
    }
    return out;
};

// 把一个 cookie 序列化为 Set-Cookie 头的值
const serializeCookie = (name, value, opts = {}) => {
    let s = `${name}=${encodeURIComponent(value)}`;
    if (opts.maxAge != null) s += `; Max-Age=${Math.floor(opts.maxAge)}`;
    if (opts.expires instanceof Date) s += `; Expires=${opts.expires.toUTCString()}`;
    if (opts.domain) s += `; Domain=${opts.domain}`;
    s += `; Path=${opts.path || '/'}`;
    if (opts.httpOnly !== false) s += '; HttpOnly'; // 默认 HttpOnly，传 false 关闭
    if (opts.secure) s += '; Secure';
    if (opts.sameSite) s += `; SameSite=${opts.sameSite === true ? 'Strict' : opts.sameSite}`;
    return s;
};

/**
 * HTTP 上下文的共享原型：所有方法与 getter/setter 只定义一次，
 * createContext 里用 Object.create(httpCtxProto) 生成实例，仅挂请求级数据字段，
 * 避免每个请求都重建十几个闭包函数与访问器。
 */
const httpCtxProto = {
    // —— 兼容 Koa 的属性访问器 ——
    get url() { return this.request.url; },
    get method() { return this.request.method; },
    get headers() { return this.request.headers; },
    get body() { return this.response.body; },
    set body(val) { this.response.body = val; },
    get status() { return this.response.status; },
    set status(code) {
        this.response.status = code;
        this._explicitStatus = true;
    },

    // 客户端 IP(取 socket 地址；默认不信任 X-Forwarded-For 以防伪造)。惰性计算并缓存。
    get ip() {
        if (this._ip === undefined) {
            try {
                this._ip = this.res ? Buffer.from(this.res.getRemoteAddressAsText()).toString() : '';
            } catch (e) {
                this._ip = '';
            }
        }
        return this._ip;
    },

    // Koa 风格的 cookie 读写：ctx.cookies.get(name) / ctx.cookies.set(name, value, opts)
    // set 支持多次调用(多个 Set-Cookie)。
    get cookies() {
        if (!this._cookieJar) {
            const ctx = this;
            this._cookieJar = {
                get(name) {
                    if (!ctx._parsedCookies) ctx._parsedCookies = parseCookieHeader(ctx.request.headers['cookie']);
                    return ctx._parsedCookies[name];
                },
                set(name, value, opts = {}) {
                    const cookie = serializeCookie(name, value, opts);
                    const headers = ctx.response.headers;
                    const existing = headers['Set-Cookie'];
                    if (existing === undefined) headers['Set-Cookie'] = [cookie];
                    else if (Array.isArray(existing)) existing.push(cookie);
                    else headers['Set-Cookie'] = [existing, cookie];
                    return ctx._cookieJar;
                },
            };
        }
        return this._cookieJar;
    },

    // 读取请求头(不区分大小写；uWebKoa 内部已把 header key 存为小写)
    get(field) {
        return this.request.headers[String(field).toLowerCase()];
    },

    // 注册中止回调。真正的 res.onAborted 只在 handleRequest 里注册一次，
    // 这里把回调收集起来，避免在同一个 uWebSockets res 上重复注册(会报错)。
    onAborted(handler) {
        if (typeof handler !== 'function') return this;
        if (this._aborted) {
            try { handler(); } catch (e) { console.error('中止回调执行出错:', e); }
            return this;
        }
        this._abortHandlers.push(handler);
        return this;
    },

    // 解析路径参数
    parseParams(pattern) {
        const url = this.request.url;
        const patternParts = pattern.split('/');
        const urlParts = url.split('/');

        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                const paramName = patternParts[i].substring(1);
                const rawValue = urlParts[i] || '';
                // 对路径参数做 URL 解码(如 /users/hello%20world -> "hello world")
                try {
                    this.request.params[paramName] = decodeURIComponent(rawValue);
                } catch (e) {
                    this.request.params[paramName] = rawValue;
                }
            }
        }
    },

    // 解析JSON请求体，改进的缓冲区管理
    async parseBody() {
        const contentType = this.request.headers['content-type'];
        const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
        let totalSize = 0;
        let buffer = null;
        let chunks = [];

        try {
            // GET/HEAD 请求或已中止请求直接返回
            if (this.request.method === 'GET' || this.request.method === 'HEAD' || this._aborted) {
                this.request.body = {};
                return;
            }

            return await new Promise((resolve, reject) => {
                // 解析数据
                this.res.onData((chunk, isLast) => {
                    try {
                        const curChunk = Buffer.from(new Uint8Array(chunk));
                        totalSize += curChunk.length;

                        if (totalSize > MAX_BODY_SIZE) {
                            // 清理资源
                            buffer = null;
                            chunks = [];
                            const err = new Error('请求体过大');
                            err.status = 413;
                            err.code = 'PAYLOAD_TOO_LARGE';
                            return reject(err);
                        }

                        chunks.push(curChunk);

                        if (isLast) {
                            try {
                                buffer = Buffer.concat(chunks);
                                chunks = []; // 清理临时数组

                                if (contentType && contentType.includes('application/json')) {
                                    try {
                                        this.request.body = JSON.parse(buffer.toString());
                                    } catch (e) {
                                        console.error('JSON解析错误:', e);
                                        this.request.body = buffer.toString();
                                    }
                                } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
                                    this.request.body = {};
                                    const formData = buffer.toString();
                                    const pairs = formData.split('&');
                                    pairs.forEach(pair => {
                                        const [key, value] = pair.split('=');
                                        if (key) {
                                            this.request.body[decodeURIComponent(key)] = decodeURIComponent(value || '');
                                        }
                                    });
                                } else {
                                    this.request.body = buffer.toString();
                                }

                                // 释放资源
                                buffer = null;
                                resolve();
                            } catch (e) {
                                this.request.body = buffer ? buffer.toString() : '';
                                buffer = null;
                                resolve();
                            }
                        }
                    } catch (error) {
                        // 确保清理资源
                        buffer = null;
                        chunks = [];
                        reject(error);
                    }
                });

                // 请求中止处理(经由 ctx 统一分发，不直接调用 res.onAborted)
                this.onAborted(() => {
                    buffer = null;
                    chunks = [];
                    this.request.body = {};
                    resolve();
                });
            });
        } catch (error) {
            // 确保清理资源
            buffer = null;
            chunks = [];
            this.request.body = {};
            // 带状态码的错误(如请求体过大 413)向上抛出，交给统一错误处理返回响应
            if (error && error.status) {
                throw error;
            }
            // 其它未预期错误记录但不中断流程
            console.error('解析请求体时发生错误:', error);
        }
    },

    // 设置响应状态码
    setStatus(code) {
        this.response.status = code;
        this._explicitStatus = true;
        return this;
    },
    // 设置响应头
    set(key, value) {
        this.response.headers[key] = value;
        return this;
    },
    // 设置响应体
    setBody(data) {
        this.response.body = data;
        return this;
    },
    // 发送JSON响应
    json(data) {
        this.set('Content-Type', 'application/json');
        this.response.body = data;
        return this;
    },
    // 发送响应, 这个函数不能重复执行
    send() {
        // 如果已经发送过响应，则不再发送, 主要是为了优化 uWebSocket.js
        if (this._ended || this._aborted) return this;

        const body = this.response.body;
        const headers = this.response.headers;

        // 未显式设置 Content-Type 时，按 body 类型自动推断(Koa 风格)
        if (body !== null && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
            if (Buffer.isBuffer(body)) headers['Content-Type'] = 'application/octet-stream';
            else if (typeof body === 'object') headers['Content-Type'] = 'application/json';
            else if (typeof body === 'string') headers['Content-Type'] = body.trimStart().startsWith('<') ? 'text/html' : 'text/plain';
        }

        // 使用 uWebSockets 的 cork 方法优化写入性能
        this.res.cork(() => {
            // 设置状态码
            this.res.writeStatus(this.response.status.toString());

            // 设置响应头(值为数组时逐个写，支持多个同名头如 Set-Cookie)
            for (const key in headers) {
                const value = headers[key];
                if (Array.isArray(value)) {
                    for (const v of value) this.res.writeHeader(key, String(v));
                } else {
                    this.res.writeHeader(key, String(value));
                }
            }

            // 发送响应体
            if (body !== null) {
                if (Buffer.isBuffer(body)) {
                    this.res.end(body);
                } else if (typeof body === 'object') {
                    this.res.end(JSON.stringify(body));
                } else {
                    this.res.end(String(body));
                }
            } else {
                this.res.end();
            }
            this._ended = true; // 标记响应已结束
        });
        return this;
    },
    // 发送文件
    async sendFile(filePath) {
        // 如果已经发送过响应，则不再发送
        if (this._ended || this._aborted) return false;

        let fileHandle = null;
        try {
            // 去掉开头的 /，避免 path.resolve 把它当成绝对路径
            if (filePath.startsWith('/')) {
                filePath = filePath.substring(1);
            }

            const fullPath = path.resolve(this.options?.rootDir || process.cwd(), filePath);

            const stat = await fs.promises.stat(fullPath);
            if (!stat.isFile()) {
                this.status = 404;
                this.set('Content-Type', 'text/html');
                this.body = '<h1>404 Not Found</h1><p>Invalid path.</p>';
                this.send();
                return false;
            }

            // 小文件：一次性读取发送
            const MAX_SMALL_FILE_SIZE = 1024 * 1024; // 1MB
            if (stat.size <= MAX_SMALL_FILE_SIZE) {
                const fileContent = await fs.promises.readFile(fullPath);
                if (this._aborted) return false;
                this.res.cork(() => {
                    this.res.writeStatus('200 OK');
                    this.res.writeHeader('Content-Type', getContentType(fullPath));
                    // 不手动写 Content-Length：res.end(data) 会由 uWS 自动设置，
                    // 手动再写一次会导致 "Duplicate Content-Length" 协议错误。
                    this.res.end(fileContent);
                });
                this._ended = true;
                return true;
            }

            // 大文件：异步分块读取 + 背压控制(遵循 uWebSockets.js 的 tryEnd/onWritable 模式)
            fileHandle = await fs.promises.open(fullPath, 'r');
            const totalSize = stat.size;
            const BUFFER_SIZE = 512 * 1024; // 512KB

            // 中止时关闭文件句柄(经由 ctx 统一分发，避免重复注册 res.onAborted)
            this.onAborted(() => {
                if (fileHandle) {
                    fileHandle.close().catch(err => console.error('关闭文件失败:', err));
                    fileHandle = null;
                }
            });

            // 写响应头。注意：不手动写 Content-Length，
            // res.tryEnd(chunk, totalSize) 会用 totalSize 自动设置 Content-Length。
            this.res.cork(() => {
                this.res.writeStatus('200 OK');
                this.res.writeHeader('Content-Type', getContentType(fullPath));
            });

            let position = 0;
            while (position < totalSize && !this._aborted) {
                const readSize = Math.min(BUFFER_SIZE, totalSize - position);
                const buf = Buffer.alloc(readSize);
                const { bytesRead } = await fileHandle.read(buf, 0, readSize, position);
                if (bytesRead === 0) break;
                const chunk = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
                const chunkOffset = position; // 该 chunk 起始的绝对偏移

                // 写入并处理背压：resolve(true) 表示整个响应已发送完毕
                const finished = await new Promise((resolve) => {
                    let settled = false;
                    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

                    this.res.cork(() => {
                        const [ok, isDone] = this.res.tryEnd(chunk, totalSize);
                        if (isDone) return done(true);
                        if (ok) return done(false);
                        // 出现背压：等待 socket 可写后，从已确认的 offset 继续发送
                        this.res.onWritable((offset) => {
                            if (this._aborted) { done(false); return true; }
                            const [ok2, isDone2] = this.res.tryEnd(chunk.subarray(offset - chunkOffset), totalSize);
                            if (isDone2) { done(true); return true; }
                            if (ok2) { done(false); return true; }
                            return false; // 仍有背压，等待下一次 onWritable
                        });
                    });
                });

                position += bytesRead;
                if (finished) break;
            }

            // 关闭文件句柄
            if (fileHandle) {
                await fileHandle.close();
                fileHandle = null;
            }

            if (!this._aborted) this._ended = true;
            return !this._aborted;
        } catch (err) {
            // 确保关闭文件句柄
            if (fileHandle) {
                try {
                    await fileHandle.close();
                } catch (closeErr) {
                    console.error('关闭文件失败:', closeErr);
                }
                fileHandle = null;
            }

            if (this._aborted || this._ended) {
                return false;
            }

            // 错误处理
            if (err.code === 'ENOENT') {
                this.status = 404;
                this.set('Content-Type', 'text/html');
                this.body = '<h1>404 Not Found</h1><p>The requested resource was not found.</p>';
            } else {
                this.status = 500;
                this.set('Content-Type', 'text/html');
                this.body = '<h1>500 Internal Server Error</h1><p>Error reading file.</p>';
            }
            this.send();
            this._ended = true;
            return false;
        }
    },
    // 兼容 Koa 的 throw 方法
    throw(status, message, properties) {
        const err = new Error(message);
        err.status = status;
        if (properties) Object.assign(err, properties);
        throw err;
    },

    // 兼容 Koa 的 assert 方法
    assert(condition, status, message, properties) {
        if (!condition) {
            this.throw(status, message, properties);
        }
    },

    // 兼容 Koa 的 redirect 方法
    redirect(url, status = 302) {
        this.status = status;
        this.set('Location', url);
        this.set('Content-Type', 'text/html');
        this.body = 'Redirecting to ' + url;
        return this;
    },
};

class uWebKoa {
    constructor(options = {}) {
        this.middlewares = [];
        this.context = {};
        this._wsRoutes = [];        // WebSocket 路由配置 { pattern, handlers }
        this._wsMiddlewares = [];   // 全局 WS 升级中间件(app.wsUse)
        this._router = new RadixRouter(); // HTTP 路由基数树
        this._routerMounted = false;      // 路由分发中间件是否已挂入链
        this.uWebSocketApp = null; // 存储uWebSocket.js的应用实例
        const { timeout: timeoutOption, ...restOptions } = options;
        this.options = {
            rootDir: process.cwd(), // 默认使用当前工作目录
            staticDirs: {},         // 静态文件目录映射
            ssl: null,              // SSL 配置
            ...restOptions,
            // 统一的超时配置(深合并，避免用户只传部分字段时把默认值覆盖丢失)
            timeout: {
                request: 30000,     // 请求总超时(毫秒)，兜底防止连接挂死
                middleware: 0,      // 中间件链超时(毫秒)。默认 0=关闭(热路径零开销)；设正数则给整条链套超时并在超时返回 503
                ...(timeoutOption || {}),
            },
        };
        
        // 只有在没有禁用默认错误处理的情况下才添加
        if (options.disableDefaultErrorHandler !== true) {
            this.useDefaultErrorHandler();
        }
        
        // 在构造函数中直接创建 uWebSocket.js 应用实例
        this.uWebSocketApp = this.createApp(this.options.ssl);
    }
    
    // 注册默认错误处理中间件
    useDefaultErrorHandler() {
        // 添加在最前面，以便最后执行
        this.middlewares.unshift(async (ctx, next) => {
            try {
                await next();
            } catch (err) {
                ErrorHandler.handleError(err, ctx);
            }
        });
        return this;
    }

    /**
    * 获取 uWebSocket.js 应用实例
    * @returns {Object} uWebSocket.js 应用实例
    */
    getUWebSocketApp() {
        return this.uWebSocketApp;
    }

    /**
   * 创建 uWebSockets.js 应用
   * @param {Object} options SSL配置选项
   * @param {string} options.key_file_name SSL密钥文件路径
   * @param {string} options.cert_file_name SSL证书文件路径
   * @param {string} options.passphrase SSL密钥密码(可选)
   * @returns {Object} uWebSockets.js App 实例
   */
    createApp(sslOptions) {
        if (sslOptions) {
            // 创建 SSL 应用
            return SSLApp(sslOptions);
        } else {
            // 创建普通应用
            return App();
        }
    }

    /**
     * 添加中间件
     * @param {Function} middleware 中间件函数
     * @returns {uWebKoa} 实例自身，支持链式调用
     */
    use(middleware) {
        this.middlewares.push(middleware);
        return this;
    }

    /**
     * 创建上下文对象
     * @param {Object} res uWebSockets响应对象
     * @param {Object} req uWebSockets请求对象
     * @param {Object} [options] 选项
     * @param {'http'|'ws'} [options.type='http'] 上下文类型(HTTP 请求 或 WS 升级)
     * @returns {Object} 上下文对象
     */
    createContext(res, req, options = {}) {


        // 立即从 req 对象提取所有需要的数据，因为 req 对象在异步操作后不能访问
        const url = req.getUrl();
        // uWebSockets.js 的 getMethod() 返回小写(如 'get')，统一转成大写以符合 Koa/Node 习惯，
        // 并让 serveStatic / parseBody 里的 'GET'/'HEAD' 判断生效。
        const method = req.getMethod().toUpperCase();
        const queryString = req.getQuery(); // 使用 uWebSockets 内置的 getQuery 方法获取完整的查询字符串
        const headers = {};
        const query = {};

        // 立即解析查询参数 query
        if (queryString) {
            const searchParams = new URLSearchParams(queryString);
            for (const [key, value] of searchParams.entries()) {
                query[key] = value;
            }
        }
        // 立即解析请求头
        req.forEach((key, value) => {
            headers[key.toLowerCase()] = value;
        });

        // 用共享原型创建实例：方法/访问器只定义一次(在 httpCtxProto 上)，
        // 这里只挂请求级数据字段，避免每请求重建十几个闭包。
        const ctx = Object.create(httpCtxProto);
        ctx.req = req;
        ctx.res = res;
        ctx.request = { url, method, headers, query, queryString, params: {} };
        ctx.response = { status: 200, headers: {}, body: null };
        ctx._aborted = false;        // 标记请求是否已中止
        ctx._ended = false;          // 标记响应是否已结束
        ctx._explicitStatus = false; // 标记状态码是否被显式设置(用于默认 404)
        ctx._abortHandlers = [];     // 中止回调队列(避免在同一个 res 上多次注册 onAborted)
        ctx.type = options.type || 'http'; // 上下文类型：'http' | 'ws'
        ctx.state = {};              // 用户暂存区(鉴权用户、请求级数据)；WS 升级期会带入连接期
        ctx.app = this;              // 指回 uWebKoa 实例(用于 ctx.app.publish 等)
        ctx.options = this.options;  // 将options传递给上下文对象

        // 将全局上下文的属性合并到请求上下文中。
        // context 可被用户随时替换(app.context = {...})，因此仍需按请求浅合并；
        // 但只有存在自有键时才遍历，空 context 时几乎零开销。
        const context = this.context;
        if (context) {
            for (const key in context) {
                if (Object.prototype.hasOwnProperty.call(context, key)) {
                    ctx[key] = context[key];
                }
            }
        }
        return ctx;
    }
    /**
        * 添加静态文件服务中间件
        * @param {string} urlPrefix URL前缀
        * @param {string} rootDir 根目录
        * @returns {uWebKoa} 实例自身，支持链式调用
        */
    serveStatic(urlPrefix, rootDir) {
        // 安全检查：确保 rootDir 不为空且是有效路径
        if (!rootDir || typeof rootDir !== 'string' || rootDir.trim() === '') {
            throw new Error('静态文件根目录不能为空');
        }

        // 规范化路径
        if (!urlPrefix.startsWith('/')) urlPrefix = '/' + urlPrefix;
        if (!urlPrefix.endsWith('/')) urlPrefix += '/';

        // 确保 rootDir 不会意外地指向根目录
        rootDir = rootDir.trim();
        if (rootDir === '/' || rootDir === '\\') {
            throw new Error('静态文件根目录不能是系统根目录');
        }

        // 规范化路径分隔符
        rootDir = rootDir.replace(/\\/g, '/');
        if (!rootDir.endsWith('/')) rootDir += '/';

        this.use(async (ctx, next) => {
            const url = ctx.request.url;

            // 添加请求方法检查（仅处理GET请求）
            if (ctx.request.method === 'GET' && url.startsWith(urlPrefix)) {
                if (ctx._ended || ctx._aborted) return;

                // 修正路径拼接逻辑
                const relativePath = url.slice(urlPrefix.length);
                const fullPath = path.resolve(
                    this.options.rootDir || process.cwd(),
                    rootDir,
                    relativePath
                );

                // 加强安全检查：带上路径分隔符比较，防止 /app/public 与 /app/public-secret 这类前缀绕过
                const resolvedRoot = path.resolve(this.options.rootDir || process.cwd(), rootDir);
                const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
                if (fullPath !== resolvedRoot && !fullPath.startsWith(rootWithSep)) {
                    ctx.status = 403;
                    return;
                }

                try {
                    await ctx.sendFile(fullPath); // 确保调用ctx的sendFile方法
                } catch (error) {
                    await next();
                }
                return;
            }
            await next();
        });


        return this;
    }

    /**
     * 处理请求
     * @param {Object} res uWebSockets响应对象
     * @param {Object} req uWebSockets请求对象
     */
    async handleRequest(res, req) {
        const ctx = this.createContext(res, req);
        
        // 使用配置的请求超时时间
        const REQUEST_TIMEOUT = this.options.timeout.request;
        let timeoutId = null;
        
        // 设置请求超时
        timeoutId = setTimeout(() => {
            if (!ctx._ended && !ctx._aborted) {
                ctx._aborted = true;
                try {
                    res.cork(() => {
                        res.writeStatus('408 Request Timeout');
                        res.writeHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: '请求超时' }));
                    });
                } catch (error) {
                    console.error('发送超时响应时出错:', error);
                }
            }
        }, REQUEST_TIMEOUT);
        
        // 中断事件处理：res.onAborted 在同一个 res 上只能注册一次，
        // 这里统一注册，并把 ctx 上收集到的中止回调依次分发出去。
        res.onAborted(() => {
            ctx._aborted = true;
            clearTimeout(timeoutId);
            const handlers = ctx._abortHandlers || [];
            for (const handler of handlers) {
                try { handler(); } catch (e) { console.error('中止回调执行出错:', e); }
            }
        });
        
        try {
            // 解析请求体
            await ctx.parseBody().catch(err => {
                ErrorHandler.handleError(err, ctx);
            });
            
            // 只有未结束的请求才执行中间件
            if (!ctx._ended && !ctx._aborted) {
                await this.executeMiddleware(ctx);
                
                // 发送响应(如果中间件未发送)
                if (!ctx._ended && !ctx._aborted) {
                    // Koa 风格默认 404：没有任何中间件设置响应体且未显式设置状态码
                    if (ctx.response.body === null && !ctx._explicitStatus) {
                        ctx.status = 404;
                        ctx.set('Content-Type', 'application/json');
                        ctx.body = { success: false, message: 'Not Found', code: 'NOT_FOUND' };
                    }
                    ctx.send();
                }
            }
        } catch (err) {
            // 使用统一错误处理
            ErrorHandler.handleError(err, ctx);
        } finally {
            clearTimeout(timeoutId);
            
            // 资源清理
            this._cleanupContext(ctx);
        }
    }

    /**
     * 执行中间件链(标准 Koa compose)。
     *
     * 性能说明：中间件是嵌套执行的(外层 next() await 内层)，因此"整条链"的耗时由最外层覆盖，
     * 没必要给每个中间件都套一层 Promise.race + setTimeout(那会带来每请求 N 次 Promise/timer 分配)。
     * 这里改为：可选地给"整条链"套一个超时(每请求最多 1 个 timer)，默认关闭(timeout.middleware<=0)，
     * 兜底仍有 handleRequest 里的请求级超时(timeout.request)。
     *
     * @param {Object} ctx 请求上下文
     */
    async executeMiddleware(ctx) {
        if (this.middlewares.length === 0) return;

        const middlewares = this.middlewares;
        let lastIndex = -1;
        const dispatch = (i) => {
            // 防止在同一个中间件里多次调用 next()
            if (i <= lastIndex) return Promise.reject(new Error('next() 被多次调用'));
            lastIndex = i;
            const fn = middlewares[i];
            if (!fn) return Promise.resolve();
            try {
                return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
            } catch (err) {
                return Promise.reject(err);
            }
        };

        const middlewareTimeout = this.options.timeout && this.options.timeout.middleware;

        // 未配置(或 <=0)时不套超时，热路径零额外分配
        if (!middlewareTimeout || middlewareTimeout <= 0) {
            await dispatch(0);
            return;
        }

        // 整条链共用一个超时计时器
        let timerId = null;
        const timeoutPromise = new Promise((_, reject) => {
            timerId = setTimeout(() => reject(new Error('中间件执行超时')), middlewareTimeout);
        });
        try {
            await Promise.race([dispatch(0), timeoutPromise]);
        } catch (error) {
            if (error.message === '中间件执行超时') {
                ctx.status = 503;
                ctx.body = { error: '服务暂时不可用，请稍后再试' };
                ctx.send();
                ctx._ended = true;
            } else {
                throw error;
            }
        } finally {
            clearTimeout(timerId);
        }
    }

    /**
     * 注册路由处理器
     * @param {string} method HTTP方法
     * @param {string} pattern 路由模式
     * @param {...Function} handlers 处理函数数组
     */
    route(method, pattern, ...handlers) {
        return async (ctx, next) => {
            try {
                if (ctx.request.method.toLowerCase() === method.toLowerCase() &&
                    this.matchPattern(ctx.request.url, pattern)) {

                    ctx.parseParams(pattern);
                    
                    // 创建中间件链
                    let index = 0;
                    const routeNext = async () => {
                        if (index >= handlers.length) {
                            await next();
                            return;
                        }
                        const handler = handlers[index++];
                        await handler(ctx, routeNext);
                    };
                    
                    // 执行路由处理器但不捕获错误，让全局错误处理器处理
                    await routeNext();
                } else {
                    await next();
                }
            } catch (error) {
                // 向上传播错误，让全局错误处理器处理
                throw error;
            }
        };
    }
    /**
     * 匹配路由模式
     * @param {string} url 请求URL
     * @param {string} pattern 路由模式
     * @returns {boolean} 是否匹配
     */
    matchPattern(url, pattern) {
        // 处理查询参数
        const urlPath = url.split('?')[0];

        // 处理通配符情况
        if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2); // 移除 '/*'
            return urlPath === prefix || urlPath.startsWith(prefix + '/');
        }

        const urlParts = urlPath.split('/').filter(Boolean);
        const patternParts = pattern.split('/').filter(Boolean);

        // 如果不包含通配符且路径段数量不同，则不匹配
        if (urlParts.length !== patternParts.length) return false;

        // 逐段比较
        for (let i = 0; i < patternParts.length; i++) {
            const patternPart = patternParts[i];

            // 处理参数占位符
            if (patternPart.startsWith(':')) {
                continue; // 参数占位符匹配任何值
            }

            // 处理通配符
            if (patternPart === '*') {
                continue; // 通配符匹配任何值
            }

            // 精确匹配
            if (patternPart !== urlParts[i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * 把路由登记到基数树，并确保"路由分发中间件"已挂入中间件链(只挂一次，在首个路由注册处)。
     * 这样 use() 注册的通用中间件仍在路由前执行，路由后注册的中间件(如 notFound)仍在其后执行。
     * @private
     */
    _addRoute(method, pattern, handlers) {
        this._router.add(method, pattern, handlers);
        if (!this._routerMounted) {
            this._routerMounted = true;
            this.middlewares.push((ctx, next) => this._routerDispatch(ctx, next));
        }
        return this;
    }

    /**
     * 路由分发：在基数树里按 方法 + 路径 查找，命中则执行其处理器链，未命中则继续后续中间件。
     * @private
     */
    async _routerDispatch(ctx, next) {
        let urlPath = ctx.request.url;
        const q = urlPath.indexOf('?');
        if (q !== -1) urlPath = urlPath.slice(0, q);

        const match = this._router.find(ctx.request.method, urlPath);
        if (!match) return next();

        ctx.request.params = match.params;
        const handlers = match.handlers;
        let index = 0;
        const routeNext = async () => {
            if (index >= handlers.length) {
                await next(); // 处理器链走完仍可回落到后续中间件
                return;
            }
            const handler = handlers[index++];
            await handler(ctx, routeNext);
        };
        await routeNext();
    }

    /**
   * 注册GET路由
   * @param {string} pattern 路由模式
   * @param {...Function} handlers 处理函数数组
   */
    get(pattern, ...handlers) {
        return this._addRoute('GET', pattern, handlers);
    }

    /**
     * 注册POST路由
     * @param {string} pattern 路由模式
     * @param {...Function} handlers 处理函数数组
     */
    post(pattern, ...handlers) {
        return this._addRoute('POST', pattern, handlers);
    }

    /**
     * 注册PUT路由
     * @param {string} pattern 路由模式
     * @param {...Function} handlers 处理函数数组
     */
    put(pattern, ...handlers) {
        return this._addRoute('PUT', pattern, handlers);
    }

    /**
     * 注册DELETE路由
     * @param {string} pattern 路由模式
     * @param {...Function} handlers 处理函数数组
     */
    delete(pattern, ...handlers) {
        return this._addRoute('DELETE', pattern, handlers);
    }

    /**
     * 注册全局 WebSocket 升级中间件(对所有 app.ws 路由生效，在各路由自己的 upgrade 中间件之前执行)
     * @param {Function} middleware 中间件 (ctx, next) => {}
     * @returns {uWebKoa} 实例自身
     */
    wsUse(middleware) {
        this._wsMiddlewares.push(middleware);
        return this;
    }

    /**
     * 注册 WebSocket 路由
     * @param {string} pattern 路由模式(支持 :param)
     * @param {Object} handlers 处理器集合
     * @param {Object}   [handlers.config]  uWS 原生连接配置(idleTimeout/maxPayloadLength/maxBackpressure/compression 等)
     * @param {boolean}  [handlers.config.rawMessage] 为 true 时 message 回调收到原始 ArrayBuffer(零拷贝)，否则收到 Buffer(已拷贝)
     * @param {Function|Function[]} [handlers.upgrade] 升级前中间件(可复用 HTTP 中间件；ctx.throw 或不放行即拒绝升级)
     * @param {Function} [handlers.open]    (ctx) => {}  连接建立
     * @param {Function} [handlers.message] (ctx, data, isBinary) => {}
     * @param {Function} [handlers.drain]   (ctx) => {}  背压缓解
     * @param {Function} [handlers.close]   (ctx, code, message) => {}
     * @returns {uWebKoa} 实例自身
     */
    ws(pattern, handlers = {}) {
        this._wsRoutes.push({ pattern, handlers });
        return this;
    }

    /**
     * 向某个主题发布消息(HTTP 侧向 WS 连接推送的入口)
     * @param {string} topic 主题
     * @param {*} message 消息(对象会自动 JSON 序列化)
     * @param {boolean} [isBinary=false]
     * @param {boolean} [compress=false]
     * @returns {boolean} 是否有订阅者收到
     */
    publish(topic, message, isBinary = false, compress = false) {
        const payload = this._normalizeWsPayload(message);
        return this.uWebSocketApp.publish(topic, payload, isBinary, compress);
    }

    /**
     * 把消息规范化为 uWS 可发送的类型：对象 -> JSON 字符串；Buffer/ArrayBuffer/字符串原样返回
     * @private
     */
    _normalizeWsPayload(message) {
        if (message == null) return '';
        if (typeof message === 'string') return message;
        if (Buffer.isBuffer(message) || message instanceof ArrayBuffer || ArrayBuffer.isView(message)) return message;
        if (typeof message === 'object') return JSON.stringify(message);
        return String(message);
    }

    /**
     * 依据 ws 路由配置构建 uWS 的 WebSocketBehavior 对象
     * @private
     */
    _buildWsBehavior(route) {
        const { pattern, handlers } = route;
        const config = handlers.config || {};
        const upgradeMiddlewares = [
            ...this._wsMiddlewares,
            ...(Array.isArray(handlers.upgrade) ? handlers.upgrade : handlers.upgrade ? [handlers.upgrade] : [])
        ];
        const self = this;

        // 从 config 中剔除我们自定义的字段，其余透传给 uWS
        const { rawMessage, ...uwsConfig } = config;

        return {
            ...uwsConfig,
            // 返回 Promise 便于测试 await；uWS 会忽略返回值
            upgrade: (res, req, context) =>
                self._handleUpgrade(res, req, context, pattern, upgradeMiddlewares, handlers),

            open: (ws) => {
                const ctx = self._makeWsContext(ws);
                // getUserData() 每次返回同一对象，把连接期 ctx 挂上去供后续回调使用
                ws.getUserData().ctx = ctx;
                if (handlers.open) handlers.open(ctx);
            },

            message: (ws, message, isBinary) => {
                if (!handlers.message) return;
                const ctx = ws.getUserData().ctx;
                // 默认拷贝成 Buffer(uWS 会在回调后复用/释放底层内存)；rawMessage 时零拷贝透传
                const data = rawMessage ? message : Buffer.from(new Uint8Array(message));
                handlers.message(ctx, data, isBinary);
            },

            drain: (ws) => {
                if (!handlers.drain) return;
                // 背压缓解，可在此继续发送积压数据；ctx.getBufferedAmount() 可查当前积压
                handlers.drain(ws.getUserData().ctx);
            },

            ping: (ws, message) => {
                if (!handlers.ping) return;
                const msg = message ? Buffer.from(new Uint8Array(message)) : null;
                handlers.ping(ws.getUserData().ctx, msg);
            },

            pong: (ws, message) => {
                if (!handlers.pong) return;
                const msg = message ? Buffer.from(new Uint8Array(message)) : null;
                handlers.pong(ws.getUserData().ctx, msg);
            },

            dropped: (ws, message, isBinary) => {
                if (!handlers.dropped) return;
                // 因超过 maxBackpressure 而被丢弃的出站消息
                const data = rawMessage ? message : Buffer.from(new Uint8Array(message));
                handlers.dropped(ws.getUserData().ctx, data, isBinary);
            },

            close: (ws, code, message) => {
                const userData = ws.getUserData();
                const ctx = userData.ctx;
                if (ctx) ctx._closed = true;
                if (handlers.close) {
                    // close 后 message 内存即失效，需要时立即拷贝
                    const msg = message ? Buffer.from(new Uint8Array(message)) : null;
                    handlers.close(ctx, code, msg);
                }
            },
        };
    }

    /**
     * 处理 WS 升级请求：跑升级中间件链，通过则 res.upgrade，否则返回 HTTP 错误
     * @private
     */
    async _handleUpgrade(res, req, context, pattern, middlewares, handlers) {
        // 【关键】升级三件套必须在任何 await 之前同步取出(req 在异步后失效)
        const secKey = req.getHeader('sec-websocket-key');
        const secProtocol = req.getHeader('sec-websocket-protocol');
        const secExt = req.getHeader('sec-websocket-extensions');

        const ctx = this.createContext(res, req, { type: 'ws' });
        ctx.parseParams(pattern);

        // 【关键】异步鉴权前必须先注册 onAborted
        let aborted = false;
        res.onAborted(() => { aborted = true; ctx._aborted = true; });

        try {
            await this._runWsUpgradeChain(ctx, middlewares);
            if (aborted) return;

            // 中间件显式设置了状态码或响应体 => 视为拒绝升级，返回该 HTTP 响应
            // 注意：ctx.send() 内部已经 cork，这里不能再包一层 res.cork(会造成嵌套 cork)
            if (ctx._ended) return;
            if (ctx._explicitStatus || ctx.response.body !== null) {
                ctx.send();
                return;
            }

            // 通过：升级为 WebSocket，把需要带入连接期的数据放进 userData.carry
            const carry = {
                state: ctx.state,
                params: ctx.request.params,
                query: ctx.request.query,
                headers: ctx.request.headers,
                url: ctx.request.url,
            };
            res.cork(() => {
                res.upgrade({ carry }, secKey, secProtocol, secExt, context);
            });
        } catch (err) {
            if (aborted) return;
            // ErrorHandler.handleError 内部会调用 ctx.send()(自带 cork)，此处不要再包 cork
            ErrorHandler.handleError(err, ctx);
        }
    }

    /**
     * 运行 WS 升级中间件链(标准 Koa compose，错误向上抛出)
     * @private
     */
    async _runWsUpgradeChain(ctx, middlewares) {
        let lastIndex = -1;
        const dispatch = async (i) => {
            if (i <= lastIndex) throw new Error('next() 在同一个中间件中被多次调用');
            lastIndex = i;
            const fn = middlewares[i];
            if (!fn) return;
            await fn(ctx, () => dispatch(i + 1));
        };
        await dispatch(0);
    }

    /**
     * 构建连接期 ctx(轻量、无 res/req、带 ws 与便捷方法；state 从升级期带过来)
     * @private
     */
    _makeWsContext(ws) {
        const carry = (ws.getUserData() && ws.getUserData().carry) || {};
        const self = this;

        const ctx = {
            type: 'ws',
            ws,
            app: this,
            state: carry.state || {},
            request: {
                url: carry.url,
                headers: carry.headers || {},
                query: carry.query || {},
                params: carry.params || {},
            },
            _closed: false,

            // 向当前连接发送消息。
            // 返回值即 uWS 的发送状态(见 uWebKoa.SendStatus)：
            //   BACKPRESSURE(0) 已缓冲但有背压，应放缓发送(等 drain)
            //   SUCCESS(1)      成功写入
            //   DROPPED(2)      因超过 maxBackpressure 被丢弃
            send(data, isBinary = false, compress = false) {
                if (this._closed) return uWebKoa.SendStatus.DROPPED;
                return ws.send(self._normalizeWsPayload(data), isBinary, compress);
            },
            // 当前连接的发送缓冲区积压字节数(用于背压判断)
            getBufferedAmount() {
                try { return ws.getBufferedAmount(); } catch { return 0; }
            },
            // 主动发送 ping(心跳)。通常无需手动调用：uWS 在 sendPingsAutomatically(默认开)下会按 idleTimeout/2 自动 ping
            ping(message) { if (this._closed) return uWebKoa.SendStatus.DROPPED; return ws.ping(message); },
            // 在一个 cork 里批量写，减少系统调用/分包
            cork(cb) { return ws.cork(cb); },
            // 订阅 / 退订主题(pub/sub)
            subscribe(topic) { return ws.subscribe(topic); },
            unsubscribe(topic) { return ws.unsubscribe(topic); },
            isSubscribed(topic) { return ws.isSubscribed(topic); },
            // 从当前连接向主题发布
            publish(topic, data, isBinary = false, compress = false) {
                return ws.publish(topic, self._normalizeWsPayload(data), isBinary, compress);
            },
            // 关闭连接：传 code 走优雅关闭(end)，否则直接 close
            close(code, shortMessage) {
                this._closed = true;
                return code != null ? ws.end(code, shortMessage) : ws.close();
            },
            // 客户端地址
            getRemoteAddress() {
                try { return Buffer.from(ws.getRemoteAddressAsText()).toString(); } catch { return ''; }
            },
        };

        // 合并全局上下文(io/db 等)，与 HTTP ctx 保持一致
        if (this.context) Object.assign(ctx, this.context);
        return ctx;
    }

    /**
    * 启动服务器，支持多核模式
    * @param {number} port 端口号
    * @param {Object} options 选项
    * @param {boolean} options.cluster 是否启用多核模式
    * @param {number} options.workers 工作进程数量，默认为CPU核心数
    * @returns {Promise<any>} 启动结果
    */
    async listen(portOrApp, optionsOrPort = {}) {
        // 检测参数类型
        let port, options;
        
        // 如果第一个参数是对象（可能是App实例），第二个参数是数字
        if (typeof portOrApp === 'object' && (typeof optionsOrPort === 'number' || !isNaN(Number(optionsOrPort)))) {
            port = Number(optionsOrPort);
            options = {};
        } else {
            port = typeof portOrApp === 'number' ? portOrApp : parseInt(portOrApp, 10);
            options = optionsOrPort;
        }
        
        if (isNaN(port)) {
            throw new Error('端口号必须是有效的数字');
        }
        
        const defaultOptions = {
            cluster: false,
            threads: false,
            workers: 0,
        };

        const opts = { ...defaultOptions, ...options };
        const app = this.uWebSocketApp;
        
        // 应用中间件
        this.applyToApp(app);
        
        // 根据选项决定使用哪种监听方式
        if (opts.threads) {
            return this._threadListen(app, port, opts);
        } else if (opts.cluster) {
            return this._clusterListen(app, port, opts);
        } else {
            return new Promise((resolve) => {
                const listenSocket = app.listen(port, (token) => {
                    if (token) {
                        // SSL 配置存放在 this.options.ssl，而不是 listen 的 opts
                        const protocol = this.options.ssl ? 'https' : 'http';
                        console.log(`服务器运行在 ${protocol}://localhost:${port}`);
                        resolve(token);
                    } else {
                        console.log(`启动服务器失败`);
                        resolve(null);
                    }
                });
            });
        }
    }
    /**
     * 多核模式启动服务器 (使用 worker_threads)
     * @private
     * @param {Object} app uWebSockets.js App 实例
     * @param {number} port 端口号
     * @param {Object} options 选项
     * @returns {Promise<any>} 启动结果
     */
    async _threadListen(app, port, options) {
        const { Worker, isMainThread, threadId, parentPort } = await import('worker_threads');
        const { cpus } = await import('os');

        const numThreads = options.workers > 0 ? options.workers : cpus().length;

        if (isMainThread) {
            console.log(`主线程 ${process.pid} (线程 ${threadId}) 正在运行`);
            console.log(`启动 ${numThreads} 个工作线程...`);

            // 创建接收器应用
            const acceptorApp = app.listen(port, (token) => {
                if (token) {
                    console.log(`主接收器监听端口 ${port} (线程 ${threadId})`);
                } else {
                    console.log(`主接收器监听端口 ${port} 失败 (线程 ${threadId})`);
                }
            });

            // 工作线程入口必须是"用户启动脚本"(process.argv[1])，而不是框架文件本身。
            // 这样每个工作线程会重新执行用户脚本、重建带路由的 app，
            // 再次调用 listen() 时因 isMainThread=false 进入下面的工作线程分支并上报描述符。
            const workerEntry = process.argv[1];

            // 为每个CPU创建一个工作线程
            const workers = [];
            for (let i = 0; i < numThreads; i++) {
                const worker = new Worker(workerEntry, {
                    workerData: {
                        isWorker: true,
                        workerId: i,
                        port: 0 // 工作线程不需要监听端口
                    }
                });

                worker.on('message', (workerAppDescriptor) => {
                    acceptorApp.addChildAppDescriptor(workerAppDescriptor);
                    console.log(`已添加工作线程 ${i} 的应用描述符`);
                });

                worker.on('error', (error) => {
                    console.error(`工作线程 ${i} 错误:`, error);
                });

                worker.on('exit', (code) => {
                    console.log(`工作线程 ${i} 退出，退出码: ${code}`);
                    if (code !== 0) {
                        console.log(`工作线程异常退出，正在重启...`);
                        workers[i] = new Worker(workerEntry, {
                            workerData: {
                                isWorker: true,
                                workerId: i,
                                port: 0
                            }
                        });
                    }
                });

                workers.push(worker);
            }

            return Promise.resolve({
                isMain: true,
                workers: numThreads,
                workerInstances: workers
            });
        } else {
            // 工作线程代码
            console.log(`工作线程 ${threadId} 启动`);

            // 不需要监听端口，只需要创建应用并发送描述符
            const workerApp = app;

            // 将应用描述符发送给主线程
            parentPort.postMessage(workerApp.getDescriptor());

            return Promise.resolve({
                isMain: false,
                threadId
            });
        }
    }
    /**
 * 多核模式启动服务器
 * @private
 * @param {Object} app uWebSockets.js App 实例
 * @param {number} port 端口号
 * @param {Object} options 选项
 * @returns {Promise<any>} 启动结果
 */
    async _clusterListen(app, port, options) {
        const clusterModule = await import('cluster');
        const cluster = clusterModule.default;
        const { cpus } = await import('os');
        
        const numCPUs = options.workers > 0 ? options.workers : cpus().length;
        
        if (cluster.isPrimary) {
            console.log(`主进程 ${process.pid} 正在运行`);
            
            // 创建共享数据存储
            const sharedState = new Map();
            
            // 为每个 CPU 创建工作进程
            for (let i = 0; i < numCPUs; i++) {
                cluster.fork();
            }
            
            // 处理工作进程退出
            cluster.on('exit', (worker, code, signal) => {
                console.log(`工作进程 ${worker.process.pid} 已退出，退出码: ${code}`);
                if (code !== 0 && !worker.exitedAfterDisconnect) {
                    console.log(`工作进程异常退出，正在重启...`);
                    cluster.fork();
                }
            });
            
            // 进程间通信
            cluster.on('message', (worker, message) => {
                if (message.type === 'SET_SHARED') {
                    sharedState.set(message.key, message.value);
                    // 广播给所有工作进程
                    for (const id in cluster.workers) {
                        if (cluster.workers[id] !== worker) {
                            cluster.workers[id].send({ 
                                type: 'SHARED_UPDATE', 
                                key: message.key, 
                                value: message.value 
                            });
                        }
                    }
                }
            });
            
            // 错误处理
            cluster.on('error', (error) => {
                console.error('集群错误:', error);
            });
            
            return Promise.resolve({ isMaster: true, workers: numCPUs });
        } else {
            // 工作进程代码
            // 添加进程间通信支持
            process.on('message', (message) => {
                if (message.type === 'SHARED_UPDATE') {
                    // 更新本地共享状态
                    this.context.shared = this.context.shared || {};
                    this.context.shared[message.key] = message.value;
                }
            });
            
            // 添加共享状态方法
            this.context.setShared = (key, value) => {
                this.context.shared = this.context.shared || {};
                this.context.shared[key] = value;
                process.send({ type: 'SET_SHARED', key, value });
            };
            
            // 监听端口
            return new Promise((resolve) => {
                const listenSocket = app.listen(port, (token) => {
                    if (token) {
                        console.log(`工作进程 ${process.pid} 运行在 http://localhost:${port}`);
                        resolve({ isMaster: false, token, pid: process.pid });
                    } else {
                        console.log(`工作进程 ${process.pid} 启动服务器失败`);
                        resolve(null);
                    }
                });
            });
        }
    }

    /**
     * 将中间件应用到uWebSockets应用
     * @param {Object} app uWebSockets应用
     */
    applyToApp(app) {
        // 先注册 WebSocket 路由：必须在 any('/*') 通配之前，否则升级请求会被 HTTP catch-all 抢走
        for (const route of this._wsRoutes) {
            app.ws(route.pattern, this._buildWsBehavior(route));
        }
        // 处理所有 HTTP 请求
        app.any('/*', (res, req) => {
            this.handleRequest(res, req);
        });
        return app; // 返回 app 实例以支持链式调用
    }

    // 添加专门的上下文清理方法
    _cleanupContext(ctx) {
        try {
            // 清理大型对象
            if (ctx.request?.body && typeof ctx.request.body === 'object') {
                ctx.request.body = null;
            }
            if (ctx.response?.body && typeof ctx.response.body === 'object' && 
                ctx.response.body.length > 1024) {
                ctx.response.body = null;
            }
            
            // 允许垃圾回收
            ctx.req = null;
            ctx.res = null;
        } catch (cleanupError) {
            console.error('清理上下文时出错:', cleanupError);
        }
    }
}

/**
 * WebSocket 发送状态(对应 uWebSockets.js 的 send/publish 返回值)
 * - BACKPRESSURE(0): 消息已缓冲，但连接存在背压，应放缓发送，等待 drain
 * - SUCCESS(1):      写入成功
 * - DROPPED(2):      因超过 maxBackpressure 被丢弃
 */
uWebKoa.SendStatus = Object.freeze({
    BACKPRESSURE: 0,
    SUCCESS: 1,
    DROPPED: 2,
});

export default uWebKoa;