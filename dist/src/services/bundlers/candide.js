"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Candide = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const bundlers_1 = require("../../consts/bundlers");
const bundler_1 = require("./bundler");
class Candide extends bundler_1.Bundler {
    getUrl(network) {
        const API_KEY = process.env.REACT_APP_CANDIDE_API_KEY || '';
        if (!API_KEY) {
            throw new Error('Candide API key is not set');
        }
        return `https://api.candide.dev/api/v3/${network.chainId.toString()}/${API_KEY}`;
    }
    async getGasPrice(network) {
        const provider = this.getProvider(network);
        const prices = await provider.send('voltaire_feesPerGas', []);
        return {
            slow: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: prices.maxPriorityFeePerGas
            },
            medium: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: prices.maxPriorityFeePerGas
            },
            fast: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: prices.maxPriorityFeePerGas
            },
            ape: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: prices.maxPriorityFeePerGas
            }
        };
    }
    async getStatus(network, userOpHash) {
        const provider = this.getProvider(network);
        const status = await provider.send('eth_getUserOperationByHash', [userOpHash]).catch((e) => {
            console.log('candide eth_getUserOperationByHash returned an error');
            console.log(e);
            return null;
        });
        if (!status) {
            return {
                status: 'not_found'
            };
        }
        return {
            status: 'found',
            transactionHash: status.transactionHash
        };
    }
    async estimate(userOperation, network, stateOverride) {
        const estimatiton = await this.sendEstimateReq(userOperation, network, stateOverride);
        return {
            // add 20000n overhead as discussed with candide
            preVerificationGas: (0, ethers_1.toBeHex)(BigInt(estimatiton.preVerificationGas) + 20000n),
            verificationGasLimit: (0, ethers_1.toBeHex)(BigInt(estimatiton.verificationGasLimit) + 20000n),
            callGasLimit: (0, ethers_1.toBeHex)(estimatiton.callGasLimit),
            paymasterVerificationGasLimit: estimatiton.paymasterVerificationGasLimit
                ? (0, ethers_1.toBeHex)(estimatiton.paymasterVerificationGasLimit)
                : '0x00',
            paymasterPostOpGasLimit: estimatiton.paymasterPostOpGasLimit
                ? (0, ethers_1.toBeHex)(estimatiton.paymasterPostOpGasLimit)
                : '0x00'
        };
    }
    getName() {
        return bundlers_1.CANDIDE;
    }
    shouldReestimateBeforeBroadcast(network) {
        return true;
    }
}
exports.Candide = Candide;
//# sourceMappingURL=candide.js.map