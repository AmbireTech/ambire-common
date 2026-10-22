import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { IProvidersController } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { Erc7730CallDescriptors, Erc7730ResolvedDescriptor } from '../../libs/humanizer/erc7730/types';
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import EventEmitter from '../eventEmitter/eventEmitter';
/**
 * Owns ERC-7730 "clear signing" descriptors: fetching them, caching them, and keeping that cache in
 * storage so it survives a service worker restart. The only writer of the `erc7730RegistryCache`
 * storage key.
 *
 * The library in `libs/humanizer/erc7730` is entirely synchronous and performs no I/O. It reports
 * what it is *missing* as `Erc7730Want`s; this controller answers them and asks again, until
 * nothing is missing. Each round is one parallel batch, and each nesting level takes one round.
 *
 * So everything external - the relayer, the RPC reads for Safe proxies, the cache, the request
 * dedup and the persistence - lives here.
 */
export declare class Erc7730Controller extends EventEmitter {
    #private;
    constructor({ storage, callRelayer, featureFlags, providers, ui, eventEmitterRegistry }: {
        storage: IStorageController;
        callRelayer: BindedRelayerCall;
        featureFlags: IFeatureFlagsController;
        /** Omit where no RPC access is available. */
        providers?: IProvidersController;
        ui: IUiController;
        eventEmitterRegistry?: IEventEmitterRegistryController;
    });
    getDescriptorsForAccountOp(accountOp: AccountOp): Promise<Erc7730CallDescriptors>;
    getDescriptorForMessage(message: Message): Promise<Erc7730ResolvedDescriptor | null>;
    /**
     * The UI-facing counterpart of `getDescriptorsForAccountOp`, for screens that humanize an
     * accountOp themselves (transaction history, Benzin). Replies to the awaiting `dispatchAndWait`
     * rather than returning, since the UI and this controller are separate contexts in the extension.
     */
    resolveDescriptorsForAccountOp(accountOp: AccountOp, requestId: string): Promise<void>;
}
//# sourceMappingURL=erc7730.d.ts.map