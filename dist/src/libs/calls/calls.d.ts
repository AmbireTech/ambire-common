import { Network } from '../../interfaces/network';
import { Call } from '../accountOp/types';
import { TokenResult } from '../portfolio';
export declare function getFeeCall(feeToken: TokenResult): Call;
export declare function decodeFeeCall({ to, value, data }: Call, network: Network): {
    address: string;
    amount: bigint;
    isGasTank: boolean;
    chainId: bigint;
};
//# sourceMappingURL=calls.d.ts.map