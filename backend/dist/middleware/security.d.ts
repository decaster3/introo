import { RequestHandler } from 'express';
/**
 * Security headers middleware
 * Adds essential security headers to all responses
 */
export declare const securityHeaders: RequestHandler;
/**
 * Cookie security configuration for JWT cookies
 */
export declare const cookieConfig: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict" | "lax";
    maxAge: number;
    path: string;
};
/**
 * HTTPS redirect middleware (for use behind a load balancer/proxy)
 */
export declare const httpsRedirect: RequestHandler;
declare const _default: {
    securityHeaders: RequestHandler<import("express-serve-static-core").ParamsDictionary, any, any, import("qs").ParsedQs, Record<string, any>>;
    cookieConfig: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: "strict" | "lax";
        maxAge: number;
        path: string;
    };
    httpsRedirect: RequestHandler<import("express-serve-static-core").ParamsDictionary, any, any, import("qs").ParsedQs, Record<string, any>>;
};
export default _default;
//# sourceMappingURL=security.d.ts.map