/* eslint-disable @typescript-eslint/no-floating-promises */

import { parseEther } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { getAccountsInfo } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { dedicatedToOneSAPriv } from '../../interfaces/keystore'
import { getRpcProvider } from '../../services/provider'
import { getSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { bundlerEstimate } from './estimateBundler'

const to = '0x06564FA10c67427a187f90703fD094054f8F0408'

const addrWithDeploySignature = '0x52C37FD54BD02E9240e8558e28b11e0Dc22d8e85'
const optimism = networks.find((net) => net.id === 'optimism')!

const smartAccDeployed: Account = {
  addr: '0x8E5F6c1F0b134657A546932C3eC9169E1633a39b',
  initialPrivileges: [
    [
      '0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  creation: {
    factoryAddr: AMBIRE_ACCOUNT_FACTORY,
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027ff33cc417366b7e38d2706a67ab46f85465661c28b864b521441180d15df82251553d602d80604d3d3981f3363d3d373d3d3d363d731cde6a53e9a411eaaf9d11e3e8c653a3e379d5355af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  associatedKeys: ['0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb'],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x8E5F6c1F0b134657A546932C3eC9169E1633a39b'
  }
}

describe('Bundler estimation tests', () => {
  describe('Estimation tests: optimism, undeployed', () => {
    test('should estimate an userOp', async () => {
      const privs = [
        {
          addr: addrWithDeploySignature,
          hash: dedicatedToOneSAPriv
        }
      ]
      const smartAcc = await getSmartAccount(privs, [])
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
        accountOpToExecuteBefore: null,
        meta: {
          entryPointAuthorization:
            '0x05404ea5dfa13ddd921cda3f587af6927cc127ee174b57c9891491bfc1f0d3d005f649f8a1fc9147405f064507bae08816638cfc441c4d0dc4eb6640e16621991b01'
        }
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
      const result = await bundlerEstimate(smartAcc, accountStates, opOptimism, optimism, feeTokens)

      expect(result).toHaveProperty('erc4337GasLimits')
      expect(BigInt(result.erc4337GasLimits!.callGasLimit)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.preVerificationGas)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.verificationGasLimit)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.paymasterPostOpGasLimit)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.paymasterVerificationGasLimit)).toBeGreaterThan(0n)

      // the bundler estimation does not return the fee payment options anymore
      expect(result.feePaymentOptions.length).toBe(0)
    })
  })

  describe('Estimation tests: optimism, deployed', () => {
    test('should estimate an userOp', async () => {
      const opOptimism: AccountOp = {
        accountAddr: smartAccDeployed.addr,
        signingKeyAddr: smartAccDeployed.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: optimism.id,
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: parseEther('1'), data: '0x' }],
        accountOpToExecuteBefore: null
      }
      const usedNetworks = [optimism]
      const providers = {
        [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAccDeployed])

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
        smartAccDeployed,
        accountStates,
        opOptimism,
        optimism,
        feeTokens
      )

      expect(result).toHaveProperty('erc4337GasLimits')
      expect(BigInt(result.erc4337GasLimits!.callGasLimit)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.preVerificationGas)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.verificationGasLimit)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.paymasterPostOpGasLimit)).toBeGreaterThan(0n)
      expect(BigInt(result.erc4337GasLimits!.paymasterVerificationGasLimit)).toBeGreaterThan(0n)

      // the bundler estimation does not return the fee payment options anymore
      expect(result.feePaymentOptions.length).toBe(0)
    })
  })
})
