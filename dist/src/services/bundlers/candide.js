/* eslint-disable @typescript-eslint/no-unused-vars */
import { toBeHex } from 'ethers';
import { CANDIDE } from '../../consts/bundlers';
import { Bundler } from './bundler';
export class Candide extends Bundler {
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
            preVerificationGas: toBeHex(BigInt(estimatiton.preVerificationGas) + 20000n),
            verificationGasLimit: toBeHex(BigInt(estimatiton.verificationGasLimit) + 20000n),
            callGasLimit: toBeHex(estimatiton.callGasLimit),
            paymasterVerificationGasLimit: estimatiton.paymasterVerificationGasLimit
                ? toBeHex(estimatiton.paymasterVerificationGasLimit)
                : '0x00',
            paymasterPostOpGasLimit: estimatiton.paymasterPostOpGasLimit
                ? toBeHex(estimatiton.paymasterPostOpGasLimit)
                : '0x00'
        };
    }
    getName() {
        return CANDIDE;
    }
    shouldReestimateBeforeBroadcast(network) {
        return true;
    }
}
//# sourceMappingURL=candide.js.map