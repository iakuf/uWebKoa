import Ajv from 'ajv';
import ajvErrors from 'ajv-errors';

// 创建并配置 AJV 实例
const ajv = new Ajv({
    allErrors: true,       // 返回所有错误而不是第一个
    useDefaults: true,     // 使用模式中的默认值
    removeAdditional: true // 删除未在模式中定义的属性
});

// 添加自定义错误消息支持
ajvErrors(ajv);

// 缓存已编译的验证器以提高性能
const validatorCache = new Map();

/**
 * 创建验证中间件
 * @param {Object} schema JSON Schema验证模式对象
 * @param {string} source 验证数据来源 ('body', 'query', 'params')
 * @returns {Function} 验证中间件函数
 */
export function validate(schema, source = 'body') {
    // 从缓存获取或创建验证器
    const cacheKey = JSON.stringify(schema);
    if (!validatorCache.has(cacheKey)) {
        validatorCache.set(cacheKey, ajv.compile(schema));
    }
    const validator = validatorCache.get(cacheKey);

    return async (ctx, next) => {
        try {
            // 根据来源获取数据
            let data;
            switch (source) {
                case 'body':
                    data = ctx.request.body || {};
                    break;
                case 'query':
                    data = ctx.request.query || {};
                    break;
                case 'params':
                    data = ctx.request.params || {};
                    break;
                default:
                    throw new Error(`不支持的验证来源: ${source}`);
            }

            // 验证数据
            const valid = validator(data);

            if (!valid) {
                // 格式化错误消息
                const errors = validator.errors.map(err => {
                    if (err.message) return err.message;
                    return `${err.dataPath} ${err.message}`;
                });

                ctx.status = 400;
                ctx.json({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    message: '请求参数验证失败',
                    errors: errors
                });
                return;
            }

            // 将验证后的数据放回请求对象
            switch (source) {
                case 'body':
                    ctx.request.body = data;
                    break;
                case 'query':
                    ctx.request.query = data;
                    break;
                case 'params':
                    ctx.request.params = data;
                    break;
            }

            await next();
        } catch (err) {
            // 处理验证器内部错误
            ctx.status = 500;
            ctx.json({
                success: false,
                code: 'VALIDATION_ERROR',
                message: '验证过程中发生错误',
                errors: [err.message]
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