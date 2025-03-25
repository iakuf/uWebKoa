/**
 * 创建限速器函数
 * @param {number} limit 在指定时间间隔内允许的最大请求数
 * @param {number} interval 时间间隔（毫秒）
 * @returns {Function} 限速中间件函数
 */
export function createRateLimit(limit, interval) {
    let now = 0;
    const last = Symbol();
    const count = Symbol();
    
    // 每隔 interval 毫秒更新当前时间单位
    setInterval(() => ++now, interval);
    
    /**
     * 检查请求是否超过限制
     * @param {Object} client 客户端对象（可以是 WebSocket 或 HTTP 请求的标识）
     * @returns {boolean} 如果超过限制则返回 true
     */
    const isOverLimit = (client) => {
        if (client[last] !== now) {
            // 新的时间单位，重置计数
            client[last] = now;
            client[count] = 1;
            return false;
        } else {
            // 同一时间单位内，增加计数并检查是否超过限制
            return ++client[count] > limit;
        }
    };
    
    /**
     * HTTP 请求限速中间件
     * @param {Object} options 配置选项
     * @param {string} options.keyGenerator 用于生成客户端标识的函数或属性名
     * @param {Function} options.handler 处理超过限制的回调函数
     * @returns {Function} Koa 风格的中间件函数
     */
    return function rateLimit(options = {}) {
        const defaultOptions = {
            keyGenerator: (ctx) => ctx.request.headers['x-forwarded-for'] || ctx.req.getRemoteAddress().toString(),
            handler: async (ctx) => {
                ctx.status(429);
                ctx.json({
                    error: '请求过于频繁，请稍后再试',
                    retryAfter: Math.ceil(interval / 1000)
                });
            }
        };
        
        const opts = { ...defaultOptions, ...options };
        
        // 存储客户端状态
        const clients = new Map();
        
        return async (ctx, next) => {
            // 获取客户端标识
            const key = typeof opts.keyGenerator === 'function' 
                ? opts.keyGenerator(ctx) 
                : ctx.request[opts.keyGenerator] || ctx.req.getRemoteAddress().toString();
            
            // 如果是新客户端，则添加到 Map 中
            if (!clients.has(key)) {
                clients.set(key, {});
            }
            
            const client = clients.get(key);
            
            // 检查是否超过限制
            if (isOverLimit(client)) {
                // 设置响应头
                ctx.set('Retry-After', Math.ceil(interval / 1000).toString());
                ctx.set('X-RateLimit-Limit', limit.toString());
                ctx.set('X-RateLimit-Remaining', '0');
                ctx.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + interval / 1000).toString());
                
                // 调用处理函数
                await opts.handler(ctx);
            } else {
                // 设置响应头
                ctx.set('X-RateLimit-Limit', limit.toString());
                ctx.set('X-RateLimit-Remaining', (limit - client[count]).toString());
                ctx.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + interval / 1000).toString());
                
                // 继续处理请求
                await next();
            }
        };
    };
}

/**
 * WebSocket 限速器
 * @param {number} limit 在指定时间间隔内允许的最大消息数
 * @param {number} interval 时间间隔（毫秒）
 * @returns {Function} 检查 WebSocket 是否超过限制的函数
 */
export function createWsRateLimit(limit, interval) {
    let now = 0;
    const last = Symbol();
    const count = Symbol();
    
    setInterval(() => ++now, interval);
    
    return (ws) => {
        if (ws[last] !== now) {
            ws[last] = now;
            ws[count] = 1;
            return false;
        } else {
            return ++ws[count] > limit;
        }
    };
}