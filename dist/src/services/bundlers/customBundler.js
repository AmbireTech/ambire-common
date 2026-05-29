"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomBundler = void 0;
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const bundlers_1 = require("../../consts/bundlers");
const bundler_1 = require("./bundler");
class CustomBundler extends bundler_1.Bundler {
    getUrl(network) {
        if (!network.customBundlerUrl)
            throw new Error('custom bundler not set');
        return network.customBundlerUrl;
    }
    async getGasPrice(network) {
        const chain = (0, viem_1.defineChain)({
            id: Number(network.chainId),
            name: network.name,
            nativeCurrency: {
                name: network.nativeAssetId,
                symbol: network.nativeAssetSymbol,
                decimals: 18
            },
            rpcUrls: {
                default: {
                    http: [network.selectedRpcUrl]
                },
                public: {
                    http: [network.selectedRpcUrl]
                }
            },
            blockExplorers: {
                default: {
                    name: 'Block explorer',
                    url: network.explorerUrl || ''
                }
            }
        });
        const client = (0, viem_1.createPublicClient)({
            chain,
            transport: (0, viem_1.http)()
        });
        const data = await client.estimateFeesPerGas();
        return {
            slow: {
                maxFeePerGas: (0, ethers_1.toBeHex)(data.maxFeePerGas),
                maxPriorityFeePerGas: (0, ethers_1.toBeHex)(data.maxPriorityFeePerGas)
            },
            medium: {
                maxFeePerGas: (0, ethers_1.toBeHex)(data.maxFeePerGas),
                maxPriorityFeePerGas: (0, ethers_1.toBeHex)(data.maxPriorityFeePerGas)
            },
            fast: {
                maxFeePerGas: (0, ethers_1.toBeHex)(data.maxFeePerGas),
                maxPriorityFeePerGas: (0, ethers_1.toBeHex)(data.maxPriorityFeePerGas)
            },
            ape: {
                maxFeePerGas: (0, ethers_1.toBeHex)(data.maxFeePerGas),
                maxPriorityFeePerGas: (0, ethers_1.toBeHex)(data.maxPriorityFeePerGas)
            }
        };
    }
    async getStatus(network, userOpHash) {
        const provider = this.getProvider(network);
        const status = await provider.send('eth_getUserOperationReceipt', [userOpHash]).catch((e) => {
            console.log(`custom bundler with url ${this.getUrl(network)} failed to find the status of the user op`);
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
        return bundlers_1.CUSTOM;
    }
    shouldReestimateBeforeBroadcast() {
        return true;
    }
}
exports.CustomBundler = CustomBundler;
//# sourceMappingURL=customBundler.js.map