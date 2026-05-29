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
    isHumanized: boolean;
    constructor(error: any);
}
declare class SponsorshipPaymasterError extends Error {
    isHumanized: boolean;
    constructor();
}
declare class BundlerError extends Error {
    bundlerName: BUNDLER;
    constructor(message: string, bundlerName: BUNDLER);
}
export { BundlerError, InnerCallFailureError, RelayerPaymasterError, SponsorshipPaymasterError };
//# sourceMappingURL=customErrors.d.ts.map