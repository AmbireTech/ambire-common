import { HeadersInit, RequestInfo, RequestInit, Response } from 'node-fetch';
export interface CustomResponse extends Response {
    [key: string]: any;
}
export interface RequestInitWithCustomHeaders extends RequestInit {
    headers: HeadersInit & {
        'x-app-source'?: string;
        'x-app-version'?: string;
        'x-app-env'?: string;
        'x-api-key'?: string;
        'X-API-Key'?: string;
        'x-lifi-api-key'?: string;
        'x-permit2-disabled'?: string;
    };
}
export type Fetch = (input: RequestInfo, init?: RequestInitWithCustomHeaders) => Promise<CustomResponse>;
//# sourceMappingURL=fetch.d.ts.map