import { AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { BaseAccount } from '../account/BaseAccount';
import { AccountOp } from '../accountOp/accountOp';
interface EthSimulateV1Log {
    address: string;
    topics?: string[];
}
interface EthSimulateV1Call {
    logs?: EthSimulateV1Log[];
}
interface EthSimulateV1Block {
    calls?: EthSimulateV1Call[];
}
export declare function parseEthSimulateV1Result(result: EthSimulateV1Block[] | undefined, callTo?: string | string[]): {
    tokens: string[];
    nfts: [string, bigint[]][];
};
export declare function getEthSimulateV1Params(op: AccountOp): {
    callTargets: string[];
    params: [
        {
            blockStateCalls: {
                stateOverrides: any;
                calls: {
                    to?: string;
                    value: string;
                    data: string;
                    from: string;
                }[];
            }[];
            validation: false;
        },
        'latest'
    ];
} | null;
export declare function ethSimulateV1(baseAcc: BaseAccount, op: AccountOp, network: Network, accountState: AccountOnchainState): Promise<{
    tokens: string[];
    nfts: [string, bigint[]][];
}>;
export {};
//# sourceMappingURL=ethSimulatev1.d.ts.map