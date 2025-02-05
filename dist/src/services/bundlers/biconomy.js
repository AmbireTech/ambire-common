"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Biconomy = void 0;
/* eslint-disable class-methods-use-this */
const bundlers_1 = require("../../consts/bundlers");
const bundler_1 = require("./bundler");
class Biconomy extends bundler_1.Bundler {
    getUrl(network) {
        return `https://bundler.biconomy.io/api/v3/${network.chainId}/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44`;
    }
    async getGasPrice(network) {
        const provider = this.getProvider(network);
        const prices = await provider.send('biconomy_getGasFeeValues', []);
        prices.medium = prices.standard;
        prices.ape = prices.fast;
        delete prices.standard;
        return prices;
    }
    async getStatus(network, userOpHash) {
        const provider = this.getProvider(network);
        const result = await provider
            .send('biconomy_getUserOperationStatus', [userOpHash])
            .catch((e) => {
            console.log('biconomy_getUserOperationStatus returned an error');
            console.log(e);
            return {
                state: 'NOT_FOUND'
            };
        });
        let userOpStatus = {
            status: 'not_found'
        };
        if (result.state) {
            switch (result.state) {
                case 'NOT_FOUND':
                    userOpStatus = {
                        status: 'not_found'
                    };
                    break;
                // currently, we don't handle the middle stage called bundler mempool
                // it can be treated the same way as not_found - which means it will
                // query the bundler again until it has a txnId
                case 'BUNDLER_MEMPOOL':
                    userOpStatus = {
                        status: 'not_found'
                    };
                    break;
                case 'DROPPED_FROM_BUNDLER_MEMPOOL':
                    userOpStatus = {
                        status: 'rejected'
                    };
                    break;
                case 'SUBMITTED':
                case 'FAILED':
                    userOpStatus = {
                        status: 'found',
                        transactionHash: result.transactionHash
                    };
                    break;
                case 'CONFIRMED':
                    userOpStatus = {
                        status: 'found',
                        transactionHash: result.transactionHash
                    };
                    break;
                default:
                    break;
            }
        }
        return userOpStatus;
    }
    getName() {
        return bundlers_1.BICONOMY;
    }
}
exports.Biconomy = Biconomy;
//# sourceMappingURL=biconomy.js.map