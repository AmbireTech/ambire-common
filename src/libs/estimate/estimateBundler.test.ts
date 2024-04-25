/* eslint-disable @typescript-eslint/no-floating-promises */

import { parseEther } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { arbNotDeployed } from '../../../test/config'
import { getAccountsInfo } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { getRpcProvider } from '../../services/provider'
import { AccountOp } from '../accountOp/accountOp'
import { bundlerEstimate } from './estimateBundler'

const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

describe('Bundler estimation tests', () => {
  describe('Estimation tests: arbitrum', () => {
    test('should estimate an userOp for an undeployed account', async () => {
      const opArbitrum: AccountOp = {
        accountAddr: arbNotDeployed.addr,
        signingKeyAddr: arbNotDeployed.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'arbitrum',
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: parseEther('10000000'), data: '0x' }],
        accountOpToExecuteBefore: null
      }
      const arbitrum = networks.find((net) => net.id === 'arbitrum')!
      const usedNetworks = [arbitrum]
      const providers = {
        [arbitrum.id]: getRpcProvider(arbitrum.rpcUrls, arbitrum.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [arbNotDeployed])
      const feeTokens = [
        {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'ETH',
          networkId: 'arbitrum',
          decimals: 18,
          priceIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        },
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          amount: 1n,
          symbol: 'USDT',
          networkId: 'arbitrum',
          decimals: 18,
          priceIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        },
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: 1n,
          symbol: 'USDC',
          networkId: 'arbitrum',
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
        arbNotDeployed,
        accountStates,
        opArbitrum,
        arbitrum,
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
