"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignAccountOpController = exports.noStateUpdateStatuses = exports.FeeSpeed = exports.SigningStatus = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
/* eslint-disable no-restricted-syntax */
const errorHandling_1 = require("../../consts/signAccountOp/errorHandling");
const gas_1 = require("../../consts/signAccountOp/gas");
const signAccountOp_1 = require("../../interfaces/signAccountOp");
const account_1 = require("../../libs/account/account");
const accountOp_1 = require("../../libs/accountOp/accountOp");
const errorHumanizer_1 = require("../../libs/errorHumanizer");
const gasPrice_1 = require("../../libs/gasPrice/gasPrice");
const networks_1 = require("../../libs/networks/networks");
const signMessage_1 = require("../../libs/signMessage/signMessage");
const singleton_1 = require("../../libs/singleton/singleton");
const userOperation_1 = require("../../libs/userOperation/userOperation");
const bundlerSwitcher_1 = require("../../services/bundlers/bundlerSwitcher");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const helper_1 = require("./helper");
var SigningStatus;
(function (SigningStatus) {
    SigningStatus["EstimationError"] = "estimation-error";
    SigningStatus["UnableToSign"] = "unable-to-sign";
    SigningStatus["ReadyToSign"] = "ready-to-sign";
    /**
     * Used to prevent state updates while the user is resolving warnings, connecting a hardware wallet, etc.
     * Signing is allowed in this state, but the state of the controller should not change.
     */
    SigningStatus["UpdatesPaused"] = "updates-paused";
    SigningStatus["InProgress"] = "in-progress";
    SigningStatus["WaitingForPaymaster"] = "waiting-for-paymaster-response";
    SigningStatus["Done"] = "done";
})(SigningStatus = exports.SigningStatus || (exports.SigningStatus = {}));
var FeeSpeed;
(function (FeeSpeed) {
    FeeSpeed["Slow"] = "slow";
    FeeSpeed["Medium"] = "medium";
    FeeSpeed["Fast"] = "fast";
    FeeSpeed["Ape"] = "ape";
})(FeeSpeed = exports.FeeSpeed || (exports.FeeSpeed = {}));
// declare the statuses we don't want state updates on
exports.noStateUpdateStatuses = [
    SigningStatus.InProgress,
    SigningStatus.Done,
    SigningStatus.UpdatesPaused,
    SigningStatus.WaitingForPaymaster
];
class SignAccountOpController extends eventEmitter_1.default {
    #accounts;
    #keystore;
    #portfolio;
    #externalSignerControllers;
    account;
    #network;
    #blockGasLimit = undefined;
    fromActionId;
    accountOp;
    gasPrices = null;
    bundlerGasPrices = null;
    estimation = null;
    feeSpeeds = {};
    paidBy = null;
    feeTokenResult = null;
    selectedFeeSpeed = FeeSpeed.Fast;
    selectedOption = undefined;
    status = null;
    gasUsedTooHigh;
    gasUsedTooHighAgreed;
    #reEstimate;
    #isSignRequestStillActive;
    rbfAccountOps;
    signedAccountOp;
    replacementFeeLow;
    warnings = [];
    // indicates whether the transaction gas is sponsored or not
    isSponsored = false;
    // the sponsor data to be displayed, if any
    sponsor = undefined;
    bundlerSwitcher;
    // We track the status of token discovery logic (main.traceCall)
    // to ensure the "SignificantBalanceDecrease" banner is displayed correctly.
    // The latest/pending portfolio balance is essential for calculating balance differences.
    // However, during a SWAP, the user may receive a new token that isn't yet included (discovered) in the portfolio.
    // If the discovery process is in-process, and we only rely on portfolio balance change,
    // the banner may be incorrectly triggered due to the perceived balance drop.
    // Once discovery completes and updates the portfolio, the banner will be hidden.
    traceCallDiscoveryStatus = signAccountOp_1.TraceCallDiscoveryStatus.NotStarted;
    constructor(accounts, keystore, portfolio, externalSignerControllers, account, network, fromActionId, accountOp, reEstimate, isSignRequestStillActive) {
        super();
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.#portfolio = portfolio;
        this.#externalSignerControllers = externalSignerControllers;
        this.account = account;
        this.#network = network;
        this.fromActionId = fromActionId;
        this.accountOp = structuredClone(accountOp);
        this.#reEstimate = reEstimate;
        this.#isSignRequestStillActive = isSignRequestStillActive;
        this.gasUsedTooHigh = false;
        this.gasUsedTooHighAgreed = false;
        this.rbfAccountOps = {};
        this.signedAccountOp = null;
        this.replacementFeeLow = false;
        this.bundlerSwitcher = new bundlerSwitcher_1.BundlerSwitcher(network, () => {
            return this.status ? this.status.type : null;
        }, exports.noStateUpdateStatuses);
    }
    get isInitialized() {
        return !!this.estimation;
    }
    #setDefaults() {
        // Set the first signer as the default one.
        // If there are more available signers, the user will be able to select a different signer from the application.
        // The main benefit of having a default signer
        // is that it drastically simplifies the logic of determining whether the account is ready for signing.
        // For example, in the `sign` method and on the application screen, we can simply rely on the `this.readyToSign` flag.
        // Otherwise, if we don't have a default value, then `this.readyToSign` will always be false unless we set a signer.
        // In that case, on the application, we want the "Sign" button to be clickable/enabled,
        // and we have to check and expose the `SignAccountOp` controller's inner state to make this check possible.
        if (this.accountKeyStoreKeys.length &&
            (!this.accountOp.signingKeyAddr || !this.accountOp.signingKeyType)) {
            this.accountOp.signingKeyAddr = this.accountKeyStoreKeys[0].addr;
            this.accountOp.signingKeyType = this.accountKeyStoreKeys[0].type;
        }
    }
    #setGasFeePayment() {
        if (this.isInitialized && this.paidBy && this.selectedFeeSpeed && this.feeTokenResult) {
            this.accountOp.gasFeePayment = this.#getGasFeePayment();
        }
    }
    // check if speeds are set for the given identifier
    hasSpeeds(identifier) {
        return this.feeSpeeds[identifier] !== undefined && this.feeSpeeds[identifier].length;
    }
    getCallDataAdditionalByNetwork() {
        // no additional call data is required for arbitrum as the bytes are already
        // added in the calculation for the L1 fee
        if (this.#network.id === 'arbitrum' || !(0, account_1.isSmartAccount)(this.account))
            return 0n;
        const estimationCallData = (0, gasPrice_1.getProbableCallData)(this.account, this.accountOp, this.#accounts.accountStates[this.accountOp.accountAddr][this.accountOp.networkId], this.#network);
        const FIXED_OVERHEAD = 21000n;
        const bytes = Buffer.from(estimationCallData.substring(2));
        const nonZeroBytes = BigInt(bytes.filter((b) => b).length);
        const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes);
        const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n;
        return txDataGas + FIXED_OVERHEAD;
    }
    get errors() {
        const errors = [];
        if (!this.isInitialized)
            return errors;
        const isAmbireV1 = (0, account_1.isAmbireV1LinkedAccount)(this.account?.creation?.factoryAddr);
        const isAmbireV1AndNetworkNotSupported = isAmbireV1 && !(0, networks_1.hasRelayerSupport)(this.#network);
        // This must be the first error check!
        if (isAmbireV1AndNetworkNotSupported) {
            errors.push('Ambire v1 accounts are not supported on this network. To interact with this network, please use an Ambire v2 Smart Account or a Basic Account. You can still use v1 accounts on any network that is natively integrated with the Ambire web and mobile wallets.');
            // Don't show any other errors
            return errors;
        }
        // if there's an estimation error, show it
        if (this.estimation?.error) {
            errors.push(this.estimation.error.message);
        }
        if (this.estimation?.gasUsed &&
            this.#blockGasLimit &&
            this.estimation?.gasUsed > this.#blockGasLimit) {
            errors.push('Transaction reverted with estimation too high: above block limit');
        }
        if (this.#network.predefined &&
            this.estimation?.gasUsed &&
            this.estimation?.gasUsed > 500000000n) {
            errors.push('Unreasonably high estimation. This transaction will probably fail');
        }
        // this error should never happen as availableFeeOptions should always have the native option
        if (!this.isSponsored && !this.availableFeeOptions.length)
            errors.push(errorHandling_1.ERRORS.eoaInsufficientFunds);
        // This error should not happen, as in the update method we are always setting a default signer.
        // It may occur, only if there are no available signer.
        if (!this.accountOp.signingKeyType || !this.accountOp.signingKeyAddr)
            errors.push('Please select a signer to sign the transaction.');
        const currentPortfolio = this.#portfolio.getLatestPortfolioState(this.accountOp.accountAddr);
        const currentPortfolioNetwork = currentPortfolio[this.accountOp.networkId];
        const currentPortfolioNetworkNative = currentPortfolioNetwork?.result?.tokens.find((token) => token.address === '0x0000000000000000000000000000000000000000');
        if (!this.isSponsored && !currentPortfolioNetworkNative)
            errors.push('Unable to estimate the transaction fee as fetching the latest price update for the network native token failed. Please try again later.');
        // if there's no gasFeePayment calculate but there is: 1) feeTokenResult
        // 2) selectedOption and 3) gasSpeeds for selectedOption => return an error
        if (!this.isSponsored &&
            !this.accountOp.gasFeePayment &&
            this.feeTokenResult &&
            this.selectedOption) {
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr, this.rbfAccountOps[this.selectedOption.paidBy]);
            if (this.hasSpeeds(identifier))
                errors.push('Please select a token and an account for paying the gas fee.');
        }
        if (!this.isSponsored &&
            this.selectedOption &&
            this.accountOp.gasFeePayment &&
            this.selectedOption.availableAmount < this.accountOp.gasFeePayment.amount) {
            const speedCoverage = [];
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr, this.rbfAccountOps[this.selectedOption.paidBy]);
            if (this.feeSpeeds[identifier]) {
                this.feeSpeeds[identifier].forEach((speed) => {
                    if (this.selectedOption && this.selectedOption.availableAmount >= speed.amount)
                        speedCoverage.push(speed.type);
                });
            }
            if (speedCoverage.length === 0) {
                const isSA = (0, account_1.isSmartAccount)(this.account);
                const isUnableToCoverWithAllOtherTokens = this.availableFeeOptions.every((option) => {
                    if (option === this.selectedOption)
                        return true;
                    const optionIdentifier = (0, helper_1.getFeeSpeedIdentifier)(option, this.accountOp.accountAddr, this.rbfAccountOps[option.paidBy]);
                    const speedsThatCanCover = this.feeSpeeds[optionIdentifier]?.filter((speed) => speed.amount <= option.availableAmount);
                    return !speedsThatCanCover?.length;
                });
                if (isUnableToCoverWithAllOtherTokens) {
                    let skippedTokensCount = 0;
                    const gasTokenNames = gasTankFeeTokens_1.default
                        .filter(({ networkId, hiddenOnError }) => {
                        if (networkId !== this.accountOp.networkId)
                            return false;
                        if (hiddenOnError) {
                            skippedTokensCount++;
                            return false;
                        }
                        return true;
                    })
                        .map(({ symbol }) => symbol.toUpperCase())
                        .join(', ');
                    errors.push(`${errorHandling_1.ERRORS.eoaInsufficientFunds}${isSA
                        ? ` Available fee options: USDC in Gas Tank, ${gasTokenNames}${skippedTokensCount ? ' and others' : ''}`
                        : ''}`);
                }
                else {
                    errors.push(isSA
                        ? "Signing is not possible with the selected account's token as it doesn't have sufficient funds to cover the gas payment fee."
                        : errorHandling_1.ERRORS.eoaInsufficientFunds);
                }
            }
            else {
                errors.push('The selected speed is not available due to insufficient funds. Please select a slower speed.');
            }
        }
        // The signing might fail, tell the user why but allow the user to retry signing,
        // @ts-ignore fix TODO: type mismatch
        if (this.status?.type === SigningStatus.ReadyToSign && !!this.status.error) {
            // @ts-ignore typescript complains, but the error being present gets checked above
            errors.push(this.status.error);
        }
        if (!this.isSponsored && !this.#feeSpeedsLoading && this.selectedOption) {
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr, this.rbfAccountOps[this.selectedOption.paidBy]);
            if (!this.hasSpeeds(identifier)) {
                if (!this.feeTokenResult?.priceIn.length) {
                    errors.push(`Currently, ${this.feeTokenResult?.symbol} is unavailable as a fee token as we're experiencing troubles fetching its price. Please select another or contact support`);
                }
                else {
                    errors.push('Unable to estimate the transaction fee. Please try changing the fee token or contact support.');
                }
            }
        }
        // if the gasFeePayment is gas tank but the user doesn't have funds, disable it
        let balance = 0;
        Object.keys(currentPortfolio).forEach((networkName) => {
            const networkPortfolio = currentPortfolio[networkName];
            if (!networkPortfolio?.result?.total?.usd)
                return;
            balance += networkPortfolio.result.total.usd;
        });
        if (balance < 10 && this.accountOp.gasFeePayment && this.accountOp.gasFeePayment.isGasTank) {
            errors.push('Your account must have a minimum overall balance of $10 to pay for gas via the Gas Tank. Please add funds to your account or choose another fee payment option.');
        }
        return errors;
    }
    get readyToSign() {
        return (!!this.status &&
            (this.status?.type === SigningStatus.ReadyToSign ||
                this.status?.type === SigningStatus.UpdatesPaused));
    }
    calculateWarnings() {
        const warnings = [];
        const latestState = this.#portfolio.getLatestPortfolioState(this.accountOp.accountAddr);
        const pendingState = this.#portfolio.getPendingPortfolioState(this.accountOp.accountAddr);
        const significantBalanceDecreaseWarning = (0, helper_1.getSignificantBalanceDecreaseWarning)(latestState, pendingState, this.accountOp.networkId, this.traceCallDiscoveryStatus);
        if (this.selectedOption) {
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr, this.rbfAccountOps[this.selectedOption.paidBy]);
            const feeTokenHasPrice = this.feeSpeeds[identifier]?.every((speed) => !!speed.amountUsd);
            const feeTokenPriceUnavailableWarning = (0, helper_1.getFeeTokenPriceUnavailableWarning)(!!this.hasSpeeds(identifier), feeTokenHasPrice);
            // push the warning only if the txn is not sponsored
            if (!this.isSponsored && feeTokenPriceUnavailableWarning)
                warnings.push(feeTokenPriceUnavailableWarning);
        }
        if (significantBalanceDecreaseWarning)
            warnings.push(significantBalanceDecreaseWarning);
        this.warnings = warnings;
        this.emitUpdate();
    }
    update({ gasPrices, estimation, feeToken, paidBy, speed, signingKeyAddr, signingKeyType, calls, gasUsedTooHighAgreed, rbfAccountOps, bundlerGasPrices, blockGasLimit }) {
        // once the user commits to the things he sees on his screen,
        // we need to be sure nothing changes afterwards.
        // For example, signing can be slow if it's done by a hardware wallet.
        // The estimation gets refreshed on the other hand each 12 seconds (6 on optimism)
        // If we allow the estimation to affect the controller state during sign,
        // there could be discrepancy between what the user has agreed upon and what
        // we broadcast in the end
        if (this.status?.type && exports.noStateUpdateStatuses.indexOf(this.status?.type) !== -1) {
            return;
        }
        if (Array.isArray(calls))
            this.accountOp.calls = calls;
        if (blockGasLimit)
            this.#blockGasLimit = blockGasLimit;
        if (gasPrices)
            this.gasPrices = gasPrices;
        if (estimation) {
            this.gasUsedTooHigh = !!(this.#blockGasLimit && estimation.gasUsed > this.#blockGasLimit / 4n);
            this.estimation = estimation;
            // on each estimation update, set the newest account nonce
            this.accountOp.nonce = BigInt(estimation.currentAccountNonce);
        }
        // if estimation is undefined, do not clear the estimation.
        // We do this only if strictly specified as null
        if (estimation === null)
            this.estimation = null;
        if (feeToken && paidBy) {
            this.paidBy = paidBy;
            this.feeTokenResult = feeToken;
        }
        if (speed && this.isInitialized) {
            this.selectedFeeSpeed = speed;
        }
        if (signingKeyAddr && signingKeyType && this.isInitialized) {
            this.accountOp.signingKeyAddr = signingKeyAddr;
            this.accountOp.signingKeyType = signingKeyType;
        }
        if (gasUsedTooHighAgreed !== undefined)
            this.gasUsedTooHighAgreed = gasUsedTooHighAgreed;
        // set the rbf is != undefined
        if (rbfAccountOps)
            this.rbfAccountOps = rbfAccountOps;
        // Set defaults, if some of the optional params are omitted
        this.#setDefaults();
        if (this.estimation && this.paidBy && this.feeTokenResult) {
            this.selectedOption = this.availableFeeOptions.find((option) => option.paidBy === this.paidBy &&
                option.token.address === this.feeTokenResult.address &&
                option.token.symbol.toLocaleLowerCase() ===
                    this.feeTokenResult.symbol.toLocaleLowerCase() &&
                option.token.flags.onGasTank === this.feeTokenResult.flags.onGasTank);
        }
        // update the bundler gas prices if the bundlers match
        if (this.estimation?.erc4337GasLimits &&
            bundlerGasPrices &&
            bundlerGasPrices.bundler === this.bundlerSwitcher.getBundler().getName()) {
            this.estimation.erc4337GasLimits.gasPrice = bundlerGasPrices.speeds;
        }
        if (this.estimation &&
            this.estimation.erc4337GasLimits &&
            this.estimation.erc4337GasLimits.paymaster) {
            // if it was sponsored but it no longer is (fallback case),
            // reset the selectedOption option as we use native for the sponsorship
            // but the user might not actually have any native
            const isSponsorshipFallback = this.isSponsored && !this.estimation.erc4337GasLimits.paymaster.isSponsored();
            this.isSponsored = this.estimation.erc4337GasLimits.paymaster.isSponsored();
            this.sponsor = this.estimation.erc4337GasLimits.paymaster.getEstimationData()?.sponsor;
            if (isSponsorshipFallback) {
                this.selectedOption = this.availableFeeOptions.length
                    ? this.availableFeeOptions[0]
                    : undefined;
            }
        }
        // calculate the fee speeds if either there are no feeSpeeds
        // or any of properties for update is requested
        if (!Object.keys(this.feeSpeeds).length || Array.isArray(calls) || gasPrices || estimation) {
            this.#updateFeeSpeeds();
        }
        // Here, we expect to have most of the fields set, so we can safely set GasFeePayment
        this.#setGasFeePayment();
        this.updateStatus();
        this.calculateWarnings();
    }
    updateStatus(forceStatusChange, replacementFeeLow = false) {
        // use this to go back to ReadyToSign when a broadcasting error is emitted
        if (forceStatusChange) {
            this.status = { type: forceStatusChange };
            this.emitUpdate();
            return;
        }
        // no status updates on these two
        const isInTheMiddleOfSigning = this.status?.type === SigningStatus.InProgress ||
            this.status?.type === SigningStatus.WaitingForPaymaster;
        const isDone = this.status?.type === SigningStatus.Done;
        if (isInTheMiddleOfSigning || isDone)
            return;
        // if we have an estimation error, set the state so and return
        if (this.estimation?.error) {
            this.status = { type: SigningStatus.EstimationError };
            this.emitUpdate();
            return;
        }
        if (this.errors.length) {
            this.status = { type: SigningStatus.UnableToSign };
            this.emitUpdate();
            return;
        }
        if (this.isInitialized &&
            this.estimation &&
            this.accountOp?.signingKeyAddr &&
            this.accountOp?.signingKeyType &&
            this.accountOp?.gasFeePayment &&
            // if the gas used is too high, do not allow the user to sign
            // until he explicitly agrees to the risks
            (!this.gasUsedTooHigh || this.gasUsedTooHighAgreed)) {
            this.status = { type: SigningStatus.ReadyToSign };
            // do not reset this once triggered
            if (replacementFeeLow)
                this.replacementFeeLow = replacementFeeLow;
            this.emitUpdate();
            return;
        }
        // reset the status if a valid state was not found
        this.status = null;
        this.emitUpdate();
    }
    reset() {
        this.gasPrices = null;
        this.estimation = null;
        this.selectedFeeSpeed = FeeSpeed.Fast;
        this.paidBy = null;
        this.feeTokenResult = null;
        this.status = null;
        this.emitUpdate();
    }
    resetStatus() {
        this.status = null;
        this.emitUpdate();
    }
    /**
     * Obtain the native token ratio in relation to a fee token.
     *
     * By knowing the USD value of the tokens in the portfolio,
     * we can calculate the ratio between a native token and a fee token.
     *
     * For example, 1 ETH = 8 BNB (ratio: 8).
     *
     * We require the ratio to be in a BigInt format since all the application values,
     * such as amount, gasLimit, etc., are also represented as BigInt numbers.
     */
    #getNativeToFeeTokenRatio(feeToken) {
        const native = this.#portfolio
            .getLatestPortfolioState(this.accountOp.accountAddr)[this.accountOp.networkId]?.result?.tokens.find((token) => token.address === '0x0000000000000000000000000000000000000000');
        if (!native)
            return null;
        // In case the fee token is the native token we don't want to depend to priceIn, as it might not be available.
        if (native.address === feeToken.address && native.networkId === feeToken.networkId)
            return BigInt(1 * 1e18);
        const isUsd = (price) => price.baseCurrency === 'usd';
        const nativePrice = native.priceIn.find(isUsd)?.price;
        const feeTokenPrice = feeToken.priceIn.find(isUsd)?.price;
        if (!nativePrice || !feeTokenPrice)
            return null;
        const ratio = nativePrice / feeTokenPrice;
        // Here we multiply it by 1e18, in order to keep the decimal precision.
        // Otherwise, passing the ratio to the BigInt constructor, we will lose the numbers after the decimal point.
        // Later, once we need to normalize this ratio, we should not forget to divide it by 1e18.
        const ratio1e18 = ratio * 1e18;
        const toBigInt = ratio1e18 % 1 === 0 ? ratio1e18 : ratio1e18.toFixed(0);
        return BigInt(toBigInt);
    }
    static getAmountAfterFeeTokenConvert(simulatedGasLimit, gasPrice, nativeRatio, feeTokenDecimals, addedNative) {
        const amountInWei = simulatedGasLimit * gasPrice + addedNative;
        // Let's break down the process of converting the amount into FeeToken:
        // 1. Initially, we multiply the amount in wei by the native to fee token ratio.
        // 2. Next, we address the decimal places:
        // 2.1. First, we convert wei to native by dividing by 10^18 (representing the decimals).
        // 2.2. Now, with the amount in the native token, we incorporate nativeRatio decimals into the calculation (18 + 18) to standardize the amount.
        // 2.3. At this point, we precisely determine the number of fee tokens. For instance, if the amount is 3 USDC, we must convert it to a BigInt value, while also considering feeToken.decimals.
        const extraDecimals = BigInt(10 ** 18);
        const feeTokenExtraDecimals = BigInt(10 ** (18 - feeTokenDecimals));
        const pow = extraDecimals * feeTokenExtraDecimals;
        return (amountInWei * nativeRatio) / pow;
    }
    /**
     * Increase the fee we send to the feeCollector according to the specified
     * options in the network tab
     */
    #increaseFee(amount) {
        if (!this.#network.feeOptions.feeIncrease) {
            return amount;
        }
        return amount + (amount * this.#network.feeOptions.feeIncrease) / 100n;
    }
    /**
     * If the nonce of the current account op and the last account op are the same,
     * do an RBF increase or otherwise the user cannot broadcast the txn
     *
     * calculatedGas: it should be either the whole gasPrice if the network doesn't
     * support EIP-1559 OR it should the maxPriorityFeePerGas if the network
     * supports EIP-1559
     *
     * gasPropertyName: pass gasPrice if no EIP-1559; otherwise: maxPriorityFeePerGas
     */
    #rbfIncrease(accId, calculatedGas, gasPropertyName, prevSpeed) {
        // ape speed gets 50% increase
        const divider = prevSpeed && prevSpeed.type === FeeSpeed.Fast ? 2n : 8n;
        // when doing an RBF, make sure the min gas for the current speed
        // is at least 12% bigger than the previous speed
        const prevSpeedGas = prevSpeed ? prevSpeed[gasPropertyName] : undefined;
        const prevSpeedGasIncreased = prevSpeedGas ? prevSpeedGas + prevSpeedGas / divider : 0n;
        const min = prevSpeedGasIncreased > calculatedGas ? prevSpeedGasIncreased : calculatedGas;
        // if there was an error on the signed account op with a
        // replacement fee too low, we increase by 13% the signed account op
        // IF the new estimation is not actually higher
        if (this.replacementFeeLow && this.signedAccountOp && this.signedAccountOp.gasFeePayment) {
            const prevGas = this.signedAccountOp.gasFeePayment[gasPropertyName] ?? undefined;
            const bumpFees = prevGas ? prevGas + prevGas / divider + prevGas / 100n : 0n;
            return min > bumpFees ? min : bumpFees;
        }
        // if no RBF option for this paidBy option, return the amount
        const rbfOp = this.rbfAccountOps[accId];
        if (!rbfOp || !rbfOp.gasFeePayment || !rbfOp.gasFeePayment[gasPropertyName])
            return calculatedGas;
        // increase by a minimum of 13% the last broadcast txn and use that
        // or use the current gas estimation if it's more
        const rbfGas = rbfOp.gasFeePayment[gasPropertyName] ?? 0n;
        const lastTxnGasPriceIncreased = rbfGas + rbfGas / divider + rbfGas / 100n;
        return min > lastTxnGasPriceIncreased ? min : lastTxnGasPriceIncreased;
    }
    get #feeSpeedsLoading() {
        return !this.isInitialized || !this.gasPrices;
    }
    #updateFeeSpeeds() {
        if (this.#feeSpeedsLoading)
            return;
        // reset the fee speeds at the beginning to avoid duplications
        this.feeSpeeds = {};
        const gasUsed = this.estimation.gasUsed;
        this.availableFeeOptions.forEach((option) => {
            // if a calculation has been made, do not make it again
            // EOA pays for SA is the most common case for this scenario
            //
            // addition: make sure there's no rbfAccountOps as well
            const identifier = (0, helper_1.getFeeSpeedIdentifier)(option, this.accountOp.accountAddr, this.rbfAccountOps[option.paidBy]);
            if (this.hasSpeeds(identifier)) {
                return;
            }
            const nativeRatio = this.#getNativeToFeeTokenRatio(option.token);
            if (!nativeRatio) {
                this.feeSpeeds[identifier] = [];
                return;
            }
            const erc4337GasLimits = this.estimation?.erc4337GasLimits;
            if (erc4337GasLimits) {
                const speeds = [];
                const usesPaymaster = !!this.estimation?.erc4337GasLimits?.paymaster.isUsable();
                for (const [speed, speedValue] of Object.entries(erc4337GasLimits.gasPrice)) {
                    const simulatedGasLimit = BigInt(erc4337GasLimits.callGasLimit) +
                        BigInt(erc4337GasLimits.preVerificationGas) +
                        BigInt(option.gasUsed ?? 0);
                    const gasPrice = BigInt(speedValue.maxFeePerGas);
                    let amount = SignAccountOpController.getAmountAfterFeeTokenConvert(simulatedGasLimit, gasPrice, nativeRatio, option.token.decimals, 0n);
                    if (usesPaymaster)
                        amount = this.#increaseFee(amount);
                    speeds.push({
                        type: speed,
                        simulatedGasLimit,
                        amount,
                        amountFormatted: (0, ethers_1.formatUnits)(amount, Number(option.token.decimals)),
                        amountUsd: (0, helper_1.getTokenUsdAmount)(option.token, amount),
                        gasPrice,
                        maxPriorityFeePerGas: BigInt(speedValue.maxPriorityFeePerGas)
                    });
                }
                if (this.feeSpeeds[identifier] === undefined)
                    this.feeSpeeds[identifier] = [];
                this.feeSpeeds[identifier] = speeds;
                return;
            }
            ;
            (this.gasPrices || []).forEach((gasRecommendation, i) => {
                let amount;
                let simulatedGasLimit;
                const prevSpeed = this.feeSpeeds[identifier] && this.feeSpeeds[identifier].length
                    ? this.feeSpeeds[identifier][i - 1]
                    : null;
                // gasRecommendation can come as GasPriceRecommendation or Gas1559Recommendation
                // depending whether the network supports EIP-1559 and is it enabled on our side.
                // To check, we use maxPriorityFeePerGas. If it's set => EIP-1559.
                // After, we call #rbfIncrease on maxPriorityFeePerGas if set which either returns
                // the maxPriorityFeePerGas without doing anything (most cases) or if there's a
                // pending txn in the mempool, it bumps maxPriorityFeePerGas by 12.5% to enable RBF.
                // Finally, we calculate the gasPrice:
                // - EIP-1559: baseFeePerGas + maxPriorityFeePerGas
                // - Normal: gasRecommendation.gasPrice #rbfIncreased (same logic as for maxPriorityFeePerGas RBF)
                const maxPriorityFeePerGas = 'maxPriorityFeePerGas' in gasRecommendation
                    ? this.#rbfIncrease(option.paidBy, gasRecommendation.maxPriorityFeePerGas, 'maxPriorityFeePerGas', prevSpeed)
                    : undefined;
                const gasPrice = 'maxPriorityFeePerGas' in gasRecommendation
                    ? gasRecommendation.baseFeePerGas + maxPriorityFeePerGas
                    : this.#rbfIncrease(option.paidBy, gasRecommendation.gasPrice, 'gasPrice', prevSpeed);
                // EOA
                if (!(0, account_1.isSmartAccount)(this.account)) {
                    simulatedGasLimit = gasUsed;
                    if (this.accountOp.calls[0].to && (0, ethers_1.getAddress)(this.accountOp.calls[0].to) === deploy_1.SINGLETON) {
                        simulatedGasLimit = (0, singleton_1.getGasUsed)(simulatedGasLimit);
                    }
                    amount = simulatedGasLimit * gasPrice + option.addedNative;
                }
                else if (option.paidBy !== this.accountOp.accountAddr) {
                    // Smart account, but EOA pays the fee
                    simulatedGasLimit = gasUsed + this.getCallDataAdditionalByNetwork();
                    amount = simulatedGasLimit * gasPrice + option.addedNative;
                }
                else {
                    // Relayer
                    simulatedGasLimit = gasUsed + this.getCallDataAdditionalByNetwork() + option.gasUsed;
                    amount = SignAccountOpController.getAmountAfterFeeTokenConvert(simulatedGasLimit, gasPrice, nativeRatio, option.token.decimals, option.addedNative);
                    amount = this.#increaseFee(amount);
                }
                const feeSpeed = {
                    type: gasRecommendation.name,
                    simulatedGasLimit,
                    amount,
                    amountFormatted: (0, ethers_1.formatUnits)(amount, Number(option.token.decimals)),
                    amountUsd: (0, helper_1.getTokenUsdAmount)(option.token, amount),
                    gasPrice,
                    maxPriorityFeePerGas
                };
                if (this.feeSpeeds[identifier] === undefined)
                    this.feeSpeeds[identifier] = [];
                this.feeSpeeds[identifier].push(feeSpeed);
            });
        });
    }
    #getGasFeePayment() {
        if (!this.isInitialized) {
            this.emitError({
                level: 'major',
                message: 'Something went wrong while setting up the gas fee payment account and token. Please try again, selecting the account and token option. If the problem persists, contact support.',
                error: new Error('SignAccountOpController: The controller is not initialized while we are trying to build GasFeePayment.')
            });
            return null;
        }
        if (!this.paidBy) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: paying account not selected')
            });
            return null;
        }
        if (!this.feeTokenResult) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: fee token not selected')
            });
            return null;
        }
        // if there are no availableFeeOptions, we don't have a gasFee
        // this is normal though as there are such cases:
        // - EOA paying in native but doesn't have any native
        // so no error should pop out because of this
        if (!this.availableFeeOptions.length) {
            return null;
        }
        if (!this.selectedOption) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: paying option not found')
            });
            return null;
        }
        // if there are no fee speeds available for the option, it means
        // the nativeRatio could not be calculated. In that case, we do not
        // emit an error here but proceed and show an explanation to the user
        // in get errors()
        // check test: Signing [Relayer]: ... priceIn | native/Ratio
        const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr, this.rbfAccountOps[this.selectedOption.paidBy]);
        if (!this.feeSpeeds[identifier].length) {
            return null;
        }
        const chosenSpeed = this.feeSpeeds[identifier].find((speed) => speed.type === this.selectedFeeSpeed);
        if (!chosenSpeed) {
            this.emitError({
                level: 'silent',
                message: '',
                error: new Error('SignAccountOpController: fee speed not selected')
            });
            return null;
        }
        const accountState = this.#accounts.accountStates[this.accountOp.accountAddr][this.accountOp.networkId];
        return {
            paidBy: this.paidBy,
            // we're allowing EOAs to broadcast on 4337 networks as well
            // in that case, we don't do user operations
            isERC4337: this.paidBy === this.accountOp.accountAddr &&
                (0, userOperation_1.isErc4337Broadcast)(this.account, this.#network, accountState),
            isGasTank: this.feeTokenResult.flags.onGasTank,
            inToken: this.feeTokenResult.address,
            feeTokenNetworkId: this.feeTokenResult.networkId,
            amount: chosenSpeed.amount,
            simulatedGasLimit: chosenSpeed.simulatedGasLimit,
            gasPrice: chosenSpeed.gasPrice,
            maxPriorityFeePerGas: 'maxPriorityFeePerGas' in chosenSpeed ? chosenSpeed.maxPriorityFeePerGas : undefined
        };
    }
    get feeToken() {
        return this.accountOp?.gasFeePayment?.inToken || null;
    }
    get feePaidBy() {
        return this.accountOp?.gasFeePayment?.paidBy || null;
    }
    get availableFeeOptions() {
        if (!this.estimation)
            return [];
        // if the txn is sponsored, return the native option only
        // even if it's balance is 0
        if (this.isSponsored) {
            const native = this.estimation.feePaymentOptions.find((feeOption) => feeOption.token.address === ethers_1.ZeroAddress);
            return native ? [native] : [];
        }
        // FeeOptions having amount
        const withAmounts = this.estimation.feePaymentOptions.filter((feeOption) => feeOption.availableAmount);
        if (withAmounts.length)
            return withAmounts;
        // if there are no fee options with amounts, return the native option
        const native = this.estimation.feePaymentOptions.find((feeOption) => feeOption.token.address === ethers_1.ZeroAddress);
        return native ? [native] : [];
    }
    get accountKeyStoreKeys() {
        return this.#keystore.keys.filter((key) => this.account.associatedKeys.includes(key.addr));
    }
    // eslint-disable-next-line class-methods-use-this
    get speedOptions() {
        return Object.values(FeeSpeed);
    }
    get gasSavedUSD() {
        if (!this.selectedOption?.token.flags.onGasTank)
            return null;
        const identifier = (0, helper_1.getFeeSpeedIdentifier)(this.selectedOption, this.accountOp.accountAddr, this.rbfAccountOps[this.selectedOption.paidBy]);
        const selectedFeeSpeedData = this.feeSpeeds[identifier].find((speed) => speed.type === this.selectedFeeSpeed);
        const gasPrice = selectedFeeSpeedData?.gasPrice;
        if (!gasPrice)
            return null;
        // get the native token from the portfolio to calculate prices
        const native = this.#portfolio
            .getLatestPortfolioState(this.accountOp.accountAddr)[this.accountOp.networkId]?.result?.tokens.find((token) => token.address === '0x0000000000000000000000000000000000000000');
        if (!native)
            return null;
        const nativePrice = native.priceIn.find((price) => price.baseCurrency === 'usd')?.price;
        if (!nativePrice)
            return null;
        // 4337 gasUsed is set to 0 in the estimation as we rely
        // on the bundler for the estimation entirely => use hardcode value
        const gasUsedSelectedOption = this.selectedOption.gasUsed && this.selectedOption.gasUsed > 0n
            ? this.selectedOption.gasUsed
            : gas_1.GAS_TANK_TRANSFER_GAS_USED;
        const isNativeSelected = this.selectedOption.token.address === ethers_1.ZeroAddress;
        const gasUsedNative = this.availableFeeOptions.find((option) => option.token.address === ethers_1.ZeroAddress && !option.token.flags.onGasTank)?.gasUsed || gas_1.SA_NATIVE_TRANSFER_GAS_USED;
        const gasUsedERC20 = this.availableFeeOptions.find((option) => option.token.address !== ethers_1.ZeroAddress && !option.token.flags.onGasTank)?.gasUsed || gas_1.SA_ERC20_TRANSFER_GAS_USED;
        const gasUsedWithoutGasTank = isNativeSelected ? gasUsedNative : gasUsedERC20;
        const gasSavedInNative = (0, ethers_1.formatEther)((gasUsedWithoutGasTank - gasUsedSelectedOption) * gasPrice);
        return Number(gasSavedInNative) * nativePrice;
    }
    #emitSigningErrorAndResetToReadyToSign(error) {
        this.emitError({ level: 'major', message: error, error: new Error(error) });
        this.status = { type: SigningStatus.ReadyToSign };
        this.emitUpdate();
    }
    #addFeePayment() {
        // In case of gas tank token fee payment, we need to include one more call to account op
        const abiCoder = new ethers_1.AbiCoder();
        if (this.isSponsored) {
            this.accountOp.feeCall = {
                to: addresses_1.FEE_COLLECTOR,
                value: 0n,
                data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 0n, 'USDC'])
            };
            return;
        }
        if (this.accountOp.gasFeePayment.isGasTank) {
            this.accountOp.feeCall = {
                to: addresses_1.FEE_COLLECTOR,
                value: 0n,
                data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', this.accountOp.gasFeePayment.amount, this.feeTokenResult?.symbol])
            };
            return;
        }
        if (this.accountOp.gasFeePayment.inToken === '0x0000000000000000000000000000000000000000') {
            // native payment
            this.accountOp.feeCall = {
                to: addresses_1.FEE_COLLECTOR,
                value: this.accountOp.gasFeePayment.amount,
                data: '0x'
            };
        }
        else {
            // token payment
            const ERC20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
            this.accountOp.feeCall = {
                to: this.accountOp.gasFeePayment.inToken,
                value: 0n,
                data: ERC20Interface.encodeFunctionData('transfer', [
                    addresses_1.FEE_COLLECTOR,
                    this.accountOp.gasFeePayment.amount
                ])
            };
        }
    }
    async sign() {
        if (!this.readyToSign) {
            const message = `Unable to sign the transaction. During the preparation step, the necessary transaction data was not received. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign(message);
        }
        // when signing begings, we stop immediatelly state updates on the controller
        // by changing the status to InProgress. Check update() for more info
        this.status = { type: SigningStatus.InProgress };
        if (!this.accountOp?.signingKeyAddr || !this.accountOp?.signingKeyType) {
            const message = `Unable to sign the transaction. During the preparation step, required signing key information was found missing. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign(message);
        }
        if (!this.accountOp?.gasFeePayment || !this.selectedOption) {
            const message = `Unable to sign the transaction. During the preparation step, required information about paying the gas fee was found missing. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign(message);
        }
        const signer = await this.#keystore.getSigner(this.accountOp.signingKeyAddr, this.accountOp.signingKeyType);
        if (!signer) {
            const message = `Unable to sign the transaction. During the preparation step, required account key information was found missing. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
            return this.#emitSigningErrorAndResetToReadyToSign(message);
        }
        const accountState = this.#accounts.accountStates[this.accountOp.accountAddr][this.accountOp.networkId];
        const isUsingPaymaster = !!this.estimation?.erc4337GasLimits?.paymaster.isUsable();
        const usesOneTimeNonce = (0, userOperation_1.shouldUseOneTimeNonce)(accountState);
        if (this.accountOp.gasFeePayment.isERC4337 && isUsingPaymaster && !usesOneTimeNonce) {
            this.status = { type: SigningStatus.WaitingForPaymaster };
        }
        else {
            this.status = { type: SigningStatus.InProgress };
        }
        // we update the FE with the changed status (in progress) only after the checks
        // above confirm everything is okay to prevent two different state updates
        this.emitUpdate();
        const gasFeePayment = this.accountOp.gasFeePayment;
        if (signer.init)
            signer.init(this.#externalSignerControllers[this.accountOp.signingKeyType]);
        // just in-case: before signing begins, we delete the feeCall;
        // if there's a need for it, it will be added later on in the code.
        // We need this precaution because this could happen:
        // - try to broadcast with the relayer
        // - the feel call gets added
        // - the relayer broadcast fails
        // - the user does another broadcast, this time with EOA pays for SA
        // - the fee call stays, causing a low gas limit revert
        delete this.accountOp.feeCall;
        // delete the activatorCall as a precaution that it won't be added twice
        delete this.accountOp.activatorCall;
        // @EntryPoint activation
        // if we broadcast by an EOA, this is the only way to include
        // the entry point as a signer
        if ((0, userOperation_1.shouldIncludeActivatorCall)(this.#network, this.account, accountState, this.accountOp.gasFeePayment.isERC4337)) {
            this.accountOp.activatorCall = (0, userOperation_1.getActivatorCall)(this.accountOp.accountAddr);
        }
        try {
            // In case of EOA account
            if (!(0, account_1.isSmartAccount)(this.account)) {
                if (this.accountOp.calls.length !== 1) {
                    const callCount = this.accountOp.calls.length > 1 ? 'multiple' : 'zero';
                    const message = `Unable to sign the transaction because it has ${callCount} calls. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`;
                    return this.#emitSigningErrorAndResetToReadyToSign(message);
                }
                // In legacy mode, we sign the transaction directly.
                // that means the signing will happen on broadcast and here
                // checking whether the call is 1 and 1 only is enough
                this.accountOp.signature = '0x';
            }
            else if (this.accountOp.gasFeePayment.paidBy !== this.account.addr) {
                // Smart account, but EOA pays the fee
                // EOA pays for execute() - relayerless
                this.accountOp.signature = await (0, signMessage_1.getExecuteSignature)(this.#network, this.accountOp, accountState, signer);
            }
            else if (this.accountOp.gasFeePayment.isERC4337) {
                // if there's no entryPointAuthorization, the txn will fail
                if (!accountState.isDeployed &&
                    (!this.accountOp.meta || !this.accountOp.meta.entryPointAuthorization))
                    return this.#emitSigningErrorAndResetToReadyToSign(`Unable to sign the transaction because entry point privileges were not granted. ${errorHandling_1.RETRY_TO_INIT_ACCOUNT_OP_MSG}`);
                const erc4337Estimation = this.estimation.erc4337GasLimits;
                const userOperation = (0, userOperation_1.getUserOperation)(this.account, accountState, this.accountOp, this.bundlerSwitcher.getBundler().getName(), !accountState.isDeployed ? this.accountOp.meta.entryPointAuthorization : undefined);
                userOperation.preVerificationGas = erc4337Estimation.preVerificationGas;
                userOperation.callGasLimit = (0, ethers_1.toBeHex)(BigInt(erc4337Estimation.callGasLimit) + (this.selectedOption.gasUsed ?? 0n));
                userOperation.verificationGasLimit = erc4337Estimation.verificationGasLimit;
                userOperation.paymasterVerificationGasLimit =
                    erc4337Estimation.paymasterVerificationGasLimit;
                userOperation.paymasterPostOpGasLimit = erc4337Estimation.paymasterPostOpGasLimit;
                userOperation.maxFeePerGas = (0, ethers_1.toBeHex)(gasFeePayment.gasPrice);
                userOperation.maxPriorityFeePerGas = (0, ethers_1.toBeHex)(gasFeePayment.maxPriorityFeePerGas);
                const paymaster = erc4337Estimation.paymaster;
                if (paymaster.shouldIncludePayment())
                    this.#addFeePayment();
                const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
                if (usesOneTimeNonce) {
                    const signature = await (0, signMessage_1.getExecuteSignature)(this.#network, this.accountOp, accountState, signer);
                    // after signing has completed, we wait for the paymaster response
                    // so we tell the user
                    this.status = { type: SigningStatus.WaitingForPaymaster };
                    this.emitUpdate();
                    userOperation.callData = ambireAccount.encodeFunctionData('executeMultiple', [
                        [[(0, accountOp_1.getSignableCalls)(this.accountOp), signature]]
                    ]);
                    this.accountOp.signature = signature;
                }
                else {
                    userOperation.callData = ambireAccount.encodeFunctionData('executeBySender', [
                        (0, accountOp_1.getSignableCalls)(this.accountOp)
                    ]);
                }
                if (paymaster.isUsable()) {
                    const response = await paymaster.call(this.account, this.accountOp, userOperation, this.#network);
                    if (response.success) {
                        const paymasterData = response;
                        this.status = { type: SigningStatus.InProgress };
                        this.emitUpdate();
                        userOperation.paymaster = paymasterData.paymaster;
                        userOperation.paymasterData = paymasterData.paymasterData;
                        if (usesOneTimeNonce)
                            userOperation.nonce = (0, userOperation_1.getOneTimeNonce)(userOperation);
                        this.accountOp.gasFeePayment.isSponsored = paymaster.isSponsored();
                    }
                    else {
                        const errorResponse = response;
                        this.emitError({
                            level: 'major',
                            message: errorResponse.message,
                            error: errorResponse.error
                        });
                        this.status = { type: SigningStatus.ReadyToSign };
                        this.emitUpdate();
                        this.#reEstimate();
                        return;
                    }
                }
                // query the application state from memory to understand if the user
                // hasn't actually rejected the request while waiting for the
                // paymaster to respond
                if (!this.#isSignRequestStillActive())
                    return;
                if (userOperation.requestType === 'standard') {
                    const typedData = (0, signMessage_1.getTypedData)(this.#network.chainId, this.accountOp.accountAddr, (0, userOperation_1.getUserOpHash)(userOperation, this.#network.chainId));
                    const signature = (0, signMessage_1.wrapStandard)(await signer.signTypedData(typedData));
                    userOperation.signature = signature;
                    this.accountOp.signature = signature;
                }
                this.accountOp.asUserOperation = userOperation;
            }
            else {
                // Relayer
                this.#addFeePayment();
                this.accountOp.signature = await (0, signMessage_1.getExecuteSignature)(this.#network, this.accountOp, accountState, signer);
            }
            this.status = { type: SigningStatus.Done };
            this.signedAccountOp = structuredClone(this.accountOp);
            this.emitUpdate();
            return this.signedAccountOp;
        }
        catch (error) {
            const { message } = (0, errorHumanizer_1.getHumanReadableBroadcastError)(error);
            this.#emitSigningErrorAndResetToReadyToSign(message);
        }
    }
    toJSON() {
        return {
            ...this,
            isInitialized: this.isInitialized,
            readyToSign: this.readyToSign,
            availableFeeOptions: this.availableFeeOptions,
            accountKeyStoreKeys: this.accountKeyStoreKeys,
            feeToken: this.feeToken,
            feePaidBy: this.feePaidBy,
            speedOptions: this.speedOptions,
            selectedOption: this.selectedOption,
            account: this.account,
            errors: this.errors,
            gasSavedUSD: this.gasSavedUSD
        };
    }
}
exports.SignAccountOpController = SignAccountOpController;
//# sourceMappingURL=signAccountOp.js.map