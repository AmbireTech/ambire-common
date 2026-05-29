export declare function fetchPost(_fetch: any, url: string, body: any): Promise<any>;
export declare function fetchGet(_fetch: any, url: string): Promise<any>;
export declare function fetchCaught<R>(_fetch: any, url: any, params?: any): Promise<{
    body?: R;
    resp?: any;
    errMsg: string;
}>;
//# sourceMappingURL=fetch.d.ts.map