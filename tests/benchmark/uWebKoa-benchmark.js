
import uWebKoa from '../../src/uWebKoa.js';

// 创建 uWebSockets 应用
const app = new uWebKoa();

// 添加一个简单的路由
app.get('/', async (ctx) => {
  ctx.json({ message: 'Hello World!' });
});

// 添加一个返回较大数据的路由
app.get('/large', async (ctx) => {
  // 生成一个包含1000个项目的数组
  const data = Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    value: Math.random() * 1000
  }));
  
  ctx.json(data);
});

// 添加一个处理POST请求的路由
app.post('/echo', async (ctx) => {
  ctx.json(ctx.request.body);
});



// 应用中间件并启动服务器
await app.listen(3000);
// npm install -g autocannon