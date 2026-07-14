// 配方 07：Cookie 读写（当前需手动处理——框架尚未内置 ctx.cookies）
// 读：解析请求头 Cookie；写：设置 Set-Cookie 响应头。
// 试验：
//   curl -i http://localhost:3000/login          -> 响应含 Set-Cookie: sid=...
//   curl -i --cookie "sid=abc123" http://localhost:3000/me
import uWebKoa from '../../src/uWebKoa.js';

const app = new uWebKoa();

// 小工具：解析 Cookie 头为对象
function parseCookies(ctx) {
    const raw = ctx.request.headers['cookie'] || '';
    const out = {};
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

// 小工具：序列化并设置一个 Cookie
function setCookie(ctx, name, value, opts = {}) {
    let s = `${name}=${encodeURIComponent(value)}`;
    if (opts.maxAge != null) s += `; Max-Age=${opts.maxAge}`;
    if (opts.path) s += `; Path=${opts.path}`;
    if (opts.httpOnly) s += '; HttpOnly';
    if (opts.secure) s += '; Secure';
    if (opts.sameSite) s += `; SameSite=${opts.sameSite}`;
    ctx.set('Set-Cookie', s); // 注意：多个 Cookie 需自行处理（当前 set 会覆盖同名头）
}

app.get('/login', (ctx) => {
    setCookie(ctx, 'sid', 'abc123', { maxAge: 3600, path: '/', httpOnly: true, sameSite: 'Lax' });
    ctx.json({ ok: true });
});

app.get('/me', (ctx) => {
    const cookies = parseCookies(ctx);
    if (!cookies.sid) ctx.throw(401, '未登录');
    ctx.json({ sid: cookies.sid });
});

await app.listen(3000);
console.log('GET /login 写 cookie  ·  GET /me 读 cookie');
