// 配方 03：读取请求体 + 文件下载
// 请求体已由框架在进入中间件前自动解析(parseBody)，直接读 ctx.request.body。
//   - application/json           -> 解析为对象
//   - x-www-form-urlencoded      -> 解析为对象
//   - 其它                        -> 原始字符串
// 下载用 ctx.sendFile：小文件(<=1MB)缓冲发送，大文件流式发送并处理背压。
// 试验：
//   curl -XPOST -H "Content-Type: application/json" -d "{\"a\":1}" http://localhost:3000/echo
//   curl http://localhost:3000/download/package.json
import uWebKoa from '../../src/uWebKoa.js';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = new uWebKoa({ rootDir: projectRoot });

app.post('/echo', (ctx) => {
    ctx.json({ received: ctx.request.body, type: typeof ctx.request.body });
});

// /download/<相对 rootDir 的路径>
app.get('/download/*', async (ctx) => {
    const rel = ctx.request.url.slice('/download/'.length);
    const ok = await ctx.sendFile(rel); // 返回 false 时表示已发 404/500
    if (!ok) console.warn('下载失败:', rel);
});

await app.listen(3000);
console.log('POST /echo  ·  GET /download/<path>');
