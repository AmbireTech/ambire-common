import { Account, AccountId } from '../../interfaces/account';
import { Banner } from '../../interfaces/banner';
import { Network } from '../../interfaces/network';
import { SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge';
import { CallsUserRequest, UserRequest } from '../../interfaces/userRequest';
import { PositionCountOnDisabledNetworks } from '../defiPositions/types';
import { HumanizerVisualization } from '../humanizer/interfaces';
export declare const getCurrentAccountBanners: (banners: Banner[], selectedAccount?: AccountId) => Banner[];
export declare const getBridgeBanners: (activeRoutes: SwapAndBridgeActiveRoute[], callsUserRequests: CallsUserRequest[]) => Banner[];
export declare const getSafeMessageRequestBanners: (account: Account, userRequests: UserRequest[]) => Banner[];
export declare const getDappUserRequestsBanners: (account: Account, userRequests: UserRequest[]) => Banner[];
export declare const getAccountOpBanners: ({ callsUserRequestsByNetwork, selectedAccount, networks }: {
    callsUserRequestsByNetwork: {
        [key: string]: CallsUserRequest[];
    };
    selectedAccount: Account;
    networks: Network[];
}) => Banner[];
export declare const getKeySyncBanner: (addr: string, email: string, keys: string[]) => Banner;
export declare const defiPositionsOnDisabledNetworksBannerId = "defi-positions-on-disabled-networks-banner";
export declare const getDefiPositionsOnDisabledNetworksForTheSelectedAccount: ({ defiPositionsCountOnDisabledNetworks, networks, accountAddr }: {
    defiPositionsCountOnDisabledNetworks: PositionCountOnDisabledNetworks[string];
    networks: Network[];
    accountAddr: string;
}) => Banner[];
export declare function getScamDetectedText(blacklistedItems: HumanizerVisualization[]): string;
//# sourceMappingURL=banners.d.ts.map