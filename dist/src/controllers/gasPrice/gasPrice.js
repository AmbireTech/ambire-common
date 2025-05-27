"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GasPriceController = void 0;
const tslib_1 = require("tslib");
const errorDecoder_1 = require("../../libs/errorDecoder");
const types_1 = require("../../libs/errorDecoder/types");
const gasPrice_1 = require("../../libs/gasPrice/gasPrice");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const types_2 = require("../estimation/types");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
class GasPriceController extends eventEmitter_1.default {
    #network;
    #provider;
    #bundlerSwitcher;
    #getSignAccountOpState;
    // network => GasRecommendation[]
    gasPrices = {};
    // network => BundlerGasPrice
    bundlerGasPrices = {};
    blockGasLimit = undefined;
    stopRefetching = false;
    constructor(network, provider, bundlerSwitcher, getSignAccountOpState) {
        super();
        this.#network = network;
        this.#provider = provider;
        this.#bundlerSwitcher = bundlerSwitcher;
        this.#getSignAccountOpState = getSignAccountOpState;
    }
    async refetch() {
        await (0, wait_1.default)(12000);
        if (this.stopRefetching)
            return;
        const signAccountOpState = this.#getSignAccountOpState();
        if (!signAccountOpState.isSignRequestStillActive())
            return;
        // no need to update the gas prices if the estimation status is Error
        // try again after 12s
        if (signAccountOpState.estimation.status === types_2.EstimationStatus.Error) {
            this.refetch();
            return;
        }
        this.fetch('major');
    }
    async fetch(emitLevelOnFailure = 'silent') {
        const bundler = this.#bundlerSwitcher.getBundler();
        const [gasPriceData, bundlerGas] = await Promise.all([
            (0, gasPrice_1.getGasPriceRecommendations)(this.#provider, this.#network).catch((e) => {
                const signAccountOpState = this.#getSignAccountOpState();
                const estimation = signAccountOpState.estimation;
                // if the gas price data has been fetched once successfully OR an estimation error
                // is currently being displayed, do not emit another error
                if (this.gasPrices[this.#network.chainId.toString()] || estimation.estimationRetryError)
                    return;
                const { type } = (0, errorDecoder_1.decodeError)(e);
                let message = "We couldn't retrieve the latest network fee information.";
                if (type === types_1.ErrorType.ConnectivityError) {
                    message = 'Network connection issue prevented us from retrieving the current network fee.';
                }
                this.emitError({
                    level: emitLevelOnFailure,
                    message,
                    error: new Error(`Failed to fetch gas price on ${this.#network.name}: ${e?.message}`)
                });
                return null;
            }),
            this.#network.erc4337.hasBundlerSupport !== false
                ? bundler
                    // no error emits here as most of the time estimation/signing
                    // will work even if this fails
                    .fetchGasPrices(this.#network, () => { })
                    .catch((e) => {
                    this.emitError({
                        level: 'silent',
                        message: "Failed to fetch the bundler's gas price",
                        error: e
                    });
                })
                : null
        ]);
        if (gasPriceData) {
            if (gasPriceData.gasPrice)
                this.gasPrices[this.#network.chainId.toString()] = gasPriceData.gasPrice;
            this.blockGasLimit = gasPriceData.blockGasLimit;
        }
        if (bundlerGas)
            this.bundlerGasPrices[this.#network.chainId.toString()] = {
                speeds: bundlerGas,
                bundler: bundler.getName()
            };
        this.emitUpdate();
        this.refetch();
    }
    reset() {
        this.stopRefetching = true;
    }
}
exports.GasPriceController = GasPriceController;
//# sourceMappingURL=gasPrice.js.map