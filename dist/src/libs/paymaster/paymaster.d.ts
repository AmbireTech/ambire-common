import { Account } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
import { PaymasterErrorReponse, PaymasterEstimationData, PaymasterService, PaymasterSuccessReponse } from '../erc7677/types';
import { TokenResult } from '../portfolio';
import { UserOperation } from '../userOperation/types';
import { AbstractPaymaster } from './abstractPaymaster';
type PaymasterType = 'Ambire' | 'ERC7677' | 'None';
export declare function getPaymasterDataForEstimate(): PaymasterEstimationData;
export declare class Paymaster extends AbstractPaymaster {
    #private;
    callRelayer: Function;
    type: PaymasterType;
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
    canAutoRetryOnFailure(): boolean;
}
export {};
//# sourceMappingURL=paymaster.d.ts.map