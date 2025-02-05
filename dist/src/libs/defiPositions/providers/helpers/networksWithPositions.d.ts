import { AccountId } from '../../../../interfaces/account';
import { RPCProviders } from '../../../../interfaces/provider';
import { AccountState, NetworksWithPositions, NetworksWithPositionsByAccounts } from '../../types';
declare const getAccountNetworksWithPositions: (accountId: AccountId, accountState: AccountState, oldNetworksWithPositionsByAccounts: NetworksWithPositionsByAccounts, providers: RPCProviders) => NetworksWithPositions;
export default getAccountNetworksWithPositions;
//# sourceMappingURL=networksWithPositions.d.ts.map