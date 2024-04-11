/* eslint-disable @typescript-eslint/no-floating-promises */

import { JsonRpcProvider, parseEther } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { optyNotDeployed } from '../../../test/config'
import { getAccountsInfo } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { AccountOp } from '../accountOp/accountOp'
import { bundlerEstimate } from './estimateBundler'

const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

describe('Bundler estimation tests', () => {
  describe('Estimation tests: optimism', () => {
    test('should estimate an userOp for an undeployed account', async () => {
      const opOptimism: AccountOp = {
        accountAddr: optyNotDeployed.addr,
        signingKeyAddr: optyNotDeployed.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'optimism',
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: parseEther('10000000'), data: '0x' }],
        accountOpToExecuteBefore: null
      }
      const optimism = networks.find((net) => net.id === 'optimism')!
      const usedNetworks = [optimism]
      const providers = {
        [optimism.id]: new JsonRpcProvider(optimism.rpcUrl)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [optyNotDeployed])
      const feeTokens = [
        {
          address: '0x0000000000000000000000000000000000000000',
          isGasTank: false,
          amount: 1n,
          symbol: 'ETH'
        },
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          isGasTank: false,
          amount: 1n,
          symbol: 'USDT'
        },
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          isGasTank: false,
          amount: 1n,
          symbol: 'USDC'
        }
      ]
      const result = await bundlerEstimate(
        optyNotDeployed,
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