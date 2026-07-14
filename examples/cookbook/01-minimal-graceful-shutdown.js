// 配方 01：最小启动 + 优雅关停
// listen() 返回 uWS 的 listenSocket(token)，用 us_listen_socket_close 停止监听。
// 运行：node examples/cookbook/01-minimal-graceful-shutdown.js
import uWebKoa from '../../src/uWebKoa.js';
import { us_listen_socket_close } from 'uWebSockets.js';

const app = new uWebKoa();

app.get('/', (ctx) => { ctx.json({ ok: true, ts: Date.now() }); });

const token = await app.listen(3000);
if (!token) { console.error('端口被占用'); process.exit(1); }
console.log('http://localhost:3000  (Ctrl+C 优雅退出)');

function shutdown() {
    console.log('\n正在关停…');
    if (token) us_listen_socket_close(token); // 停止接受新连接
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
