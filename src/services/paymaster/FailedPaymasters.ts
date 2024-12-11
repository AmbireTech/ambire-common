/* eslint-disable no-console */

/*
 * a singleton for recording failed paymaster requests
 */
import { Contract } from 'ethers'

import entryPointAbi from '../../../contracts/compiled/EntryPoint.json'
import { AMBIRE_PAYMASTER, ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'

// so the app can fallback to a standard Paymaster if a sponsorship fails
export class FailedPaymasters {
  failedSponsorshipIds: number[] = []

  insufficientFundsNetworks: {
    [chainId: number]: {
      lastSeenBalance: bigint
    }
  } = {}

  addFailedSponsorship(id: number) {
    this.failedSponsorshipIds.push(id)
  }

  hasFailedSponsorship(id: number): boolean {
    return this.failedSponsorshipIds.includes(id)
  }

  async addInsufficientFunds(provider: RPCProvider, network: Network) {
    let paymasterBalance = 0n
    try {
      const ep = new Contract(ERC_4337_ENTRYPOINT, entryPointAbi, provider)
      paymasterBalance = await ep.balanceOf(AMBIRE_PAYMASTER)
    } catch (e) {
      console.log('failed to retrieve the balance of the paymaster')
      console.error(e)
    }

    this.insufficientFundsNetworks[Number(network.chainId)] = {
      lastSeenBalance: paymasterBalance
    }
  }

  hasInsufficientFunds(network: Network) {
    return !!this.insufficientFundsNetworks[Number(network.chainId)]
  }

  removeInsufficientFunds(network: Network) {
    delete this.insufficientFundsNetworks[Number(network.chainId)]
  }
}

export const failedPaymasters = new FailedPaymasters()
