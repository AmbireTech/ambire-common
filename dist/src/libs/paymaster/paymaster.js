"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Paymaster = exports.getPaymasterDataForEstimate = void 0;
const tslib_1 = require("tslib");
/* eslint-disable no-console */
const ethers_1 = require("ethers");
const EntryPoint_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/EntryPoint.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
const FailedPaymasters_1 = require("../../services/paymaster/FailedPaymasters");
const calls_1 = require("../calls/calls");
const erc7677_1 = require("../erc7677/erc7677");
const customErrors_1 = require("../errorDecoder/customErrors");
const errorHumanizer_1 = require("../errorHumanizer");
const broadcastErrorHumanizer_1 = require("../errorHumanizer/broadcastErrorHumanizer");
const estimateHelpers_1 = require("../estimate/estimateHelpers");
const userOperation_1 = require("../userOperation/userOperation");
const abstractPaymaster_1 = require("./abstractPaymaster");
function getPaymasterDataForEstimate() {
    const abiCoder = new ethers_1.AbiCoder();
    return {
        paymaster: deploy_1.AMBIRE_PAYMASTER,
        paymasterVerificationGasLimit: (0, ethers_1.toBeHex)(100000),
        paymasterPostOpGasLimit: (0, ethers_1.toBeHex)(0),
        paymasterData: abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, (0, userOperation_1.getSigForCalculations)()])
    };
}
exports.getPaymasterDataForEstimate = getPaymasterDataForEstimate;
class Paymaster extends abstractPaymaster_1.AbstractPaymaster {
    callRelayer;
    type = 'None';
    sponsorDataEstimation;
    paymasterService = null;
    network = null;
    provider = null;
    errorCallback = undefined;
    constructor(callRelayer, errorCallback) {
        super();
        this.callRelayer = callRelayer;
        this.errorCallback = errorCallback;
    }
    async init(op, userOp, network, provider) {
        this.network = network;
        this.provider = provider;
        if (op.meta?.paymasterService && !op.meta?.paymasterService.failed) {
            try {
                this.paymasterService = op.meta.paymasterService;
                const response = await Promise.race([
                    (0, erc7677_1.getPaymasterStubData)(op.meta.paymasterService, userOp, network),
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
        return this.type === 'Ambire' || this.type === 'ERC7677';
    }
    getFeeCallForEstimation(feeTokens) {
        if (!this.network)
            throw new Error('network not set, did you call init?');
        if (this.type === 'Ambire') {
            const feeToken = (0, estimateHelpers_1.getFeeTokenForEstimate)(feeTokens, this.network);
            if (!feeToken)
                return undefined;
            return (0, calls_1.getFeeCall)(feeToken);
        }
        // hardcode USDC gas tank 0 for sponsorships
        if (this.type === 'ERC7677') {
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
        return null;
    }
    isSponsored() {
        return this.type === 'ERC7677';
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
            return {
                success: true,
                paymaster: this.type === 'Ambire' ? deploy_1.AMBIRE_PAYMASTER : response.paymaster,
                paymasterData: this.type === 'Ambire' ? response.data.paymasterData : response.paymasterData
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
            const { message } = (0, errorHumanizer_1.getHumanReadableBroadcastError)(convertedError);
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
            return this.callRelayer(`/v2/paymaster/${op.networkId}/sign`, 'POST', {
                userOperation: (0, userOperation_1.getCleanUserOp)(localUserOp)[0],
                paymaster: deploy_1.AMBIRE_PAYMASTER,
                bytecode: acc.creation.bytecode,
                salt: acc.creation.salt,
                key: acc.associatedKeys[0],
                // eslint-disable-next-line no-underscore-dangle
                rpcUrl: this.provider._getConnection().url,
                bundler: userOp.bundler
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
        if (!response.success &&
            response.message !== broadcastErrorHumanizer_1.PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE &&
            op.meta &&
            op.meta.paymasterService) {
            FailedPaymasters_1.failedPaymasters.addFailedSponsorship(op.meta.paymasterService.id);
        }
        return response;
    }
    async call(acc, op, userOp, network) {
        if (this.type === 'Ambire')
            return this.#ambireCall(acc, op, userOp);
        if (this.type === 'ERC7677')
            return this.#erc7677Call(op, userOp, network);
        throw new Error('Paymaster not configured. Please contact support');
    }
}
exports.Paymaster = Paymaster;
//# sourceMappingURL=paymaster.js.map