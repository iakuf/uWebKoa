export default function errorHandler() {
    return async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            // 记录错误
            console.error('请求处理错误:', err);

            ctx.status = err.status || 500;
            // 构建错误响应
            const errorResponse = {
                success: false,
                message: err.message || '服务器内部错误',
                code: err.code || 'INTERNAL_ERROR'
            };

            // 在非生产环境下添加错误堆栈
            if (process.env.NODE_ENV !== 'production') {
                errorResponse.error = err.stack;
            }

            // 设置响应头
            ctx.set('Content-Type', 'application/json');

            // 使用 cork 方法包装响应写入
            ctx.res.cork(() => {
                // 设置状态码
                ctx.res.writeStatus(ctx.status.toString());

                // 设置响应头
                Object.entries(ctx.response.headers).forEach(([key, value]) => {
                    ctx.res.writeHeader(key, value);
                });

                // 发送JSON响应
                ctx.res.end(JSON.stringify(errorResponse));
            });
        }
    };
}