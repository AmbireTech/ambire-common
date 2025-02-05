import { HeadersInit, RequestInfo, RequestInit, Response } from 'node-fetch';
export interface CustomResponse extends Response {
    [key: string]: any;
}
export interface RequestInitWithCustomHeaders extends RequestInit {
    headers: HeadersInit & {
        'x-app-source'?: string;
        'x-api-key'?: string;
    };
}
export type Fetch = (input: RequestInfo, init?: RequestInitWithCustomHeaders) => Promise<CustomResponse>;
//# sourceMappingURL=fetch.d.ts.map