import type { Network } from '../interfaces/network';
import type { BaseAccount } from '../libs/account/BaseAccount';
export declare function getShouldStateOverride(network: Network, baseAcc: BaseAccount): boolean;
/**
 * Get the state override needed for accounts that are not Ambire smart accounts
 * like EOA, 7702 EOA that haven't become 7702, yet, or Safe accounts
 */
export declare function getNotAmbireStateOverride(accountAddr: string, network: Network): {
    [accountAddr]: {
        code: string;
        stateDiff: {
            [x: string]: string;
        };
    };
};
//# sourceMappingURL=simulationStateOverride.d.ts.map