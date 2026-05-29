"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bundler = void 0;
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const errorDecoder_1 = require("../../libs/errorDecoder");
const customErrors_1 = require("../../libs/errorDecoder/customErrors");
const userOperation_1 = require("../../libs/userOperation/userOperation");
const provider_1 = require("../provider");
class Bundler {
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
        return (0, provider_1.getRpcProvider)([this.getUrl(network)], network.chainId);
    }
    async sendEstimateReq(userOperation, network, stateOverride) {
        const provider = this.getProvider(network);
        return stateOverride
            ? provider.send('eth_estimateUserOperationGas', [
                (0, userOperation_1.getCleanUserOp)(userOperation)[0],
                deploy_1.ERC_4337_ENTRYPOINT,
                stateOverride
            ])
            : provider.send('eth_estimateUserOperationGas', [
                (0, userOperation_1.getCleanUserOp)(userOperation)[0],
                deploy_1.ERC_4337_ENTRYPOINT
            ]);
    }
    async estimate(userOperation, network, stateOverride) {
        const estimatiton = await this.sendEstimateReq(userOperation, network, stateOverride);
        // Whole formula:
        // final = estimation + estimation * percentage
        // if percentage = 5% then percentage = 5/100 => 1/20
        // final = estimation + estimation / 20
        // here, we calculate the division (20 above)
        const division = network.erc4337.increasePreVerGas
            ? BigInt(100 / network.erc4337.increasePreVerGas)
            : undefined;
        // transform
        const preVerificationGas = division
            ? BigInt(estimatiton.preVerificationGas) + BigInt(estimatiton.preVerificationGas) / division
            : BigInt(estimatiton.preVerificationGas);
        return {
            preVerificationGas: (0, ethers_1.toBeHex)(preVerificationGas),
            verificationGasLimit: (0, ethers_1.toBeHex)(estimatiton.verificationGasLimit),
            callGasLimit: (0, ethers_1.toBeHex)(estimatiton.callGasLimit),
            paymasterVerificationGasLimit: estimatiton.paymasterVerificationGasLimit
                ? (0, ethers_1.toBeHex)(estimatiton.paymasterVerificationGasLimit)
                : '0x00',
            paymasterPostOpGasLimit: estimatiton.paymasterPostOpGasLimit
                ? (0, ethers_1.toBeHex)(estimatiton.paymasterPostOpGasLimit)
                : '0x00'
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
            (0, userOperation_1.getCleanUserOp)(userOperation)[0],
            deploy_1.ERC_4337_ENTRYPOINT
        ]);
    }
    // use this request to check if the bundler supports the network
    static async isNetworkSupported(fetch, chainId) {
        if (chainId === 146n)
            return true;
        const url = `https://api.pimlico.io/health?apikey=${process.env.REACT_APP_PIMLICO_API_KEY}&chain-id=${chainId}`;
        const result = await fetch(url);
        return result.status === 200;
    }
    async fetchGasPrices(network) {
        return this.getGasPrice(network);
    }
    // used when catching errors from bundler requests
    decodeBundlerError(e) {
        const error = new customErrors_1.BundlerError(e.message, this.getName());
        return (0, errorDecoder_1.decodeError)(error);
    }
    /**
     * Different bundlers return the success flag differently:
     * - number, string (0,1), string (success)
     * We make it one and the same here
     */
    static getReceiptSuccess(bundlerTransactionReceipt) {
        const receipt = bundlerTransactionReceipt.receipt;
        if (receipt.status === undefined)
            return bundlerTransactionReceipt.success ? 1n : 0n;
        let statusAsNumber = 0n;
        try {
            statusAsNumber = BigInt(receipt.status);
        }
        catch (e) {
            statusAsNumber = receipt.status === 'success' ? 1n : 0n;
        }
        return statusAsNumber;
    }
}
exports.Bundler = Bundler;
//# sourceMappingURL=bundler.js.map