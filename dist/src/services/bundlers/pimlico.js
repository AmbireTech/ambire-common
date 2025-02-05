"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pimlico = void 0;
const bundlers_1 = require("../../consts/bundlers");
const bundler_1 = require("./bundler");
class Pimlico extends bundler_1.Bundler {
    getUrl(network) {
        return `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}`;
    }
    async getGasPrice(network) {
        const provider = this.getProvider(network);
        const prices = await provider.send('pimlico_getUserOperationGasPrice', []);
        prices.medium = prices.standard;
        prices.ape = prices.fast;
        delete prices.standard;
        return prices;
    }
    async getStatus(network, userOpHash) {
        const provider = this.getProvider(network);
        return provider.send('pimlico_getUserOperationStatus', [userOpHash]);
    }
    getName() {
        return bundlers_1.PIMLICO;
    }
}
exports.Pimlico = Pimlico;
//# sourceMappingURL=pimlico.js.map