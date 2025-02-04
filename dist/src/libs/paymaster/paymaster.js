/* eslint-disable no-console */
import { AbiCoder, Contract, toBeHex } from 'ethers';
import entryPointAbi from '../../../contracts/compiled/EntryPoint.json';
import { FEE_COLLECTOR } from '../../consts/addresses';
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT } from '../../consts/deploy';
import { failedPaymasters } from '../../services/paymaster/FailedPaymasters';
import { getFeeCall } from '../calls/calls';
import { getPaymasterData, getPaymasterStubData } from '../erc7677/erc7677';
import { RelayerPaymasterError, SponsorshipPaymasterError } from '../errorDecoder/customErrors';
import { getHumanReadableBroadcastError } from '../errorHumanizer';
import { PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE } from '../errorHumanizer/broadcastErrorHumanizer';
import { getFeeTokenForEstimate } from '../estimate/estimateHelpers';
import { getCleanUserOp, getSigForCalculations } from '../userOperation/userOperation';
import { AbstractPaymaster } from './abstractPaymaster';
export function getPaymasterDataForEstimate() {
    const abiCoder = new AbiCoder();
    return {
        paymaster: AMBIRE_PAYMASTER,
        paymasterVerificationGasLimit: toBeHex(100000),
        paymasterPostOpGasLimit: toBeHex(0),
        paymasterData: abiCoder.encode(['uint48', 'uint48', 'bytes'], [0, 0, getSigForCalculations()])
    };
}
export class Paymaster extends AbstractPaymaster {
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
                    getPaymasterStubData(op.meta.paymasterService, userOp, network),
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
        const seenInsufficientFunds = failedPaymasters.insufficientFundsNetworks[Number(this.network.chainId)];
        if (network.erc4337.hasPaymaster && !seenInsufficientFunds) {
            this.type = 'Ambire';
            return;
        }
        // for custom networks, check if the paymaster there has balance
        if (!network.predefined || seenInsufficientFunds) {
            try {
                const ep = new Contract(ERC_4337_ENTRYPOINT, entryPointAbi, provider);
                const paymasterBalance = await ep.balanceOf(AMBIRE_PAYMASTER);
                // if the network paymaster has failed because of insufficient funds,
                // disable it before getting a top up
                const minBalance = seenInsufficientFunds ? seenInsufficientFunds.lastSeenBalance : 0n;
                if (paymasterBalance > minBalance) {
                    this.type = 'Ambire';
                    if (seenInsufficientFunds)
                        failedPaymasters.removeInsufficientFunds(network);
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
            const feeToken = getFeeTokenForEstimate(feeTokens, this.network);
            if (!feeToken)
                return undefined;
            return getFeeCall(feeToken);
        }
        // hardcode USDC gas tank 0 for sponsorships
        if (this.type === 'ERC7677') {
            const abiCoder = new AbiCoder();
            return {
                to: FEE_COLLECTOR,
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
            const convertedError = new RelayerPaymasterError(e);
            const { message } = getHumanReadableBroadcastError(convertedError);
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
                paymaster: this.type === 'Ambire' ? AMBIRE_PAYMASTER : response.paymaster,
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
            const convertedError = this.type === 'ERC7677' ? new SponsorshipPaymasterError() : new RelayerPaymasterError(e);
            const { message } = getHumanReadableBroadcastError(convertedError);
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
        localUserOp.paymaster = AMBIRE_PAYMASTER;
        return this.#retryPaymasterRequest(() => {
            return this.callRelayer(`/v2/paymaster/${op.networkId}/sign`, 'POST', {
                userOperation: getCleanUserOp(localUserOp)[0],
                paymaster: AMBIRE_PAYMASTER,
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
            return getPaymasterData(this.paymasterService, localUserOp, network);
        });
        if (!response.success &&
            response.message !== PAYMASTER_DOWN_BROADCAST_ERROR_MESSAGE &&
            op.meta &&
            op.meta.paymasterService) {
            failedPaymasters.addFailedSponsorship(op.meta.paymasterService.id);
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
//# sourceMappingURL=paymaster.js.map