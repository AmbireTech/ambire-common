import { canBecomeSmarterOnChain } from './account';
import { EOA } from './EOA';
import { EOA7702 } from './EOA7702';
import { Safe } from './Safe';
import { V1 } from './V1';
import { V2 } from './V2';
export function getBaseAccount(account, accountState, network) {
    if (account.safeCreation)
        return new Safe(account, network, accountState);
    if (accountState.isEOA) {
        if (accountState.isSmarterEoa || canBecomeSmarterOnChain(network, account, accountState)) {
            return new EOA7702(account, network, accountState);
        }
        return new EOA(account, network, accountState);
    }
    return accountState.isV2
        ? new V2(account, network, accountState)
        : new V1(account, network, accountState);
}
//# sourceMappingURL=getBaseAccount.js.map