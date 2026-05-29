import { getRpcProvider } from '@/services/provider';
import { PIMLICO } from '../../consts/bundlers';
import { Bundler } from './bundler';
export class Pimlico extends Bundler {
    getUrl(network) {
        const API_KEY = process.env.REACT_APP_PIMLICO_API_KEY || '';
        if (!API_KEY) {
            throw new Error('Pimlico API key is not set');
        }
        return `https://api.pimlico.io/v2/${network.chainId}/rpc?apikey=${API_KEY}`;
    }
    /**
     * Pimlico has a second API url used for fallback purposes that skips
     * cloudflare. We will use it as a fallback to retry automatically
     * when the original URL fails
     */
    getFallbackProvider(network) {
        const API_KEY = process.env.REACT_APP_PIMLICO_API_KEY || '';
        if (!API_KEY) {
            throw new Error('Pimlico API key is not set');
        }
        const url = `https://api-direct.pimlico.io/v2/${network.chainId}/rpc?apikey=${API_KEY}`;
        return getRpcProvider([url], network.chainId);
    }
    async getGasPrice(network) {
        const provider = this.getProvider(network);
        // try main URL; retry with fallback on failure
        let prices;
        try {
            prices = await provider.send('pimlico_getUserOperationGasPrice', []);
        }
        catch (e) {
            console.log('fallback to api-direct');
            const fallbackProvider = this.getFallbackProvider(network);
            prices = await fallbackProvider.send('pimlico_getUserOperationGasPrice', []);
        }
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
    shouldReestimateBeforeBroadcast() {
        return false;
    }
}
//# sourceMappingURL=pimlico.js.map