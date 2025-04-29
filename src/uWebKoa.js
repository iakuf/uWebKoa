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

class uWebKoa {
    constructor(options = {}) {
        this.middlewares = [];
        this.context = {};
        this.uWebSocketApp = null; // 存储uWebSocket.js的应用实例
        this.options = {
            rootDir: process.cwd(), // 默认使用当前工作目录
            staticDirs: {},         // 静态文件目录映射
            ssl: null,              // SSL 配置
            // 添加统一的超时配置
            timeout: {
                request: 30000,     // 请求总超时(毫秒)
                middleware: 10000   // 中间件执行超时(毫秒)
            },
            ...options
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
                                    this._aborted = true;
                                    // 清理资源
                                    buffer = null;
                                    chunks = [];
                                    return reject(new Error('请求体过大'));
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
                        
                        // 请求中止处理
                        this.res.onAborted(() => {
                            buffer = null;
                            chunks = [];
                            this._aborted = true;
                            this.request.body = {};
                            resolve();
                        });
                    });
                } catch (error) {
                    // 确保清理资源
                    buffer = null;
                    chunks = [];
                    this.request.body = {};
                    // 记录错误但不中断流程
                    console.error('解析请求体时发生错误:', error);
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

                let fd = null;
                try {
                    // 检查文件是否存在
                    if (filePath.startsWith('/')) {
                        // 如果是以 / 开头的路径，去掉开头的 /
                        filePath = filePath.substring(1);
                    }

                    const fullPath = path.resolve(this.options?.rootDir || process.cwd(), filePath);

                    const stat = await fs.promises.stat(fullPath);
                    if (!stat.isFile()) {
                        this.status = 404;
                        this.body = '<h1>404 Not Found</h1><p>Invalid path.</p>';
                        this.send();
                        this._ended = true;
                        return false;
                    }
                    
                    // 对于小文件，直接读取发送
                    const MAX_SMALL_FILE_SIZE = 1024 * 1024; // 1MB
                    if (stat.size <= MAX_SMALL_FILE_SIZE) {
                        const fileContent = await fs.promises.readFile(fullPath);
                        this.res.cork(() => {
                            this.res.writeStatus('200 OK');
                            this.res.writeHeader('Content-Type', getContentType(fullPath));
                            this.res.writeHeader('Content-Length', stat.size.toString());
                            this.res.end(fileContent);
                        });
                        this._ended = true;
                        return true;
                    }

                    // 大文件处理
                    fd = await fsOpen(fullPath, 'r');
                    const BUFFER_SIZE = 64 * 1024; // 64KB
                    const buffer = Buffer.alloc(BUFFER_SIZE);

                    // 中断处理器
                    this.res.onAborted(() => {
                        this._aborted = true;
                        if (fd !== null) {
                            fsClose(fd).catch(err => console.error('关闭文件失败:', err));
                            fd = null;
                        }
                    });

                    // 响应头部
                    this.res.cork(() => {
                        this.res.writeStatus('200 OK');
                        this.res.writeHeader('Content-Type', getContentType(fullPath));
                        this.res.writeHeader('Content-Length', stat.size.toString());
                    });

                    // 流式发送
                    let position = 0;
                    let totalSent = 0;

                    while (position < stat.size && !this._aborted) {
                        const bytesRead = fs.readSync(fd, buffer, 0, BUFFER_SIZE, position);
                        if (bytesRead === 0) break;

                        const chunk = buffer.slice(0, bytesRead);
                        this.res.cork(() => {
                            this.res.write(chunk);
                        });

                        position += bytesRead;
                        totalSent += bytesRead;
                    }

                    // 确保关闭文件
                    if (fd !== null) {
                        await fsClose(fd);
                        fd = null;
                    }

                    // 完成响应
                    if (!this._aborted) {
                        this.res.cork(() => {
                            this.res.end();
                        });
                        this._ended = true;
                    }
                    return !this._aborted;
                } catch (err) {
                    // 确保关闭文件
                    if (fd !== null) {
                        try {
                            await fsClose(fd);
                        } catch (closeErr) {
                            console.error('关闭文件失败:', closeErr);
                        }
                        fd = null;
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
        
        // 中断事件处理
        res.onAborted(() => {
            ctx._aborted = true;
            clearTimeout(timeoutId);
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
     * 执行中间件链，非递归实现但保持原有执行顺序
     * @param {Object} ctx 请求上下文
     */
    async executeMiddleware(ctx) {
        // 使用配置的中间件超时时间
        const MIDDLEWARE_TIMEOUT = this.options.timeout.middleware;
        
        if (this.middlewares.length === 0) return;
        
        const middlewareStack = this.middlewares.map(middleware => ({
            middleware,
            executed: false,
            completed: false
        }));
        
        const executeNextMiddleware = async (index) => {
            if (index >= this.middlewares.length) return;
            
            const middlewareInfo = middlewareStack[index];
            if (middlewareInfo.executed) return;
            
            middlewareInfo.executed = true;
            
            try {
                // 创建 next 函数
                const next = async () => {
                    await executeNextMiddleware(index + 1);
                };
                
                // 带超时的中间件执行
                const middlewarePromise = this.middlewares[index](ctx, next);
                const timeoutPromise = new Promise((_, reject) => {
                    const timerId = setTimeout(() => {
                        clearTimeout(timerId);
                        reject(new Error('中间件执行超时'));
                    }, MIDDLEWARE_TIMEOUT);
                });
                
                await Promise.race([middlewarePromise, timeoutPromise]);
                middlewareInfo.completed = true;
            } catch (error) {
                middlewareInfo.completed = true;
                
                // 超时错误特殊处理
                if (error.message === '中间件执行超时') {
                    ctx.status = 503;
                    ctx.body = { error: '服务暂时不可用，请稍后再试' };
                    ctx.send();
                    ctx._ended = true;
                } else {
                    // 其他错误向上传播
                    throw error;
                }
            }
        };
        
        // 执行中间件链
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
        // 处理所有请求
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

export default uWebKoa;