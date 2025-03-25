// ./middlewares/notFound.js
export default function notFound() {
    return async (ctx) => {
        ctx.body = "Not Found";
        ctx.status = 404;
    };
}