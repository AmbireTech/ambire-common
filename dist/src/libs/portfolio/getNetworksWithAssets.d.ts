import { AccountId } from '../../interfaces/account';
import { RPCProviders } from '../../interfaces/provider';
import { AccountAssetsState, AccountState } from './interfaces';
declare const getAccountNetworksWithAssets: (accountId: AccountId, accountState: AccountState, storageStateByAccount: {
    [accountId: string]: AccountAssetsState;
}, providers: RPCProviders) => AccountAssetsState;
export default getAccountNetworksWithAssets;
//# sourceMappingURL=getNetworksWithAssets.d.ts.map