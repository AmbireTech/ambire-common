/* eslint-disable @typescript-eslint/no-floating-promises */

// TODO<BOBBY>: DELETE THIS
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */

import { parseEther } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { arbNotDeployed } from '../../../test/config'
import { getAccountsInfo } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { dedicatedToOneSAPriv, Key, KeystoreSigner } from '../../interfaces/keystore'
import { getRpcProvider } from '../../services/provider'
import { getSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { bundlerEstimate } from './estimateBundler'

const to = '0x06564FA10c67427a187f90703fD094054f8F0408'

class LocalSigner implements KeystoreSigner {
  key: Key

  constructor(_key: Key) {
    this.key = _key
  }

  async signRawTransaction() {
    return '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b'
  }

  async signTypedData() {
    return '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b'
  }

  async signMessage() {
    return '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b'
  }
}
const localSigner = new LocalSigner({
  addr: arbNotDeployed.addr,
  type: 'internal',
  dedicatedToOneSA: true,
  meta: null,
  isExternallyStored: false
})
const addrWithDeploySignature = '0x52C37FD54BD02E9240e8558e28b11e0Dc22d8e85'
const optimism = networks.find((net) => net.id === 'optimism')!

describe('Bundler estimation tests', () => {
  describe('Estimation tests: optimism', () => {
    test('should estimate an userOp for an undeployed account', async () => {
      const privs = [
        {
          addr: addrWithDeploySignature,
          hash: dedicatedToOneSAPriv
        }
      ]
      const smartAcc = await getSmartAccount(privs)
      const opOptimism: AccountOp = {
        accountAddr: smartAcc.addr,
        signingKeyAddr: smartAcc.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: optimism.id,
        nonce: 0n,
        signature: '0x',
        calls: [
          // native passes even though native balance is below 10
          { to, value: parseEther('10'), data: '0x' }
        ],
        accountOpToExecuteBefore: null
      }
      const usedNetworks = [optimism]
      const providers = {
        [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])

      // if the user cannot pay in the fee token, it will revert
      const feeTokens = [
        {
          address: '0x0000000000000000000000000000000000000000',
          amount: 100n,
          symbol: 'ETH',
          networkId: 'optimism',
          decimals: 18,
          priceIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        }
      ]
      const result = await bundlerEstimate(
        localSigner,
        smartAcc,
        accountStates,
        opOptimism,
        optimism,
        feeTokens
      )

      expect(result).toHaveProperty('erc4337GasLimits')
      expect(BigInt(result.erc4337GasLimits!.callGasLimit)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.preVerificationGas)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.verificationGasLimit)).toBeGreaterThan(0n)

      // the bundler estimation does not return the fee payment options anymore
      expect(result.feePaymentOptions.length).toBe(0)
    })
  })
})
