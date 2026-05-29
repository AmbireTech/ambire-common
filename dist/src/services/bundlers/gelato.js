"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gelato = void 0;
const bundlers_1 = require("../../consts/bundlers");
const provider_1 = require("../provider");
const bundler_1 = require("./bundler");
class Gelato extends bundler_1.Bundler {
    getUrl(network) {
        return `https://api.gelato.cloud/rpc/${network.chainId.toString()}`;
    }
    /**
     * Get the bundler RPC
     *
     * @param network
     */
    getProvider(network) {
        const provider = (0, provider_1.getRpcProvider)([this.getUrl(network)], network.chainId);
        const gelatoSend = async (method, params) => {
            const response = await fetch(this.getUrl(network), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': process.env.REACT_APP_GELATO_API_KEY
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method,
                    params
                })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Bundler request failed');
            }
            const json = await response.json();
            if (json.error)
                throw new Error(json.error.message || 'Bundler request failed');
            return json.result;
        };
        provider.send = gelatoSend;
        return provider;
    }
    async getGasPrice(network) {
        const provider = this.getProvider(network);
        const prices = await provider.send('gelato_getUserOperationGasPrice', []);
        // do not set a priority of 0
        const priority = prices.maxPriorityFeePerGas === '0x0' ? '0x1' : prices.maxPriorityFeePerGas;
        return {
            slow: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: priority
            },
            medium: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: priority
            },
            fast: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: priority
            },
            ape: {
                maxFeePerGas: prices.maxFeePerGas,
                maxPriorityFeePerGas: priority
            }
        };
    }
    async estimate(userOperation, network, stateOverride) {
        const estimatiton = await this.sendEstimateReq(userOperation, network, stateOverride);
        return {
            preVerificationGas: estimatiton.preVerificationGas,
            verificationGasLimit: estimatiton.verificationGasLimit,
            callGasLimit: estimatiton.callGasLimit,
            paymasterVerificationGasLimit: estimatiton.paymasterVerificationGasLimit
                ? estimatiton.paymasterVerificationGasLimit
                : '0x0',
            paymasterPostOpGasLimit: estimatiton.paymasterPostOpGasLimit
                ? estimatiton.paymasterPostOpGasLimit
                : '0x0'
        };
    }
    async getStatus(network, userOpHash) {
        const provider = this.getProvider(network);
        const status = await provider.send('eth_getUserOperationReceipt', [userOpHash]).catch((e) => {
            console.log('gelato failed to find the status of the user op');
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
        return bundlers_1.GELATO;
    }
    shouldReestimateBeforeBroadcast(network) {
        return true;
    }
}
exports.Gelato = Gelato;
//# sourceMappingURL=gelato.js.map