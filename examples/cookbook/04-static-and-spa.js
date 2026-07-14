// 配方 04：静态资源 + 单页应用(SPA)回退
// 思路：把资源放在带前缀的静态目录(/static)，其余 GET 全部回退到 index.html。
// 这样刷新任意前端路由都能拿到 SPA 入口，而资源请求仍走静态服务。
// 目录约定：
//   public/index.html
//   public/static/...(js/css/img)
// 运行前请确保 ./public 存在。
import uWebKoa from '../../src/uWebKoa.js';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = new uWebKoa({ rootDir: here });

// 1) 资源：/static/app.js -> ./public/static/app.js
app.serveStatic('/static', './public/static');

// 2) SPA 回退：其它所有 GET -> index.html
//    注意：serveStatic 是通过 use 注册的中间件，会先执行；未命中再落到这个 catch-all 路由。
app.get('/*', async (ctx) => {
    const ok = await ctx.sendFile('./public/index.html');
    if (!ok) { ctx.status = 404; ctx.body = 'index.html 不存在，请先创建 ./public/index.html'; }
});

await app.listen(3000);
console.log('SPA: http://localhost:3000  ·  资源: /static/*');
