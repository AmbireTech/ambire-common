"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Paymaster = void 0;
exports.getPaymasterDataForEstimate = getPaymasterDataForEstimate;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const EntryPoint_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/EntryPoint.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
const FailedPaymasters_1 = require("../../services/paymaster/FailedPaymasters");
const formatters_1 = require("../../utils/numbers/formatters");
const calls_1 = require("../calls/calls");
const erc7677_1 = require("../erc7677/erc7677");
const customErrors_1 = require("../errorDecoder/customErrors");
const errorHumanizer_1 = require("../errorHumanizer");
const estimateHelpers_1 = require("../estimate/estimateHelpers");
const relayerCall_1 = require("../relayerCall/relayerCall");
const userOperation_1 = require("../userOperation/userOperation");
const abstractPaymaster_1 = require("./abstractPaymaster");
function getPaymasterDataForEstimate() {
    const abiCoder = new ethers_1.AbiCoder();
    return {
        paymaster: deploy_1.AMBIRE_PAYMASTER,
        paymasterVerificationGasLimit: (0, ethers_1.toBeHex)(42000),
        paymasterPostOpGasLimit: (0, ethers_1.toBeHex)(0),
        paymasterData: abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, (0, estimateHelpers_1.getSigForCalculations)()])
    };
}
function getSwapSponsorshipEstimationData() {
    const paymasterData = getPaymasterDataForEstimate();
    return {
        ...paymasterData,
        sponsor: {
            name: 'Ambire Wallet',
            icon: 'https://cena.ambire.com/public/ambire-logos/symbol-color.svg'
        }
    };
}
class Paymaster extends abstractPaymaster_1.AbstractPaymaster {
    callRelayer;
    type = 'None';
    op = null;
    paymasterService = null;
    network = null;
    provider = null;
    errorCallback = undefined;
    // this is a temporary solution where the live relayer doesn't have
    // a chain id paymaster route open yet as it's not merged
    ambirePaymasterUrl;
    constructor(relayerUrl, fetch, errorCallback) {
        super();
        this.callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch });
        this.errorCallback = errorCallback;
    }
    async init(op, userOp, account, network, provider) {
        this.op = op;
        this.network = network;
        this.provider = provider;
        this.ambirePaymasterUrl = `/v2/paymaster/${this.network.chainId}/request`;
        if (op.meta?.paymasterService && !op.meta?.paymasterService.failed) {
            try {
                this.paymasterService = op.meta.paymasterService;
                // when requesting stub data with an empty account, send over
                // the deploy data as per EIP-7677 standard
                const localOp = { ...userOp };
                if (BigInt(localOp.nonce) === 0n && account.creation) {
                    const factoryInterface = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
                    localOp.factory = account.creation.factoryAddr;
                    localOp.factoryData = factoryInterface.encodeFunctionData('deploy', [
                        account.creation.bytecode,
                        account.creation.salt
                    ]);
                }
                const response = await Promise.race([
                    (0, erc7677_1.getPaymasterStubData)(op.meta.paymasterService, localOp, network),
                    new Promise((_resolve, reject) => {
                        setTimeout(() => reject(new Error('Sponsorship error, request too slow')), 5000);
                    })
                ]);
                this.sponsorDataEstimation = response;
                this.type = 'ERC7677';
                return;
            }
            catch (e) {
                // TODO: error handling
                console.log(e);
            }
        }
        // has the paymaster dried up
        const seenInsufficientFunds = FailedPaymasters_1.failedPaymasters.insufficientFundsNetworks[Number(this.network.chainId)];
        if (network.erc4337.hasPaymaster && !seenInsufficientFunds) {
            this.type = 'Ambire';
            return;
        }
        // for custom networks, check if the paymaster there has balance
        if (!network.predefined || seenInsufficientFunds) {
            try {
                const ep = new ethers_1.Contract(deploy_1.ERC_4337_ENTRYPOINT, EntryPoint_json_1.default, provider);
                const paymasterBalance = await ep.balanceOf(deploy_1.AMBIRE_PAYMASTER);
                // if the network paymaster has failed because of insufficient funds,
                // disable it before getting a top up
                const minBalance = seenInsufficientFunds ? seenInsufficientFunds.lastSeenBalance : 0n;
                if (paymasterBalance > minBalance) {
                    this.type = 'Ambire';
                    if (seenInsufficientFunds)
                        FailedPaymasters_1.failedPaymasters.removeInsufficientFunds(network);
                    return;
                }
            }
            catch (e) {
                console.log('failed to retrieve the balance of the paymaster');
                console.error(e);
            }
        }
        this.type = 'None';
    }
    shouldIncludePayment() {
        return (this.type === 'Ambire' ||
            (this.type === 'ERC7677' && this.sponsorDataEstimation?.paymaster === deploy_1.AMBIRE_PAYMASTER) ||
            this.type === 'SwapSponsorship');
    }
    // get the fee call type used in the estimation
    // we use this to understand whether we should re-estimate on broadcast
    getFeeCallType(feeTokens) {
        if (!this.network)
            throw new Error('network not set, did you call init?');
        if (this.type === 'Ambire') {
            const feeToken = (0, estimateHelpers_1.getFeeTokenForEstimate)(feeTokens);
            if (!feeToken)
                return undefined;
            if (feeToken.flags.onGasTank)
                return 'gasTank';
            if (feeToken.address === ethers_1.ZeroAddress)
                return 'native';
            return 'erc20';
        }
        if (this.isSponsored())
            return 'gasTank';
        return undefined;
    }
    getFeeCallForEstimation(feeTokens) {
        if (!this.network)
            throw new Error('network not set, did you call init?');
        if (this.type === 'Ambire') {
            const feeToken = (0, estimateHelpers_1.getFeeTokenForEstimate)(feeTokens);
            if (!feeToken)
                return undefined;
            return (0, calls_1.getFeeCall)(feeToken);
        }
        // hardcode USDC gas tank 0 for sponsorships
        if (this.isSponsored()) {
            const abiCoder = new ethers_1.AbiCoder();
            return {
                to: addresses_1.FEE_COLLECTOR,
                value: 0n,
                data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', 0n, 'USDC'])
            };
        }
        return undefined;
    }
    getEstimationData() {
        if (this.type === 'ERC7677')
            return this.sponsorDataEstimation;
        if (this.type === 'Ambire')
            return getPaymasterDataForEstimate();
        if (this.type === 'SwapSponsorship')
            return getSwapSponsorshipEstimationData();
        return null;
    }
    isSponsored() {
        return this.type === 'ERC7677' || this.type === 'SwapSponsorship';
    }
    isUsable() {
        return this.type !== 'None';
    }
    async #retryPaymasterRequest(apiCall, counter = 0) {
        // retry the request 3 times before declaring it a failure
        if (counter >= 3) {
            const e = new Error('Ambire relayer error timeout');
            const convertedError = new customErrors_1.RelayerPaymasterError(e);
            const { message } = (0, errorHumanizer_1.getHumanReadableBroadcastError)(convertedError);
            return {
                success: false,
                message,
                error: e
            };
        }
        try {
            const response = await Promise.race([
                apiCall(),
                new Promise((_resolve, reject) => {
                    setTimeout(() => reject(new Error('Ambire relayer error timeout')), 8000);
                })
            ]);
            const isAmbirePaymaster = this.type === 'Ambire' || this.type === 'SwapSponsorship';
            return {
                success: true,
                paymaster: isAmbirePaymaster ? deploy_1.AMBIRE_PAYMASTER : response.paymaster,
                paymasterData: isAmbirePaymaster ? response.data.paymasterData : response.paymasterData
            };
        }
        catch (e) {
            if (e.message === 'Ambire relayer error timeout') {
                if (this.errorCallback) {
                    this.errorCallback({
                        level: 'major',
                        message: 'Paymaster is not responding. Retrying...',
                        error: new Error('Paymaster call timeout')
                    });
                }
                const increment = counter + 1;
                return this.#retryPaymasterRequest(apiCall, increment);
            }
            const convertedError = this.type === 'ERC7677' ? new customErrors_1.SponsorshipPaymasterError() : new customErrors_1.RelayerPaymasterError(e);
            const message = convertedError.isHumanized
                ? convertedError.message
                : (0, errorHumanizer_1.getHumanReadableBroadcastError)(convertedError).message;
            return {
                success: false,
                message,
                error: e
            };
        }
    }
    async #ambireCall(acc, op, userOp) {
        if (!this.provider)
            throw new Error('provider not set, did you call init?');
        if (!this.network)
            throw new Error('network not set, did you call init?');
        // request the paymaster with a timeout window
        const localUserOp = { ...userOp };
        localUserOp.paymaster = deploy_1.AMBIRE_PAYMASTER;
        return this.#retryPaymasterRequest(() => {
            return this.callRelayer(this.ambirePaymasterUrl, 'POST', {
                userOperation: (0, userOperation_1.getCleanUserOp)(localUserOp)[0],
                paymaster: deploy_1.AMBIRE_PAYMASTER,
                bytecode: acc.creation?.bytecode,
                salt: acc.creation?.salt,
                key: acc.associatedKeys[0],
                rpcUrl: this.provider._getConnection().url,
                bundler: userOp.bundler,
                swapSponsorship: this.type === 'SwapSponsorship' && this.op?.meta?.swapSponsorship
                    ? {
                        price: this.op.meta.swapSponsorship.fromTokenPriceInUsd,
                        decimals: this.op.meta.swapSponsorship.fromTokenDecimals
                    }
                    : undefined
            });
        });
    }
    async #erc7677Call(op, userOp, network) {
        const sponsorData = this.sponsorDataEstimation;
        // no need to do an extra call if the dapp has already provided sponsorship
        if ('isFinal' in sponsorData && sponsorData.isFinal)
            return {
                success: true,
                paymaster: sponsorData.paymaster,
                paymasterData: sponsorData.paymasterData
            };
        const localUserOp = { ...userOp };
        localUserOp.paymaster = sponsorData.paymaster;
        localUserOp.paymasterData = sponsorData.paymasterData;
        const response = await this.#retryPaymasterRequest(() => {
            return (0, erc7677_1.getPaymasterData)(this.paymasterService, localUserOp, network);
        });
        if (!response.success && op.meta && op.meta.paymasterService) {
            FailedPaymasters_1.failedPaymasters.addFailedSponsorship(op.meta.paymasterService.id);
        }
        return response;
    }
    async call(acc, op, userOp, network) {
        if (this.isAmbire())
            return this.#ambireCall(acc, op, userOp);
        if (this.type === 'ERC7677')
            return this.#erc7677Call(op, userOp, network);
        throw new Error('Paymaster not configured. Please contact support');
    }
    isAmbire() {
        return this.type === 'Ambire' || this.type === 'SwapSponsorship';
    }
    isEstimateBelowMin(localOp) {
        const min = this.getEstimationData();
        if (!min || !min.paymasterVerificationGasLimit)
            return false;
        return (localOp.paymasterVerificationGasLimit === undefined ||
            BigInt(localOp.paymasterVerificationGasLimit) < BigInt(min.paymasterVerificationGasLimit));
    }
    /**
     * We use the upgrade method when we initially need to start with another
     * paymaster type, e.g. Ambire, but then we understand we can use another
     * one because special conditions apply.
     * One such case is the swap&bridge where we first need to know the estimation
     * from the bundler so we could calculate the txn fee. If the swap fee is
     * bigger than the txn fee, we upgrade the paymaster to SwapSponsorship.
     */
    upgrade(bundlerEstimateResult, gasPrices) {
        // ERC7677 is already sponsoring the userOperation so we don't upgrade over it
        if (!this.op?.meta?.swapSponsorship || this.type === 'ERC7677')
            return;
        const gas = BigInt(bundlerEstimateResult.callGasLimit) + BigInt(bundlerEstimateResult.preVerificationGas);
        const amountInWei = gas * BigInt(gasPrices.ape.maxFeePerGas);
        const cost = Number((0, formatters_1.safeTokenAmountAndNumberMultiplication)(amountInWei, 18, this.op.meta.swapSponsorship.nativePrice));
        const costPlusOverhead = cost + cost * 0.25;
        if (costPlusOverhead < this.op.meta.swapSponsorship.swapFeeInUsd)
            this.type = 'SwapSponsorship';
    }
}
exports.Paymaster = Paymaster;
//# sourceMappingURL=paymaster.js.map