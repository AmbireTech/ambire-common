import { Account, AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../accountOp/accountOp';
import { TokenResult } from '../portfolio';
import { ProviderEstimation } from './interfaces';
export declare function getEstimateGasProps(op: AccountOp, account: Account, accountState: AccountOnchainState): {
    from: Hex;
    to: Hex;
    value: Hex;
    data: Hex;
    useStateOverride: boolean;
};
export declare function providerEstimateGas(account: Account, op: AccountOp, provider: RPCProvider, accountState: AccountOnchainState, network: Network, feeTokens: TokenResult[]): Promise<ProviderEstimation | Error | null>;
//# sourceMappingURL=providerEstimateGas.d.ts.map