// 基准测试运行器：启动 bench-server 子进程，用 autocannon 打多个场景，输出汇总表。
// 用法：node tests/benchmark/bench.js   (可用环境变量 CONNECTIONS / DURATION / ROUTES 调参)
import autocannon from 'autocannon';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3010);
const BASE = `http://127.0.0.1:${PORT}`;
const CONNECTIONS = Number(process.env.CONNECTIONS || 100);
const DURATION = Number(process.env.DURATION || 10);
const ROUTES = Number(process.env.ROUTES || 200);
// 流水线深度：客户端与服务端同机时，非流水线(=1)的吞吐会被客户端 CPU 抢占压低。
// 文档里的基准数(≈38k)基本是在流水线下测得，用 PIPELINING=10 可得到可比的数字。
const PIPELINING = Number(process.env.PIPELINING || 1);

function runAutocannon(opts) {
    return new Promise((resolve, reject) => {
        autocannon(
            { connections: CONNECTIONS, duration: DURATION, pipelining: PIPELINING, ...opts },
            (err, result) => (err ? reject(err) : resolve(result))
        );
    });
}

function waitReady(child) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('服务器启动超时')), 20000);
        child.stdout.on('data', (d) => {
            if (d.toString().includes('READY')) { clearTimeout(timer); resolve(); }
        });
        child.on('exit', (code) => reject(new Error(`服务器提前退出 code=${code}`)));
    });
}

const child = spawn(process.execPath, [path.join(__dirname, 'bench-server.js')], {
    env: { ...process.env, PORT: String(PORT), ROUTES: String(ROUTES) },
    stdio: ['ignore', 'pipe', 'inherit'],
});

try {
    await waitReady(child);
    console.log(`基准: connections=${CONNECTIONS} duration=${DURATION}s pipelining=${PIPELINING} routes=${ROUTES}\n`);

    const scenarios = [
        { name: 'GET /            (baseline)', url: `${BASE}/` },
        { name: 'GET /large       (1000项 JSON)', url: `${BASE}/large` },
        { name: 'GET /users/:id   (param)', url: `${BASE}/users/42` },
        { name: `GET /route/0     (1/${ROUTES})`, url: `${BASE}/route/0` },
        { name: `GET /route/${ROUTES - 1}   (${ROUTES}/${ROUTES})`, url: `${BASE}/route/${ROUTES - 1}` },
        {
            name: 'POST /echo       (JSON body)', url: `${BASE}/echo`,
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ test: 'data' }),
        },
    ];

    const rows = [];
    for (const s of scenarios) {
        const r = await runAutocannon({ url: s.url, method: s.method || 'GET', headers: s.headers, body: s.body });
        rows.push({
            scenario: s.name,
            'req/sec (avg)': Math.round(r.requests.average),
            'latency ms (avg)': r.latency.average,
            'throughput MB/s': +(r.throughput.average / 1e6).toFixed(2),
            'non-2xx': r.non2xx,
        });
    }
    console.table(rows);
} catch (err) {
    console.error('基准运行失败:', err.message);
    process.exitCode = 1;
} finally {
    child.kill();
}
