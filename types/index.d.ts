/// <reference types="node" />
// Type definitions for uWebKoa
// 源码为 JavaScript，本文件为使用方提供类型提示与类型检查。
// 需要 @types/node(本库为 Node 环境专用)。

/** uWebKoa 构造选项 */
export interface UWebKoaOptions {
    /** 项目根目录，默认 process.cwd() */
    rootDir?: string;
    /** 静态目录映射 */
    staticDirs?: Record<string, string>;
    /** SSL 配置；为 null/未设则普通 HTTP */
    ssl?: { key_file_name?: string; cert_file_name?: string; passphrase?: string } | null;
    /** 关闭内置默认错误处理中间件 */
    disableDefaultErrorHandler?: boolean;
    /** 超时配置(毫秒) */
    timeout?: {
        /** 请求总超时，默认 30000 */
        request?: number;
        /** 中间件链超时，默认 0=关闭 */
        middleware?: number;
    };
    [key: string]: any;
}

/** Cookie 选项 */
export interface CookieOptions {
    maxAge?: number;
    expires?: Date;
    domain?: string;
    /** 默认 '/' */
    path?: string;
    /** 默认 true；传 false 关闭 */
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: boolean | 'Strict' | 'Lax' | 'None';
}

export interface Cookies {
    get(name: string): string | undefined;
    set(name: string, value: string, options?: CookieOptions): Cookies;
}

export interface RequestObject {
    url: string;
    /** 大写方法，如 'GET' */
    method: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    queryString: string;
    params: Record<string, string>;
    body?: any;
}

export interface ResponseObject {
    status: number;
    headers: Record<string, string | string[]>;
    body: any;
}

/** HTTP 请求上下文 */
export interface Context {
    req: any;
    res: any;
    request: RequestObject;
    response: ResponseObject;
    type: 'http' | 'ws';
    /** 请求级用户暂存区(如鉴权用户)；WS 升级期会带入连接期 */
    state: Record<string, any>;
    app: uWebKoa;
    options: UWebKoaOptions;

    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    /** 客户端 IP(socket 地址) */
    readonly ip: string;
    readonly cookies: Cookies;
    body: any;
    status: number;

    /** 读取请求头(不区分大小写) */
    get(field: string): string | undefined;
    /** 设置响应头；值可为数组(多个同名头) */
    set(key: string, value: string | string[]): this;
    setStatus(code: number): this;
    setBody(data: any): this;
    /** 设置 JSON 响应体 */
    json(data: any): this;
    /** 发送响应(通常由框架自动调用) */
    send(): this;
    /** 发送文件；返回是否成功 */
    sendFile(filePath: string): Promise<boolean>;
    parseParams(pattern: string): void;
    parseBody(): Promise<void>;
    onAborted(handler: () => void): this;
    /** 抛出带状态码的错误 */
    throw(status: number, message?: string, properties?: object): never;
    assert(condition: any, status: number, message?: string, properties?: object): void;
    redirect(url: string, status?: number): this;

    [key: string]: any;
}

/** 中间件(HTTP 与 WS 升级通用) */
export type Middleware = (ctx: Context, next: () => Promise<void>) => any | Promise<any>;

/** WebSocket 连接上下文 */
export interface WsContext {
    type: 'ws';
    ws: any;
    app: uWebKoa;
    state: Record<string, any>;
    request: {
        url: string;
        headers: Record<string, string>;
        query: Record<string, string>;
        params: Record<string, string>;
    };
    /** 发送消息，返回发送状态(见 SendStatus) */
    send(data: any, isBinary?: boolean, compress?: boolean): number;
    getBufferedAmount(): number;
    ping(message?: any): number;
    cork(cb: () => void): void;
    subscribe(topic: string): boolean;
    unsubscribe(topic: string): boolean;
    isSubscribed(topic: string): boolean;
    publish(topic: string, data: any, isBinary?: boolean, compress?: boolean): boolean;
    close(code?: number, shortMessage?: string): void;
    getRemoteAddress(): string;
    [key: string]: any;
}

/** uWebSockets.js 原生 WebSocket 连接配置(透传) */
export interface WsConfig {
    idleTimeout?: number;
    maxPayloadLength?: number;
    maxBackpressure?: number;
    maxLifetime?: number;
    compression?: number;
    sendPingsAutomatically?: boolean;
    closeOnBackpressureLimit?: boolean;
    /** 为 true 时 message 收到原始 ArrayBuffer(零拷贝)，否则收到 Buffer */
    rawMessage?: boolean;
    [key: string]: any;
}

export interface WsHandlers {
    config?: WsConfig;
    /** 升级前中间件；ctx.throw 或显式设状态码即拒绝升级 */
    upgrade?: Middleware | Middleware[];
    open?: (ctx: WsContext) => void;
    message?: (ctx: WsContext, data: Buffer | ArrayBuffer, isBinary: boolean) => void;
    drain?: (ctx: WsContext) => void;
    ping?: (ctx: WsContext, message: Buffer | null) => void;
    pong?: (ctx: WsContext, message: Buffer | null) => void;
    dropped?: (ctx: WsContext, data: Buffer | ArrayBuffer, isBinary: boolean) => void;
    close?: (ctx: WsContext, code: number, message: Buffer | null) => void;
}

export interface ListenOptions {
    cluster?: boolean;
    threads?: boolean;
    workers?: number;
}

/** WebSocket 发送状态 */
export interface SendStatus {
    readonly BACKPRESSURE: 0;
    readonly SUCCESS: 1;
    readonly DROPPED: 2;
}

export default class uWebKoa {
    constructor(options?: UWebKoaOptions);

    middlewares: Middleware[];
    /** 全局上下文，会浅合并到每个请求的 ctx(如 ctx.io、ctx.db) */
    context: Record<string, any>;
    options: UWebKoaOptions;

    static readonly SendStatus: SendStatus;

    /** 注册中间件 */
    use(middleware: Middleware): this;

    /** 注册路由 */
    get(pattern: string, ...handlers: Middleware[]): this;
    post(pattern: string, ...handlers: Middleware[]): this;
    put(pattern: string, ...handlers: Middleware[]): this;
    delete(pattern: string, ...handlers: Middleware[]): this;

    /** 返回一个执行路由匹配的中间件(向后兼容) */
    route(method: string, pattern: string, ...handlers: Middleware[]): Middleware;
    /** 判断 url 是否匹配 pattern */
    matchPattern(url: string, pattern: string): boolean;

    /** 注册 WebSocket 路由 */
    ws(pattern: string, handlers?: WsHandlers): this;
    /** 注册全局 WS 升级中间件 */
    wsUse(middleware: Middleware): this;
    /** 向主题发布消息(HTTP 侧向 WS 推送) */
    publish(topic: string, message: any, isBinary?: boolean, compress?: boolean): boolean;

    /** 静态文件服务 */
    serveStatic(urlPrefix: string, rootDir: string): this;

    createContext(res: any, req: any, options?: { type?: 'http' | 'ws' }): Context;
    createApp(sslOptions?: any): any;
    getUWebSocketApp(): any;
    applyToApp(app: any): any;

    /** 启动服务器 */
    listen(port: number, options?: ListenOptions): Promise<any>;
    listen(app: any, port: number): Promise<any>;
}
