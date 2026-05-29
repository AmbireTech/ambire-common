"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EstimationController = void 0;
const tslib_1 = require("tslib");
const ErrorHumanizerError_1 = tslib_1.__importDefault(require("../../classes/ErrorHumanizerError"));
const account_1 = require("../../libs/account/account");
const getBaseAccount_1 = require("../../libs/account/getBaseAccount");
const estimate_1 = require("../../libs/estimate/estimate");
const helpers_1 = require("../../libs/portfolio/helpers");
const accounts_1 = require("../../utils/accounts");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const types_1 = require("./types");
class EstimationController extends eventEmitter_1.default {
    #keystore;
    #accounts;
    #networks;
    #provider;
    #portfolio;
    status = types_1.EstimationStatus.Initial;
    estimation = null;
    error = null;
    /**
     * a boolean to understand if the estimation has been performed
     * at least one indicating clearly that all other are re-estimates
     */
    hasEstimated = false;
    estimationRetryError = null;
    availableFeeOptions = [];
    #bundlerSwitcher;
    #notFatalBundlerError;
    #activity;
    /**
     * Used to prevent slow estimations for a past accountOp overwriting
     * the latest estimation results
     */
    lastAccountOpId = null;
    constructor(keystore, accounts, networks, provider, portfolio, bundlerSwitcher, activity) {
        super();
        this.#keystore = keystore;
        this.#accounts = accounts;
        this.#networks = networks;
        this.#provider = provider;
        this.#portfolio = portfolio;
        this.#bundlerSwitcher = bundlerSwitcher;
        this.#activity = activity;
    }
    #getAvailableFeeOptions(baseAcc, op) {
        const estimation = this.estimation;
        return baseAcc.getAvailableFeeOptions(estimation, estimation.ambireEstimation
            ? estimation.ambireEstimation.feePaymentOptions
            : estimation.providerEstimation
                ? estimation.providerEstimation.feePaymentOptions
                : [], op);
    }
    async estimate(op) {
        this.status = types_1.EstimationStatus.Loading;
        this.emitUpdate();
        const account = this.#accounts.accounts.find((acc) => acc.addr === op.accountAddr);
        const network = this.#networks.networks.find((net) => net.chainId === op.chainId);
        const accountState = await this.#accounts.getOrFetchAccountOnChainState(op.accountAddr, op.chainId);
        if (!accountState) {
            this.error = new Error('During the preparation step, required transaction information was found missing (account state). Please try again later or contact support.');
            this.status = types_1.EstimationStatus.Error;
            this.hasEstimated = true;
            this.emitUpdate();
            return;
        }
        const baseAcc = (0, getBaseAccount_1.getBaseAccount)(account, accountState, network);
        // Take the fee tokens from two places: the user's tokens and his gasTank
        // The gasTank tokens participate on each network as they belong everywhere
        // NOTE: at some point we should check all the "?" signs below and if
        // an error pops out, we should notify the user about it
        let networkFeeTokens = this.#portfolio.getAccountPortfolioState(op.accountAddr)?.[op.chainId.toString()]?.result
            ?.feeTokens ?? [];
        // This could happen only in a race when a NOT currently selected account is
        // requested, switched to and immediately fired a txn request for. In that situation,
        // the portfolio would not be fetched and the estimation would be fired without tokens,
        // resulting in a "nothing to pay the fee with" error which is absolutely wrong
        if (networkFeeTokens.length === 0) {
            await this.#portfolio.updateSelectedAccount(op.accountAddr, [network]);
            networkFeeTokens =
                this.#portfolio.getAccountPortfolioState(op.accountAddr)?.[op.chainId.toString()]?.result
                    ?.feeTokens ?? [];
        }
        const gasTankResult = this.#portfolio.getAccountPortfolioState(op.accountAddr)?.gasTank?.result;
        const gasTankFeeTokens = (0, helpers_1.isPortfolioGasTankResult)(gasTankResult)
            ? gasTankResult.gasTankTokens
            : [];
        const feeTokens = [...networkFeeTokens, ...gasTankFeeTokens].filter((t) => t.flags.isFeeToken) || [];
        // Here, we list EOA accounts for which you can also obtain an estimation of the AccountOp payment.
        // In the case of operating with a smart account (an account with creation code), all other EOAs can pay the fee.
        //
        // If the current account is an EOA, only this account can pay the fee,
        // and there's no need for checking other EOA accounts native balances.
        // This is already handled and estimated as a fee option in the estimate library, which is why we pass an empty array here.
        //
        // we're excluding the view only accounts from the natives to check
        // in all cases EXCEPT the case where we're making an estimation for
        // the view only account itself. In all other, view only accounts options
        // should not be present as the user cannot pay the fee with them (no key)
        const nativeToCheck = baseAcc.canBroadcastByOtherEOA()
            ? this.#accounts.accounts
                .filter((acc) => !(0, account_1.isSmartAccount)(acc) &&
                (acc.addr === op.accountAddr ||
                    !(0, accounts_1.getIsViewOnly)(this.#keystore.keys, acc.associatedKeys)))
                // internal keys first
                .sort((a, b) => {
                const aKeyInternal = this.#keystore.keys.find((k) => k.type === 'internal' && k.addr === a.addr);
                const bKeyInternal = this.#keystore.keys.find((k) => k.type === 'internal' && k.addr === b.addr);
                if (aKeyInternal && !bKeyInternal)
                    return -1;
                if (!aKeyInternal && bKeyInternal)
                    return 1;
                return 0;
            })
                .map((acc) => acc.addr)
            : [];
        this.lastAccountOpId = op.id;
        const estimation = await (0, estimate_1.getEstimation)(baseAcc, accountState, op, network, this.#provider, feeTokens, nativeToCheck, this.#bundlerSwitcher, (this.#activity.broadcastedButNotConfirmed[account.addr] || []).find((accOp) => accOp.chainId === network.chainId && !!accOp.asUserOperation)).catch((e) => {
            console.error(e);
            return e;
        });
        // Done to prevent race conditions
        if (op.id !== this.lastAccountOpId) {
            const error = new Error(`Estimation race condition prevented. Op id: ${op.id}. Expected: ${this.lastAccountOpId}`);
            this.emitError({
                message: 'Estimation race condition prevented',
                error,
                level: 'silent'
            });
            return;
        }
        const isSuccess = !(estimation instanceof Error) && !estimation.criticalError;
        if (isSuccess) {
            this.estimation = (0, estimate_1.getEstimationSummary)(estimation);
            this.error = null;
            this.status = types_1.EstimationStatus.Success;
            this.estimationRetryError = null;
            this.availableFeeOptions = this.#getAvailableFeeOptions(baseAcc, op);
            this.#notFatalBundlerError =
                estimation.bundler instanceof Error
                    ? new Error(estimation.bundler.message, { cause: '4337_ESTIMATION' })
                    : undefined;
        }
        else {
            this.estimation = null;
            this.error = estimation instanceof Error ? estimation : estimation.criticalError;
            this.status = types_1.EstimationStatus.Error;
            this.availableFeeOptions = [];
        }
        // estimation.flags.hasNonceDiscrepancy is a signal from the estimation
        // that the account state is not the latest and needs to be updated
        if (this.estimation &&
            (this.estimation.flags.hasNonceDiscrepancy || this.estimation.flags.has4337NonceDiscrepancy)) {
            // continue on error here as the flags are more like app helpers
            this.#accounts
                .updateAccountState(op.accountAddr, 'pending', [op.chainId])
                .catch((e) => console.error(e));
        }
        this.hasEstimated = true;
        this.emitUpdate();
    }
    /**
     * it's initialized if it has estimated at least once
     */
    isInitialized() {
        return this.hasEstimated;
    }
    /**
     * has it estimated at least once without a failure
     */
    isLoadingOrFailed() {
        return this.status === types_1.EstimationStatus.Loading || this.error instanceof Error;
    }
    calculateWarnings() {
        const warnings = [];
        if (this.estimationRetryError && this.status === types_1.EstimationStatus.Success) {
            warnings.push({
                id: 'estimation-retry',
                title: this.estimationRetryError.message,
                text: 'You can proceed, but fee estimation is outdated - consider waiting for an updated estimation for a more optimal fee.'
            });
        }
        if (this.#notFatalBundlerError?.cause === '4337_ESTIMATION') {
            warnings.push({
                id: 'bundler-failure',
                title: 'Fee options are temporarily limited',
                text: 'Use the "Retry" button to try again, or pay the fee with the native token"'
            });
        }
        if (this.#notFatalBundlerError?.cause === '4337_INVALID_NONCE') {
            warnings.push({
                id: 'bundler-nonce-discrepancy',
                title: 'You can proceed safely, but fee payment options are limited due to a pending transaction'
            });
        }
        return warnings;
    }
    get errors() {
        const errors = [];
        if (this.isLoadingOrFailed() && this.estimationRetryError) {
            // If there is a successful estimation we should show this as a warning
            // as the user can use the old estimation to broadcast
            errors.push({
                title: `${this.estimationRetryError.message} ${this.error
                    ? 'We will continue retrying, but please check your internet connection.'
                    : 'Automatically retrying in a few seconds. Please wait...'}`
            });
            return errors;
        }
        if (!this.isInitialized())
            return [];
        if (this.error) {
            let code = '';
            if (this.error instanceof ErrorHumanizerError_1.default && this.error.isFallbackMessage) {
                code =
                    typeof this.error.cause === 'string' && !!this.error.cause
                        ? this.error.cause
                        : 'ESTIMATION_ERROR';
            }
            errors.push({
                title: this.error.message,
                code
            });
        }
        return errors;
    }
}
exports.EstimationController = EstimationController;
//# sourceMappingURL=estimation.js.map