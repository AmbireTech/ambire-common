import { ISurveyController } from '@/interfaces/survey';
import { Banner, IBannerController } from '../../interfaces/banner';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IStorageController } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
export type AccountData = {
    status: 'no-selected-account';
} | {
    status: 'has-selected-account';
    numberOfTransactions: number;
    totalUsdBalance: number;
    hasKeys: boolean;
    address: string;
    isBalanceReady: boolean;
};
export declare class BannerController extends EventEmitter implements IBannerController {
    #private;
    maxBannerCount: number;
    initialLoadPromise?: Promise<void>;
    constructor(storage: IStorageController, getAccountData: () => AccountData, survey: ISurveyController, appVersion: string, eventEmitterRegistry?: IEventEmitterRegistryController);
    /**
     * Used when account is being switched, because we might want to display
     * different banners for different accounts.
     * The first and only (Apr 2026) such case is survey banners that have
     * to be filtered depending on balance, tx count and keys for acc
     */
    emitUpdateBanners(): void;
    get bannersData(): {
        banners: Banner[];
        account: string | null;
    };
    addBanner(banner: Banner): void;
    dismissBanner(bannerId: string | number): Promise<void>;
    toJSON(): this & {
        bannersData: {
            banners: Banner[];
            account: string | null;
        };
    };
}
//# sourceMappingURL=banner.d.ts.map