import { Provider } from 'ethers';
import { AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { GasSpeeds } from '../../services/bundlers/types';
import { BaseAccount } from '../account/BaseAccount';
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
export declare function getGasPriceRecommendations(provider: Provider, network: Network, _blockTag?: string | number, getIsActive?: () => boolean): Promise<{
    gasPrice: GasRecommendation[];
}>;
export declare function getProbableCallData(accountOp: AccountOp, accountState: AccountOnchainState, shouldIncludeActivatorCall: boolean): string;
export declare function getBroadcastGas(baseAcc: BaseAccount, op: AccountOp): bigint;
/**
 * As the name suggests, take our libs gas price format and transform it to match
 * the one returned from the bundler
 *
 * @param gasRecommendations - our lib's format
 * @returns GasSpeeds - the bundler format
 */
export declare function gasPriceToBundlerFormat(gasRecommendations: GasRecommendation[]): GasSpeeds;
//# sourceMappingURL=gasPrice.d.ts.map