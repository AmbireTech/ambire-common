import { Account } from '../../interfaces/account';
import { AccountOpAction, Action as ActionFromActionsQueue } from '../../interfaces/actions';
import { Banner } from '../../interfaces/banner';
import { Network } from '../../interfaces/network';
import { ActiveRoute } from '../../interfaces/swapAndBridge';
import { CashbackStatusByAccount } from '../portfolio/interfaces';
export declare const getBridgeBanners: (activeRoutes: ActiveRoute[], accountOpActions: AccountOpAction[], networks: Network[]) => Banner[];
export declare const getDappActionRequestsBanners: (actions: ActionFromActionsQueue[]) => Banner[];
export declare const getAccountOpBanners: ({ accountOpActionsByNetwork, selectedAccount, accounts, networks, swapAndBridgeRoutesPendingSignature }: {
    accountOpActionsByNetwork: {
        [key: string]: AccountOpAction[];
    };
    selectedAccount: string;
    accounts: Account[];
    networks: Network[];
    swapAndBridgeRoutesPendingSignature: ActiveRoute[];
}) => Banner[];
export declare const getKeySyncBanner: (addr: string, email: string, keys: string[]) => Banner;
export declare const getFirstCashbackBanners: ({ selectedAccountAddr, cashbackStatusByAccount }: {
    selectedAccountAddr: string;
    cashbackStatusByAccount: CashbackStatusByAccount;
}) => Banner[];
//# sourceMappingURL=banners.d.ts.map