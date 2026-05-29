"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionManagerController = void 0;
const tslib_1 = require("tslib");
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const intent_1 = require("./controllers/intent");
const transactionFormState_1 = require("./transactionFormState");
class TransactionManagerController extends eventEmitter_1.default {
    intent;
    formState;
    #controllers = [];
    transactionType = 'transfer';
    #dependencies;
    #chainMap = [chains_1.sepolia, chains_1.arbitrumSepolia, chains_1.baseSepolia];
    constructor(deps) {
        super(deps.eventEmitterRegistry);
        // TODO: intialize interopSDK here
        this.#dependencies = { ...deps, interopSDK: null };
        this.formState = new transactionFormState_1.TransactionFormState(this.#dependencies);
        this.intent = new intent_1.IntentController(this.#dependencies, this.formState);
        this.#controllers = [this.formState, this.intent];
        this.registerControllerUpdates();
    }
    registerControllerUpdates() {
        this.#controllers.forEach((controller) => {
            controller.onUpdate(async (forceUpdate) => {
                // TODO: Better type than "any"
                if (controller.toJSON().name === 'TransactionFormState') {
                    try {
                        await this.handleFormUpdate();
                    }
                    catch (error) {
                        this.emitError({ error, level: 'silent', message: error?.message });
                    }
                }
                // when any controller updates, propagate through the manager
                this.propagateUpdate(forceUpdate);
            }, `${controller.constructor.name}-update`);
        });
    }
    /*
     * Same-chain transfers: same chain, same token -> type: transfer
     * Same-chain swaps: same chain, different token -> type: swap
     * Cross-chain transfer: different chain, same token -> type: intent
     * Cross-chain swapAndBridge: different chain, different token -> type: swapAndBridge
     * Error: Same address, same chain, same token -> type: error
     */
    async handleFormUpdate() {
        if (!this.formState.recipientAddress || !this.formState.addressState.interopAddress) {
            this.transactionType = 'error';
            return;
        }
        if (this.formState.fromChainId === this.formState.toChainId) {
            if (this.formState.toSelectedToken?.address === this.formState.fromSelectedToken?.address) {
                if (this.formState.addressState.fieldValue ===
                    this.#dependencies.selectedAccount.account?.addr) {
                    this.transactionType = 'error';
                    return;
                }
                this.transactionType = 'transfer';
                return;
            }
            this.transactionType = 'swap';
        }
        else if (this.formState.fromChainId !== this.formState.toChainId) {
            if (this.formState.toSelectedToken?.symbol === this.formState.fromSelectedToken?.symbol &&
                this.formState.toSelectedToken?.decimals === this.formState.fromSelectedToken?.decimals) {
                this.transactionType = 'intent';
                await this.intent.getProtocolQuote();
                if (this.formState.fromChainId) {
                    this.intent.publicClient = this.getPublicClient(this.formState.fromChainId);
                }
                return;
            }
            this.transactionType = 'swapAndBridge';
            return;
        }
        this.transactionType = 'error';
    }
    getPublicClient(chainId) {
        const chain = this.#chainMap.find((c) => c.id === chainId);
        if (!chain)
            return;
        return (0, viem_1.createPublicClient)({
            chain,
            transport: (0, viem_1.http)()
        });
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            transactionType: this.transactionType,
            formState: this.formState.toJSON(),
            intent: this.intent.toJSON()
        };
    }
}
exports.TransactionManagerController = TransactionManagerController;
//# sourceMappingURL=transactionManager.js.map