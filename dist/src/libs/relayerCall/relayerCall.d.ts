import { Fetch } from '../../interfaces/fetch';
export declare class RelayerError extends Error {
    input: any;
    output: any;
    isHumanized: boolean;
    constructor(message: string, input: any, output: any, isHumanized?: boolean);
}
export declare const RELAYER_DOWN_MESSAGE = "Currently, the Ambire relayer seems to be temporarily down. Please try again a few moments later";
export declare function relayerCallUncaught(url: string, fetch: Fetch, method?: string, body?: any, headers?: any, timeoutMs?: number): Promise<any>;
export type BindedRelayerCall = (path: string, method?: string, body?: any, headers?: any, timeoutMs?: number) => Promise<any>;
export declare function relayerCall(this: {
    url: string;
    fetch: Fetch;
}, path: string, method?: string, body?: any, headers?: any, timeoutMs?: number): Promise<any>;
//# sourceMappingURL=relayerCall.d.ts.map