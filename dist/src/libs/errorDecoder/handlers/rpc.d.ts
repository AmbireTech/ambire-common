import { DecodedError, ErrorHandler } from '../types';
export declare const RPC_HARDCODED_ERRORS: {
    rpcTimeout: string;
};
declare class RpcErrorHandler implements ErrorHandler {
    matches(data: string, error: any): boolean;
    handle(data: string, error: Error): DecodedError;
}
export default RpcErrorHandler;
//# sourceMappingURL=rpc.d.ts.map