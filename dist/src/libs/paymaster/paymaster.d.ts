import { Account } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { GasSpeeds } from '../../services/bundlers/types';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
import { PaymasterErrorReponse, PaymasterEstimationData, PaymasterService, PaymasterSuccessReponse } from '../erc7677/types';
import { BundlerEstimateResult } from '../estimate/interfaces';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
import { AbstractPaymaster } from './abstractPaymaster';
/**
 * Available paymaster types:
 * - Ambire: when using the standart Ambire paymaster, fee is expected
 * in native, allowed tokens or the gas tank
 * - ERC7677: when a dapp requests sponsorship via ERC-7677:
 * https://eips.ethereum.org/EIPS/eip-7677
 * - SwapSponsorship: used for inner swap & bridge. When the txn fee is lower
 * than the swap fee, the paymaster sponsors the userOperation
 */
type PaymasterType = 'Ambire' | 'ERC7677' | 'SwapSponsorship' | 'None';
export declare function getPaymasterDataForEstimate(): PaymasterEstimationData;
export declare class Paymaster extends AbstractPaymaster {
    #private;
    callRelayer: Function;
    type: PaymasterType;
    op: AccountOp | null;
    paymasterService: PaymasterService | null;
    network: Network | null;
    provider: RPCProvider | null;
    errorCallback: Function | undefined;
    ambirePaymasterUrl: string | undefined;
    constructor(relayerUrl: string, fetch: Fetch, errorCallback: Function);
    init(op: AccountOp, userOp: UserOperation, account: Account, network: Network, provider: RPCProvider): Promise<void>;
    shouldIncludePayment(): boolean;
    getFeeCallType(feeTokens: TokenResult[]): string | undefined;
    getFeeCallForEstimation(feeTokens: TokenResult[]): Call | undefined;
    getEstimationData(): PaymasterEstimationData | null;
    isSponsored(): boolean;
    isUsable(): boolean;
    call(acc: Account, op: AccountOp, userOp: UserOperation, network: Network): Promise<PaymasterSuccessReponse | PaymasterErrorReponse>;
    isAmbire(): boolean;
    isEstimateBelowMin(localOp: UserOperation): boolean;
    /**
     * We use the upgrade method when we initially need to start with another
     * paymaster type, e.g. Ambire, but then we understand we can use another
     * one because special conditions apply.
     * One such case is the swap&bridge where we first need to know the estimation
     * from the bundler so we could calculate the txn fee. If the swap fee is
     * bigger than the txn fee, we upgrade the paymaster to SwapSponsorship.
     */
    upgrade(bundlerEstimateResult: BundlerEstimateResult, gasPrices: GasSpeeds): void;
}
export {};
//# sourceMappingURL=paymaster.d.ts.map