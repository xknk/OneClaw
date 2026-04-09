/**
 * WebChat 访问控制中间件
 * 功能：当环境变量或配置中设置了 WEBCHAT_TOKEN 时，强制校验请求合法性
 */

import type { Request, Response, NextFunction } from "express";
import { appConfig } from "../config/evn";

export function webchatAuth(req: Request, res: Response, next: NextFunction): void {
    // 1. 获取服务器配置的合法 Token
    const token = appConfig.webchatToken;

    // 2. 如果服务器压根没配置 Token，说明是“公开模式”，直接放行
    if (!token) {
        next();
        return;
    }

    // 3. 尝试从两种常见的途径获取请求携带的 Token：

    // 途径 A：HTTP Header 中的 Authorization 字段 (格式通常为: Bearer <token>)
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    // 途径 B：URL 参数中的 token (例如: /api/chat?token=xxx)
    const queryToken = typeof req.query?.token === "string" ? req.query.token : null;

    // 4. 汇总获取到的 Token（优先使用 Header 中的 Bearer Token）
    const provided = bearer ?? queryToken;

    // 5. 校验：如果请求没带 Token，或者带的 Token 跟服务器配置的不一致
    if (provided !== token) {
        // 返回 401 Unauthorized 状态码，并提示错误信息
        res.status(401).json({
            error: "需要有效的 WebChat token（Authorization: Bearer <token> 或 query token=）"
        });
        return;
    }

    // 6. 校验通过，调用 next() 进入下一个逻辑处理（如业务代码）
    next();
}
