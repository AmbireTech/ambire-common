/* eslint-disable no-console */
/*
 * a singleton for recording failed paymaster requests
 */
import { Contract } from 'ethers';
import entryPointAbi from '../../../contracts/compiled/EntryPoint.json';
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT } from '../../consts/deploy';
// so the app can fallback to a standard Paymaster if a sponsorship fails
export class FailedPaymasters {
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
            const ep = new Contract(ERC_4337_ENTRYPOINT, entryPointAbi, provider);
            paymasterBalance = await ep.balanceOf(AMBIRE_PAYMASTER);
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
export const failedPaymasters = new FailedPaymasters();
//# sourceMappingURL=FailedPaymasters.js.map