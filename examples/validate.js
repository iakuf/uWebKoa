import uWebKoa from './uWebKoa.js';

import { validate } from "./middlewares/validation.js";


import { validate } from "./middlewares/validation.js";

import setupSocketIO from './routes/socket.js';


const path1demo = {
    type: 'object',
    required: ['page', 'limit'],
    properties: {
        page: {
            type: 'string',
            pattern: '^\\d+$',
            errorMessage: { 
                pattern: '页码必须是数字',
                required: '页码参数是必需的'
            }
        },
        limit: {
            type: 'string',
            pattern: '^\\d+$',
            errorMessage: {
                pattern: '每页数量必须是数字',
                required: '参数是必需的'
            }
        }
    }
};

const path2demo = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {
            type: 'string',
            pattern: '^\\d+$',
            errorMessage: {
                pattern: '参数必须是数字',
                required: '参数是必需的'
            }
        }
    }
};


const path3demo = {
    type: 'object',
    required: ['deviceID'],
    properties: {
        deviceID: {
            type: 'array',
            items: { type: 'string' },
            errorMessage: { required: '设备ID数组是必需的' }
        },
        userID: {
            type: 'string',
            default: '0'
        },
        type: {
            default: 1
        },
        op: {
            type: 'string',
            default: ''
        },
        data: {}
    }
};


const path4demo = {
    type: 'object',
    required: ['data'],
    properties: {
        data: {
            type: 'object',
            required: ['queueList'],
            properties: {
                queueList: {
                    type: 'object',
                    minProperties: 1,
                    errorMessage: '队必须是有效的对象且不能为空'
                },
                deviceID: {
                    type: 'string'
                },
                avgTime: {
                    default: 0
                },
                freezeTime: {
                    default: 0
                },
                relayConf: {
                    type: 'string'
                },
                waitingTotalNum: {},
                encryptCode: {
                    type: 'string'
                },
                signalUrl: {
                    type: 'string',
                    default: ''
                },
                playToken: {
                    type: 'string'
                }
            }
        }
    }
};
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

// 预先初始化所有验证中间件
const idParamsValidator = validate(path2demo, 'params');
const notifyUpdateValidator = validate(path3demo, 'body');
const noticeQueueValidator = validate(path4demo, 'body');


// 添加路由处理器
app.get('/path1/:id', idParamsValidator, path1handler);
app.post('/path2', notifyUpdateValidator, path2handler); 
app.post('/path3', noticeQueueValidator, path3handler); 

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