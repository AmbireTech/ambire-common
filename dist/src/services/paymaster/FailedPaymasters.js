"use strict";
/* eslint-disable no-console */
Object.defineProperty(exports, "__esModule", { value: true });
exports.failedPaymasters = exports.FailedPaymasters = void 0;
const tslib_1 = require("tslib");
/*
 * a singleton for recording failed paymaster requests
 */
const ethers_1 = require("ethers");
const EntryPoint_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/EntryPoint.json"));
const deploy_1 = require("../../consts/deploy");
// so the app can fallback to a standard Paymaster if a sponsorship fails
class FailedPaymasters {
    failedSponsorshipIds = [];
    insufficientFundsNetworks = {};
    addFailedSponsorship(id) {
        this.failedSponsorshipIds.push(id);
    }
    hasFailedSponsorship(id) {
        return this.failedSponsorshipIds.includes(id);
    }
    async addInsufficientFunds(provider, network) {
        let paymasterBalance = 0n;
        try {
            const ep = new ethers_1.Contract(deploy_1.ERC_4337_ENTRYPOINT, EntryPoint_json_1.default, provider);
            paymasterBalance = await ep.balanceOf(deploy_1.AMBIRE_PAYMASTER);
        }
        catch (e) {
            console.log('failed to retrieve the balance of the paymaster');
            console.error(e);
        }
        this.insufficientFundsNetworks[Number(network.chainId)] = {
            lastSeenBalance: paymasterBalance
        };
    }
    hasInsufficientFunds(network) {
        return !!this.insufficientFundsNetworks[Number(network.chainId)];
    }
    removeInsufficientFunds(network) {
        delete this.insufficientFundsNetworks[Number(network.chainId)];
    }
}
exports.FailedPaymasters = FailedPaymasters;
exports.failedPaymasters = new FailedPaymasters();
//# sourceMappingURL=FailedPaymasters.js.map