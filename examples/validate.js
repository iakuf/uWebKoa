import uWebKoa from './uWebKoa.js';

import { validate, validateAll } from "./middlewares/validation.js";

import { object, string, array, mixed } from 'yup';
const querySchema = object({
    page: string().required('页码参数是必需的').matches(/^\d+$/, '页码必须是数字'),
    limit: string().required('参数是必需的').matches(/^\d+$/, '每页数量必须是数字')
});
const idParams = object({
    id: string().required('参数是必需的').matches(/^\d+$/, '参数必须是数字')
});
// 为 notifyUpdate 创建验证模式
const notifyUpdateSchema = object({
    deviceID: array().of(string()).required('设备ID数组是必需的'),
    userID: string().default('0'),
    type: mixed().default(1),
    op: string().default(''),
    data: mixed()
});

// 为 noticeQueue 创建验证模式
const noticeQueueSchema = object({
    data: object({
        queueList: mixed().test(
            'is-valid-queue-list',
            '队列列表必须是有效的对象且不能为空',
            (value) => {
                // 检查是否为对象且不为空
                return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
            }
        ),
        deviceID: string().when('queueList', {
            is: queueList => queueList && Object.values(queueList).some(ranking => ranking === 0),
            then: string().required('当有排队成功的用户时，设备ID是必需的')
        }),
        avgTime: mixed().default(0),
        freezeTime: mixed().default(0),
        relayConf: string().when('queueList', {
            is: queueList => queueList && Object.values(queueList).some(ranking => ranking === 0),
            then: string().required('当有排队成功的用户时，转发配置是必需的')
        }),
        waitingTotalNum: mixed(),
        encryptCode: string(),
        signalUrl: string().default('https://signal.everylinks.com')
    }).required('数据对象是必需的')
});

// 创建 uWebKoa 实例，直接传入 SSL 配置
const app = new uWebKoa({
    ssl: process.env.NODE_ENV === "development" ? {
        key_file_name: "./cert/geelevel.com.key",
        cert_file_name: "./cert/geelevel.com.pem",
    } : null
});

// 获取 uWebSocket.js 应用实例
const uWebSocketApp = app.getUWebSocketApp();
console.log(`uWebSocketApp`, uWebSocketApp);

const io = setupSocketIO();
io.attachApp(uWebSocketApp); // 把 socket.io 底层处理挂到 uWebSocketApp 上，方便提高性能
app.context.io = io; // 把 io 实例挂到 uWebKoa 上，方便其它地方使用


// 添加中间件
app.use(errorHandler()); // 先加这个才会有有中间件的错误
app.use(requestLogger()); // 先加这个才会有日志
app.use(corsMiddleware());

// 添加路由处理器
app.get('/path1/:id', validate(idParams, 'params'), peerStatus);
app.post('/path2', validate(notifyUpdateSchema, 'body'), notifyUpdate); // 通知服务
app.post('/path3', validate(noticeQueueSchema, 'body'), noticeQueue); // 排队更新服务

// 静态文件服务
// 需要放到其它的路由的后面
// app.serveStatic('public', './public');
app.get('/public/*', async (ctx) => {
    console.log(`do `, ctx.request.url);
    const success = await ctx.sendFile(ctx.request.url);
});

// 启动服务器
// 最后加这个才会有404, 必须放到所有的路由的后面
app.use(notFound()); 

if (process.env.NODE_ENV === "development") {
    app.listen(443);
} else {
    app.listen(1921);
}

// 添加全局未捕获异常处理
process.on('uncaughtException', (err) => {
    console.error('未捕获的异常:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});