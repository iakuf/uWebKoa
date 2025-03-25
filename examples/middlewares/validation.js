import { object } from 'yup';

/**
 * 创建验证中间件
 * @param {Object} schema Yup验证模式对象
 * @param {string} source 验证数据来源 ('body', 'query', 'params')
 * @param {Object} options 验证选项
 * @returns {Function} 验证中间件函数
 */
export function validate(schema, source = 'body', options = {}) {
    const defaultOptions = {
        abortEarly: false, // 返回所有错误而不是在第一个错误时停止
        stripUnknown: true // 删除未在模式中定义的键
    };

    const validationOptions = { ...defaultOptions, ...options };

    return async (ctx, next) => {
        try {
            // 根据来源获取数据
            let data;
            switch (source) {
                case 'body':
                    data = ctx.request.body;
                    break;
                case 'query':
                    data = ctx.request.query;
                    break;
                case 'params':
                    data = ctx.request.params;
                    break;
                default:
                    throw new Error(`不支持的验证来源: ${source}`);
            }
            // 验证数据
            const validData = await schema.validate(data, validationOptions);

            // 将验证后的数据放回请求对象
            switch (source) {
                case 'body':
                    ctx.request.body = validData;
                    break;
                case 'query':
                    ctx.request.query = validData;
                    break;
                case 'params':
                    ctx.request.params = validData;
                    break;
            }

            await next();
        } catch (err) {
            console.error(`验证错误详情:`, err.errors || err.message);
            // 处理验证错误
            ctx.status = 400;
            ctx.json({
                success: false,
                code: 'VALIDATION_ERROR',
                message: '请求参数验证失败',
                errors: err.errors || [err.message]
            });
        }
    };
}

/**
 * 组合多个验证中间件
 * @param {...Function} validators 验证中间件数组
 * @returns {Function} 组合后的中间件
 */
export function validateAll(...validators) {
    return async (ctx, next) => {
        for (const validator of validators) {
            let nextCalled = false;
            const nextMiddleware = async () => {
                nextCalled = true;
            };

            await validator(ctx, nextMiddleware);

            // 如果验证失败，中间件不会调用 next
            if (!nextCalled) {
                return;
            }
        }

        // 所有验证都通过，继续下一个中间件
        await next();
    };
}