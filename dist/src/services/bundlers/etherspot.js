/* eslint-disable @typescript-eslint/no-unused-vars */
import { ETHERSPOT } from '../../consts/bundlers';
import { Bundler } from './bundler';
export class Etherspot extends Bundler {
    getUrl(network) {
        const API_KEY = process.env.REACT_APP_ETHERSPOT_API_KEY || '';
        if (!API_KEY) {
            throw new Error('Etherspot API key is not set');
        }
        return `https://rpc.etherspot.io/v2/${network.chainId.toString()}?api-key=${API_KEY}`;
    }
    async getGasPrice(network) {
        const provider = this.getProvider(network);
        const prices = await provider.send('skandha_getGasPrice', []);
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
        const status = await provider.send('eth_getUserOperationReceipt', [userOpHash]).catch((e) => {
            console.log('etherspot failed to find the status of the user op');
            console.log(e);
            return null;
        });
        if (!status || !status.receipt) {
            return {
                status: 'not_found'
            };
        }
        return {
            status: 'found',
            transactionHash: status.receipt.transactionHash
        };
    }
    getName() {
        return ETHERSPOT;
    }
    shouldReestimateBeforeBroadcast(network) {
        return false;
    }
}
//# sourceMappingURL=etherspot.js.map