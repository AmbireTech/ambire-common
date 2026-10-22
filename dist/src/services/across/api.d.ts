import { Fetch } from '../../interfaces/fetch';
import { SwapAndBridgeRouteStatusResult } from '../../interfaces/swapAndBridge';
export declare class AcrossAPI {
    #private;
    constructor({ fetch }: {
        fetch: Fetch;
    });
    getRouteStatus({ txHash }: {
        txHash: string;
    }): Promise<SwapAndBridgeRouteStatusResult>;
}
//# sourceMappingURL=api.d.ts.map