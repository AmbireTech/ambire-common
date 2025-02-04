import { PIMLICO } from '../../consts/bundlers';
import { Bundler } from './bundler';
export class Pimlico extends Bundler {
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
        return PIMLICO;
    }
}
//# sourceMappingURL=pimlico.js.map