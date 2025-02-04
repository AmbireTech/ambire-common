/* eslint-disable no-restricted-syntax */
/* eslint-disable class-methods-use-this */
import { toBeHex } from 'ethers';
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from '../../consts/deploy';
import { decodeError } from '../../libs/errorDecoder';
import { BundlerError } from '../../libs/errorDecoder/customErrors';
import { privSlot } from '../../libs/proxyDeploy/deploy';
import { getCleanUserOp } from '../../libs/userOperation/userOperation';
import { getRpcProvider } from '../provider';
require('dotenv').config();
function addExtra(gasInWei, percentageIncrease) {
    const percent = 100n / percentageIncrease;
    return toBeHex(gasInWei + gasInWei / percent);
}
export class Bundler {
    /**
     * The default pollWaitTime. This is used to determine
     * how many milliseconds to wait until before another request to the
     * bundler for the receipt is sent
     */
    pollWaitTime = 1500;
    /**
     * Get the bundler RPC
     *
     * @param network
     */
    getProvider(network) {
        return getRpcProvider([this.getUrl(network)], network.chainId);
    }
    async sendEstimateReq(userOperation, network, shouldStateOverride = false) {
        const provider = this.getProvider(network);
        if (shouldStateOverride) {
            return provider.send('eth_estimateUserOperationGas', [
                getCleanUserOp(userOperation)[0],
                ERC_4337_ENTRYPOINT,
                {
                    [userOperation.sender]: {
                        stateDiff: {
                            // add privileges to the entry point
                            [`0x${privSlot(0, 'address', ERC_4337_ENTRYPOINT, 'bytes32')}`]: ENTRY_POINT_MARKER
                        }
                    }
                }
            ]);
        }
        return provider.send('eth_estimateUserOperationGas', [
            getCleanUserOp(userOperation)[0],
            ERC_4337_ENTRYPOINT
        ]);
    }
    async estimate(userOperation, network, shouldStateOverride = false) {
        const estimatiton = await this.sendEstimateReq(userOperation, network, shouldStateOverride);
        return {
            preVerificationGas: toBeHex(estimatiton.preVerificationGas),
            verificationGasLimit: toBeHex(estimatiton.verificationGasLimit),
            callGasLimit: toBeHex(estimatiton.callGasLimit),
            paymasterVerificationGasLimit: toBeHex(estimatiton.paymasterVerificationGasLimit),
            paymasterPostOpGasLimit: toBeHex(estimatiton.paymasterPostOpGasLimit)
        };
    }
    /**
     * Get the transaction receipt from the userOperationHash if ready
     *
     * @param userOperationHash
     * @returns Receipt | null
     */
    async getReceipt(userOperationHash, network) {
        const provider = this.getProvider(network);
        return provider.send('eth_getUserOperationReceipt', [userOperationHash]);
    }
    /**
     * Broadcast a userOperation to the specified bundler and get a userOperationHash in return
     *
     * @param UserOperation userOperation
     * @returns userOperationHash
     */
    async broadcast(userOperation, network) {
        const provider = this.getProvider(network);
        return provider.send('eth_sendUserOperation', [
            getCleanUserOp(userOperation)[0],
            ERC_4337_ENTRYPOINT
        ]);
    }
    // use this request to check if the bundler supports the network
    static async isNetworkSupported(fetch, chainId) {
        const url = `https://api.pimlico.io/health?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}&chain-id=${chainId}`;
        const result = await fetch(url);
        return result.status === 200;
    }
    async fetchGasPrices(network, errorCallback, counter = 0) {
        const hasFallback = network.erc4337.bundlers && network.erc4337.bundlers.length > 1;
        if (counter >= (hasFallback ? 2 : 5))
            throw new Error("Couldn't fetch gas prices");
        let response;
        try {
            response = await Promise.race([
                this.getGasPrice(network),
                new Promise((_resolve, reject) => {
                    setTimeout(() => reject(new Error('fetching bundler gas prices failed, request too slow')), hasFallback ? 4500 : 6000);
                })
            ]);
        }
        catch (e) {
            // report the error back only if there's no fallback
            if (!hasFallback) {
                errorCallback({
                    level: 'major',
                    message: 'Estimating gas prices from the bundler timed out. Retrying...',
                    error: new Error('Budler gas prices estimation timeout')
                });
            }
            const increment = counter + 1;
            return this.fetchGasPrices(network, errorCallback, increment);
        }
        const results = response;
        return {
            slow: {
                maxFeePerGas: addExtra(BigInt(results.slow.maxFeePerGas), 5n),
                maxPriorityFeePerGas: addExtra(BigInt(results.slow.maxPriorityFeePerGas), 5n)
            },
            medium: {
                maxFeePerGas: addExtra(BigInt(results.medium.maxFeePerGas), 7n),
                maxPriorityFeePerGas: addExtra(BigInt(results.medium.maxPriorityFeePerGas), 7n)
            },
            fast: {
                maxFeePerGas: addExtra(BigInt(results.fast.maxFeePerGas), 10n),
                maxPriorityFeePerGas: addExtra(BigInt(results.fast.maxPriorityFeePerGas), 10n)
            },
            ape: {
                maxFeePerGas: addExtra(BigInt(results.ape.maxFeePerGas), 20n),
                maxPriorityFeePerGas: addExtra(BigInt(results.ape.maxPriorityFeePerGas), 20n)
            }
        };
    }
    // used when catching errors from bundler requests
    decodeBundlerError(e) {
        const error = new BundlerError(e.message, this.getName());
        return decodeError(error);
    }
}
//# sourceMappingURL=bundler.js.map