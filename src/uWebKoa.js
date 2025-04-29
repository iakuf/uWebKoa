/**
 * uWebKoa - 类似Koa的uWebSockets封装
 * 提供中间件支持和更简洁的API
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { App, SSLApp } from 'uWebSockets.js'

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 将 fs 方法转换为 Promise 版本
const fsOpen = promisify(fs.open);
const fsClose = promisify(fs.close);
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

class uWebKoa {
    constructor(options) {
        this.middlewares = [];
        this.context = {};
        this.uWebSocketApp = null; // 存储uWebSocket.js的应用实例
        this.options = {
            rootDir: process.cwd(), // 默认使用当前工作目录
            staticDirs: {},         // 静态文件目录映射
            ssl: null,              // SSL 配置
            ...options
        };
        // 在构造函数中直接创建 uWebSocket.js 应用实例
        this.uWebSocketApp = this.createApp(this.options.ssl);
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
     * @returns {Object} 上下文对象
     */
    createContext(res, req) {


        // 立即从 req 对象提取所有需要的数据，因为 req 对象在异步操作后不能访问
        const url = req.getUrl();
        const method = req.getMethod();
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

        const ctx = {
            req,
            res,
            request: {
                url,
                method,
                headers,
                query,
                queryString,
                params: {},
            },
            response: {
                status: 200,
                headers: {},
                body: null,
            },
            _aborted: false, // 标记请求是否已中止
            _ended: false, // 标记响应是否已结束
            options: this.options, // 将options传递给上下文对象

            // 兼容 Koa 的属性和方法
            get url() {
                return this.request.url;
            },

            get method() {
                return this.request.method;
            },

            get headers() {
                return this.request.headers;
            },

            get body() {
                return this.response.body;
            },

            set body(val) {
                this.response.body = val;
            },

            get status() {
                return this.response.status;
            },

            set status(code) {
                this.response.status = code;
            },
            // 解析路径参数
            parseParams(pattern) {
                const url = this.request.url;
                const patternParts = pattern.split('/');
                const urlParts = url.split('/');

                for (let i = 0; i < patternParts.length; i++) {
                    if (patternParts[i].startsWith(':')) {
                        const paramName = patternParts[i].substring(1);
                        this.request.params[paramName] = urlParts[i] || '';
                    }
                }
            },
            // 解析JSON请求体，改进的缓冲区管理
            async parseBody() {
                const contentType = this.request.headers['content-type'];
                const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB 大小限制
                let totalSize = 0;
                
                try {
                    return new Promise((resolve, reject) => {
                        // 检查是否为 GET 或 HEAD 请求
                        if (this.request.method === 'GET' || this.request.method === 'HEAD') {
                            this.request.body = {};
                            return resolve();
                        }
                        
                        // 已经中止的请求
                        if (this._aborted) {
                            this.request.body = {};
                            return resolve();
                        }

                        let buffer = null;
                        let chunks = [];
                        
                        this.res.onData((chunk, isLast) => {
                            // 使用 try-catch 处理任何解析错误
                            try {
                                // 安全复制数据块
                                const curChunk = Buffer.from(new Uint8Array(chunk));
                                totalSize += curChunk.length;
                                
                                // 检查请求体大小限制
                                if (totalSize > MAX_BODY_SIZE) {
                                    this._aborted = true;
                                    return reject(new Error('请求体过大'));
                                }
                                
                                // 使用数组存储块，避免过早连接
                                chunks.push(curChunk);
                                
                                if (isLast) {
                                    // 只有在最后才合并所有块
                                    buffer = Buffer.concat(chunks);
                                    chunks = null; // 清理临时数组
                                    
                                    try {
                                        if (contentType && contentType.includes('application/json')) {
                                            this.request.body = JSON.parse(buffer.toString());
                                        } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
                                            // 添加对 URL 编码表单的支持
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
                                        buffer = null; // 显式释放缓冲区
                                        resolve();
                                    } catch (e) {
                                        console.error(`解析请求体错误:`, e);
                                        this.request.body = buffer ? buffer.toString() : '';
                                        buffer = null; // 显式释放缓冲区
                                        resolve();
                                    }
                                }
                            } catch (error) {
                                buffer = null;
                                chunks = null;
                                reject(error);
                            }
                        });

                        // 设置更明确的错误处理逻辑
                        this.res.onAborted(() => {
                            buffer = null;
                            chunks = null;
                            this._aborted = true;
                            resolve(); // 优雅地处理中止情况
                        });
                    });
                } catch (error) {
                    console.error('解析请求体时发生错误:', error);
                    this.request.body = {};
                    return Promise.resolve(); // 优雅失败，避免未处理的拒绝
                }
            },
            // 设置响应状态码
            setStatus(code) {
                this.response.status = code;
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
                // 使用 uWebSockets 的 cork 方法优化写入性能
                this.res.cork(() => {
                    // 设置状态码
                    this.res.writeStatus(this.response.status.toString());

                    // 设置响应头
                    Object.entries(this.response.headers).forEach(([key, value]) => {
                        this.res.writeHeader(key, value);
                    });

                    // 发送响应体
                    if (this.response.body !== null) {
                        if (typeof this.response.body === 'object') {
                            this.res.end(JSON.stringify(this.response.body));
                        } else {
                            this.res.end(String(this.response.body));
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

                try {
                    // 检查文件是否存在
                    if (filePath.startsWith('/')) {
                        // 如果是以 / 开头的路径，去掉开头的 /
                        filePath = filePath.substring(1);
                    }

                    const fullPath = path.resolve(this.options?.rootDir || process.cwd(), filePath);
                    // console.log(`进入进行检查 filePath: ${fullPath}, rootDir: ${this.options?.rootDir}`);


                    const stat = await fs.promises.stat(fullPath);
                    if (!stat.isFile()) {
                        // 不是文件，返回 404
                        // console.log(`文件不存在: ${fullPath}`);
                        this.status = 404;
                        this.body = '<h1>404 Not Found</h1><p>Invalid path.</p>';
                        this.send(); // 直接在这里发送响应
                        this._ended = true; // 防止 handleRequest 再次执行
                        return false;
                    }
                    // console.log(`文件存在: ${fullPath} 文件大小 ${stat.size}`);
                    // 对于小文件（小于 1MB），直接读取并使用 ctx.send() 发送
                    const MAX_SMALL_FILE_SIZE = 1024 * 1024; // 1MB
                    if (stat.size <= MAX_SMALL_FILE_SIZE) {
                        // 读取文件内容
                        const fileContent = await fs.promises.readFile(fullPath);

                        // 设置响应头和状态码
                        // console.log(`文件存在小于 1M  ${stat.size}`, fileContent);
                        // 使用 cork 方法直接发送，避免使用 this.body 。不然会和默认的 ->send() 冲突
                        this.res.cork(() => {
                            this.res.writeStatus('200 OK');
                            this.res.writeHeader('Content-Type', getContentType(fullPath));
                            this.res.writeHeader('Content-Length', stat.size.toString());
                            this.res.end(fileContent);
                        });
                        this._ended = true; // 这需要手动标记
                        return true;
                    }


                    // 打开文件
                    const fd = await fsOpen(fullPath, 'r');

                    // 设置缓冲区大小
                    const BUFFER_SIZE = 64 * 1024; // 64KB
                    const buffer = Buffer.alloc(BUFFER_SIZE);

                    // 中断处理器， 之所以这个地方还注册，是因为需要它来关句柄。
                    this.res.onAborted(() => {
                        this._aborted = true;
                        console.log(`客户端中断了文件传输: ${fullPath}`);
                        fsClose(fd).catch(err => console.error('关闭文件失败:', err));
                    });

                    // 对于大文件，使用流式传输
                    // console.log(`发送文件: ${fullPath}, 大小: ${stat.size} 字节, 类型: ${getContentType(fullPath)}`);
                    this.res.cork(() => {
                        this.res.writeStatus('200 OK');
                        this.res.writeHeader('Content-Type', getContentType(fullPath));
                        this.res.writeHeader('Content-Length', stat.size.toString());
                    });


                    // 流式发送文件
                    let bytesRead = 0;
                    let position = 0;
                    let totalSent = 0;

                    while (position < stat.size) {
                        if (this._aborted) break; 

                        bytesRead = fs.readSync(fd, buffer, 0, BUFFER_SIZE, position);

                        if (bytesRead === 0) break;

                        // 使用 cork 优化写入性能
                        const chunk = buffer.slice(0, bytesRead);
                        this.res.cork(() => {
                            this.res.write(chunk);
                        });

                        position += bytesRead;
                        totalSent += bytesRead;
                    }

                    // 关闭文件
                    await fsClose(fd);

                    // 如果没有中止，结束响应
                    if (!this._aborted) {
                        this.res.cork(() => {
                            this.res.end();
                        });
                        if (this._ended) {  // <-- 新增保护逻辑
                            console.warn('响应已结束，跳过后续操作');
                            return;
                        }
                        // console.log(`文件发送完成: ${fullPath}, 总共发送: ${totalSent} 字节`);
                    }
                    this._ended = true;
                    return !this._aborted;
                } catch (err) {
                    // console.error(`发送文件错误 (${filePath}):`, err);
                    // 添加连接状态检查
                    if (this._aborted || this._ended) {
                        console.log('连接已中断，跳过错误处理');
                        return false;
                    }

                    // 如果文件不存在
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
            redirect(url) {
                this.status = 302;
                this.set('Location', url);
                this.body('Redirecting to ' + url);
            }
        };

        // 将全局上下文的属性合并到请求上下文中
        if (this.context) {
            Object.assign(ctx, this.context);
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

                // 加强安全检查
                const resolvedRoot = path.resolve(this.options.rootDir || process.cwd(), rootDir);
                if (!fullPath.startsWith(resolvedRoot)) {
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
        // 创建上下文
        const ctx = this.createContext(res, req);
        
        // 请求超时机制
        let timeoutId = null;
        const REQUEST_TIMEOUT = 30000; // 30秒超时
        
        // 设置请求超时
        timeoutId = setTimeout(() => {
            if (!ctx._ended && !ctx._aborted) {
                ctx._aborted = true;
                console.log('请求超时，自动终止');
                
                try {
                    // 发送超时响应
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

        // 在解析请求体之前绑定中断事件
        res.onAborted(() => {
            ctx._aborted = true;
            clearTimeout(timeoutId); // 清除超时定时器
            console.log('客户端提前中断连接');
        });

        try {
            // 解析请求体
            await ctx.parseBody().catch(err => {
                console.error('解析请求体错误:', err);
                ctx.request.body = {}; // 设置默认值
            });

            // 执行中间件链 - 实现超时机制
            await this.executeMiddleware(ctx).catch(err => {
                console.error('执行中间件错误:', err);
                if (!ctx._ended && !ctx._aborted) {
                    // 使用err.status或默认为500
                    ctx.status = err.status || 500;
                    ctx.body = { error: err.message || '内部服务器错误' };
                }
            });

            // 发送响应
            if (!ctx._ended && !ctx._aborted) {
                ctx.send();
            }
        } catch (err) {
            console.error('Request handling error:', err);
            // 只有在响应尚未发送且连接未中断时才发送错误响应
            if (!ctx._aborted && !ctx._ended) {
                try {
                    // 使用err.status如果存在，否则使用500
                    ctx.status = err.status || 500;
                    ctx.body = { error: err.message || 'Internal Server Error' };
                    ctx.send();
                } catch (sendError) {
                    console.error('发送错误响应时出错:', sendError);
                }
            }
        } finally {
            clearTimeout(timeoutId); // 确保清除超时定时器
            
            // 显式清理上下文中的大型对象
            try {
                if (ctx.request.body && typeof ctx.request.body === 'object') {
                    ctx.request.body = null;
                }
                if (ctx.response.body && typeof ctx.response.body === 'object' && ctx.response.body.length > 1024) {
                    ctx.response.body = null;
                }
                
                // 设置 WeakRef，允许垃圾回收
                ctx.req = null;
                ctx.res = null;
            } catch (cleanupError) {
                console.error('清理上下文时出错:', cleanupError);
            }
        }
    }

    /**
     * 执行中间件链，非递归实现但保持原有执行顺序
     * @param {Object} ctx 请求上下文
     */
    async executeMiddleware(ctx) {
        const MIDDLEWARE_TIMEOUT = 10000; // 中间件执行超时时间 (10秒)
        
        if (this.middlewares.length === 0) return;
        
        // 创建一个执行计划数组，包含每个中间件的状态
        const middlewareStack = this.middlewares.map(middleware => ({
            middleware,
            executed: false,
            completed: false
        }));
        
        // 递归执行逻辑转为非递归实现
        let currentIndex = 0;
        
        const executeNextMiddleware = async (index) => {
            if (index >= this.middlewares.length) return;
            
            const middlewareInfo = middlewareStack[index];
            if (middlewareInfo.executed) return; // 已经执行过的跳过
            
            middlewareInfo.executed = true;
            
            try {
                // 创建 next 函数，模拟递归行为
                const next = async () => {
                    // 执行下一个中间件
                    await executeNextMiddleware(index + 1);
                };
                
                // 设置中间件执行超时
                const middlewarePromise = this.middlewares[index](ctx, next);
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('中间件执行超时')), MIDDLEWARE_TIMEOUT);
                });
                
                await Promise.race([middlewarePromise, timeoutPromise]);
                middlewareInfo.completed = true;
            } catch (error) {
                middlewareInfo.completed = true;
                console.error(`中间件执行错误: ${error.message}`);
                
                if (error.message === '中间件执行超时') {
                    ctx.status = 503;
                    ctx.body = { error: '服务暂时不可用，请稍后再试' };
                    ctx._ended = true;
                } else {
                    // 这里是关键修改：向上传播错误，而不是捕获后不处理
                    throw error;
                }
            }
        };
        
        // 开始执行中间件链
        await executeNextMiddleware(0);
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
                        try {
                            if (index >= handlers.length) {
                                await next();
                                return;
                            }
                            const handler = handlers[index++];
                            await handler(ctx, routeNext);
                        } catch (error) {
                            console.error(`路由处理器错误:`, error);
                            if (!ctx._ended && !ctx._aborted) {
                                // 使用错误的status属性或默认为500
                                ctx.status = error.status || 500;
                                ctx.body = { error: error.message || '内部服务器错误' };
                                ctx.send();
                            }
                        }
                    };

                    await routeNext();
                } else {
                    await next();
                }
            } catch (error) {
                console.error(`路由匹配错误:`, error);
                if (!ctx._ended && !ctx._aborted) {
                    // 使用错误的status属性或默认为500
                    ctx.status = error.status || 500;
                    ctx.body = { error: error.message || '内部服务器错误' };
                    ctx.send();
                }
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
   * 注册GET路由
   * @param {string} pattern 路由模式
   * @param {...Function} handlers 处理函数数组
   */
    get(pattern, ...handlers) {
        this.use(this.route('get', pattern, ...handlers));
        return this;
    }

    /**
     * 注册POST路由
     * @param {string} pattern 路由模式
     * @param {...Function} handlers 处理函数数组
     */
    post(pattern, ...handlers) {
        this.use(this.route('post', pattern, ...handlers));
        return this;
    }

    /**
     * 注册PUT路由
     * @param {string} pattern 路由模式
     * @param {...Function} handlers 处理函数数组
     */
    put(pattern, ...handlers) {
        this.use(this.route('put', pattern, ...handlers));
        return this;
    }

    /**
     * 注册DELETE路由
     * @param {string} pattern 路由模式
     * @param {...Function} handlers 处理函数数组
     */
    delete(pattern, ...handlers) {
        this.use(this.route('delete', pattern, ...handlers));
        return this;
    }

    /**
    * 启动服务器，支持多核模式
    * @param {number} port 端口号
    * @param {Object} options 选项
    * @param {boolean} options.cluster 是否启用多核模式
    * @param {number} options.workers 工作进程数量，默认为CPU核心数
    * @returns {Promise<any>} 启动结果
    */
    async listen(port, options = {}) {
        const defaultOptions = {
            cluster: false,
            threads: false,
            workers: 0, // 0表示使用所有可用CPU核心
        };

        const opts = { ...defaultOptions, ...options };

        // 使用已创建的app实例或创建新的
        const app = this.uWebSocketApp;

        // 将中间件应用到 uWebSockets.js 应用
        this.applyToApp(app);

        if (opts.threads) {
            return this._threadListen(app, port, opts);
        } else if (opts.cluster) {
            return this._clusterListen(app, port, opts);
        } else {
            return new Promise((resolve) => {
                const listenSocket = app.listen(port, (token) => {
                    if (token) {
                        const protocol = opts.ssl ? 'https' : 'http';
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
        const { fileURLToPath } = await import('url');
        const { dirname } = await import('path');

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

            // 获取当前文件路径
            const __filename = fileURLToPath(import.meta.url);

            // 为每个CPU创建一个工作线程
            const workers = [];
            for (let i = 0; i < numThreads; i++) {
                const worker = new Worker(__filename, {
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
                        workers[i] = new Worker(__filename, {
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
            console.log(`启动 ${numCPUs} 个工作进程...`);

            // 为每个 CPU 创建一个工作进程
            for (let i = 0; i < numCPUs; i++) {
                cluster.fork();
            }

            cluster.on('exit', (worker, code, signal) => {
                console.log(`工作进程 ${worker.process.pid} 已退出，退出码: ${code}`);
                if (code !== 0 && !worker.exitedAfterDisconnect) {
                    console.log(`工作进程异常退出，正在重启...`);
                    cluster.fork();
                }
            });
            // 监听错误事件
            cluster.on('error', (error) => {
                console.error('Cluster error:', error);
            });

            return Promise.resolve({ isMaster: true, workers: numCPUs });
        } else {
            // 工作进程代码
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
        // 处理所有请求
        app.any('/*', (res, req) => {
            this.handleRequest(res, req);
        });
        return app; // 返回 app 实例以支持链式调用
    }



}

export default uWebKoa;