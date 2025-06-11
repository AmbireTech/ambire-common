import { Account } from '../../interfaces/account';
import { AccountOpAction, Action as ActionFromActionsQueue } from '../../interfaces/actions';
import { Banner } from '../../interfaces/banner';
import { Network } from '../../interfaces/network';
import { CashbackStatusByAccount } from '../../interfaces/selectedAccount';
import { SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge';
export declare const getBridgeBanners: (activeRoutes: SwapAndBridgeActiveRoute[], accountOpActions: AccountOpAction[]) => Banner[];
export declare const getDappActionRequestsBanners: (actions: ActionFromActionsQueue[]) => Banner[];
export declare const getAccountOpBanners: ({ accountOpActionsByNetwork, selectedAccount, accounts, networks, swapAndBridgeRoutesPendingSignature }: {
    accountOpActionsByNetwork: {
        [key: string]: AccountOpAction[];
    };
    selectedAccount: string;
    accounts: Account[];
    networks: Network[];
    swapAndBridgeRoutesPendingSignature: SwapAndBridgeActiveRoute[];
}) => Banner[];
export declare const getKeySyncBanner: (addr: string, email: string, keys: string[]) => Banner;
export declare const getFirstCashbackBanners: ({ selectedAccountAddr, cashbackStatusByAccount }: {
    selectedAccountAddr: string;
    cashbackStatusByAccount: CashbackStatusByAccount;
}) => Banner[];
//# sourceMappingURL=banners.d.ts.map