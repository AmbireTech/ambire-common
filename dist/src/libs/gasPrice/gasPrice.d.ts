import { Provider } from 'ethers';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { AccountOp } from '../accountOp/accountOp';
export declare const MIN_GAS_PRICE = 1000000000n;
export interface GasPriceRecommendation {
    name: string;
    gasPrice: bigint;
}
export interface Gas1559Recommendation {
    name: string;
    baseFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
}
export type GasRecommendation = GasPriceRecommendation | Gas1559Recommendation;
export declare function getGasPriceRecommendations(provider: Provider, network: Network, blockTag?: string | number): Promise<{
    gasPrice: GasRecommendation[];
    blockGasLimit: bigint;
}>;
export declare function getProbableCallData(account: Account, accountOp: AccountOp, accountState: AccountOnchainState, network: Network): string;
//# sourceMappingURL=gasPrice.d.ts.map