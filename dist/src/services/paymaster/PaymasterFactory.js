import { Paymaster } from '../../libs/paymaster/paymaster';
import { relayerCall } from '../../libs/relayerCall/relayerCall';
import { failedPaymasters } from './FailedPaymasters';
// a factory for creating paymaster objects
// this is needed as we'd like to create paymasters at will with easy
// access to app properties like relayerUrl and Fetch
// so we init the PaymasterFactory in the main controller and use it
// throught the app as a singleton
export class PaymasterFactory {
    callRelayer = undefined;
    errorCallback = undefined;
    init(relayerUrl, fetch, errorCallback) {
        this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch });
        this.errorCallback = errorCallback;
    }
    async create(op, userOp, network, provider) {
        if (this.callRelayer === undefined || this.errorCallback === undefined)
            throw new Error('call init first');
        // check whether the sponsorship has failed and if it has,
        // mark it like so in the meta for the paymaster to know
        const localOp = { ...op };
        const paymasterServiceId = op.meta?.paymasterService?.id;
        if (paymasterServiceId && failedPaymasters.hasFailedSponsorship(paymasterServiceId)) {
            if (localOp.meta && localOp.meta.paymasterService)
                localOp.meta.paymasterService.failed = true;
        }
        const paymaster = new Paymaster(this.callRelayer, this.errorCallback);
        await paymaster.init(localOp, userOp, network, provider);
        return paymaster;
    }
}
//# sourceMappingURL=PaymasterFactory.js.map