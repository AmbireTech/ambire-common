import { BUNDLER } from '../../consts/bundlers';
import { Network } from '../../interfaces/network';
import { Call } from '../accountOp/types';
declare class InnerCallFailureError extends Error {
    data: string;
    calls: Call[];
    nativePortfolioValue: bigint | undefined;
    network: Network;
    constructor(message: string, calls: Call[], network: Network, nativePortfolioValue?: bigint);
}
declare class RelayerPaymasterError extends Error {
    constructor(error: any);
}
declare class SponsorshipPaymasterError extends Error {
    constructor();
}
declare class BundlerError extends Error {
    bundlerName: BUNDLER;
    constructor(message: string, bundlerName: BUNDLER);
}
export { InnerCallFailureError, RelayerPaymasterError, SponsorshipPaymasterError, BundlerError };
//# sourceMappingURL=customErrors.d.ts.map