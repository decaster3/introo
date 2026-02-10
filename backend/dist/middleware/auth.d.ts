import { Request, RequestHandler } from 'express';
export declare function encryptToken(token: string): string;
export declare function decryptToken(encryptedToken: string): string | null;
export interface JwtPayload {
    userId: string;
    email: string;
}
export interface AuthUser {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
}
export interface AuthenticatedRequest extends Request {
    user?: AuthUser;
}
export declare function configurePassport(): void;
export declare function generateToken(payload: JwtPayload): string;
export declare function verifyToken(token: string): JwtPayload | null;
export declare const authMiddleware: RequestHandler;
export declare const optionalAuthMiddleware: RequestHandler;
//# sourceMappingURL=auth.d.ts.map