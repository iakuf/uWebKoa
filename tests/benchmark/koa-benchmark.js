import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import jsonError from 'koa-json-error';

const app = new Koa();
const router = new Router();

// 使用body解析中间件
app.use(jsonError());
app.use(bodyParser({
  enableTypes: ['json'],
  onerror: (err, ctx) => {
    console.error('Body 解析错误:', err);
    ctx.status = 400;
    ctx.body = {
      error: '无效的请求数据',
      message: err.message
    };
  }
}));

// 添加相同的路由
router.get('/', (ctx) => {
  ctx.body = { message: 'Hello World!' };
});

router.get('/large', (ctx) => {
  // 生成一个包含1000个项目的数组
  const data = Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    value: Math.random() * 1000
  }));
  
  ctx.body = data;
});

router.post('/echo', (ctx) => {
  ctx.body = ctx.request.body;
  // ctx.body = { message: 'Hello World!' };
});

// 使用路由
app.use(router.routes());
app.use(router.allowedMethods());

// 启动服务器
const port = 3001;
app.listen(port, () => {
  console.log(`Koa服务器运行在 http://localhost:${port}`);
});