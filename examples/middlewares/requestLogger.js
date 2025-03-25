import { logger } from '../utils/logger.js';
export default function requestLogger() {
    return async (ctx, next) => {
        const start = Date.now();
        await next();
        const ms = Date.now() - start;
        if (ctx.request.queryString) {
            logger.info(`${ctx.method} ${ctx.url}?${ctx.request.queryString} - ${ctx.status} ${ms}ms`);
        } else {
            logger.info(`${ctx.method} ${ctx.url} - ${ctx.status} ${ms}ms`);
        }
        
    };
}