/* eslint-disable @typescript-eslint/no-floating-promises */

import { Interface, parseEther, toBeHex } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { getAccountsInfo } from '../../../test/helpers'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { dedicatedToOneSAPriv, Key } from '../../interfaces/keystore'
import { getSmartAccount } from '../../libs/account/account'
import { AccountOp, getSignableCalls } from '../../libs/accountOp/accountOp'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import {
  getDummyEntryPointSig,
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation
} from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'
import { Bundler } from './bundler'

const to = '0x706431177041C87BEb1C25Fa29b92057Cb3c7089'

const addrWithDeploySignature = '0x52C37FD54BD02E9240e8558e28b11e0Dc22d8e85'
const optimism = networks.find((net) => net.id === 'optimism')!

const smartAccDeployed: Account = {
  addr: '0xcb2dF90Fb6b22A87Ce22A0D36f2EcA8ED1DD1A8b',
  initialPrivileges: [
    [
      '0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  creation: {
    factoryAddr: '0x681C1Fd13E45E7C3bfb6288Fd39c0cA552d92561',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027ff33cc417366b7e38d2706a67ab46f85465661c28b864b521441180d15df82251553d602d80604d3d3981f3363d3d373d3d3d363d7372d91da2b0c316d030e1ed840b80c9cd9ae445b65af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  associatedKeys: ['0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb']
}

const mantle = {
  id: 'mantle',
  name: 'mantle',
  nativeAssetSymbol: 'MNT',
  rpcUrls: ['https://mantle-rpc.publicnode.com'],
  rpcNoStateOverride: false,
  chainId: 5000n,
  explorerUrl: 'https://explorer.mantle.xyz',
  erc4337: {
    enabled: true,
    hasPaymaster: false
  },
  unstoppableDomainsChain: 'ERC20',
  isSAEnabled: true,
  areContractsDeployed: true,
  hasRelayer: false,
  hasDebugTraceCall: false,
  platformId: 'mantle',
  nativeAssetId: 'mantle',
  hasSingleton: true,
  features: [],
  feeOptions: {
    is1559: true
  }
}

describe('Bundler tests', () => {
  // describe('Basic tests', () => {
  //   test('should check if the network is supported by the bundler', async () => {
  //     // it supports mantle
  //     const mantleShouldBeSupported = await Bundler.isNetworkSupported(5000n)
  //     expect(mantleShouldBeSupported).toBe(true)
  //     // it doesn't support filecoin
  //     const filecoinShouldNotBeSupported = await Bundler.isNetworkSupported(134n)
  //     expect(filecoinShouldNotBeSupported).toBe(false)
  //   })
  // })

  // describe('Estimation tests: optimism, undeployed account', () => {
  //   test('should estimate a deploy userOp', async () => {
  //     const privs = [
  //       {
  //         addr: addrWithDeploySignature,
  //         hash: dedicatedToOneSAPriv
  //       }
  //     ]
  //     const smartAcc = await getSmartAccount(privs)

  //     const opOptimism: AccountOp = {
  //       accountAddr: smartAcc.addr,
  //       signingKeyAddr: smartAcc.associatedKeys[0],
  //       signingKeyType: null,
  //       gasLimit: null,
  //       gasFeePayment: null,
  //       networkId: optimism.id,
  //       nonce: 0n,
  //       signature: '0x',
  //       calls: [
  //         // native passes even though native balance is below 10
  //         { to, value: parseEther('10'), data: '0x' }
  //       ],
  //       accountOpToExecuteBefore: null
  //     }
  //     const usedNetworks = [optimism]
  //     const providers = {
  //       [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
  //     }
  //     const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
  //     const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
  //     const userOp = getUserOperation(
  //       smartAcc,
  //       accountState,
  //       opOptimism,
  //       '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b01'
  //     )

  //     const ambireInterface = new Interface(AmbireAccount.abi)
  //     userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
  //       getSignableCalls(opOptimism)
  //     ])
  //     const paymasterAndData = getPaymasterDataForEstimate()
  //     userOp.paymaster = paymasterAndData.paymaster
  //     userOp.paymasterVerificationGasLimit = toBeHex(0)
  //     userOp.paymasterPostOpGasLimit = toBeHex(0)
  //     userOp.paymasterData = paymasterAndData.paymasterData
  //     userOp.nonce = toBeHex(0)
  //     userOp.signature = getSigForCalculations()

  //     const bundlerEstimate = await Bundler.estimate(userOp, optimism)
  //     expect(bundlerEstimate).toHaveProperty('preVerificationGas')
  //     expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
  //     expect(bundlerEstimate).toHaveProperty('callGasLimit')
  //     expect(bundlerEstimate).toHaveProperty('paymasterVerificationGasLimit')
  //     expect(bundlerEstimate).toHaveProperty('paymasterPostOpGasLimit')
  //   })
  //   test('should return an error that the call is not from the entry point', async () => {
  //     expect.assertions(1)

  //     const privs = [
  //       {
  //         addr: addrWithDeploySignature,
  //         hash: dedicatedToOneSAPriv
  //       }
  //     ]
  //     const smartAcc = await getSmartAccount(privs)
  //     const opOptimism: AccountOp = {
  //       accountAddr: smartAcc.addr,
  //       signingKeyAddr: smartAcc.associatedKeys[0],
  //       signingKeyType: null,
  //       gasLimit: null,
  //       gasFeePayment: null,
  //       networkId: optimism.id,
  //       nonce: 0n,
  //       signature: '0x',
  //       calls: [{ to, value: parseEther('10'), data: '0x' }],
  //       accountOpToExecuteBefore: null
  //     }
  //     const usedNetworks = [optimism]
  //     const providers = {
  //       [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
  //     }
  //     const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
  //     const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
  //     const userOp = getUserOperation(
  //       smartAcc,
  //       accountState,
  //       opOptimism,
  //       '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b01'
  //     )
  //     const ambireInterface = new Interface(AmbireAccount.abi)
  //     userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
  //       getSignableCalls(opOptimism)
  //     ])
  //     const paymasterAndData = getPaymasterDataForEstimate()
  //     userOp.paymaster = paymasterAndData.paymaster
  //     userOp.paymasterData = paymasterAndData.paymasterData
  //     userOp.nonce = toBeHex(0)
  //     userOp.signature = getSigForCalculations()

  //     // override the factoryData so it deploy without entry point privs
  //     const factoryInterface = new Interface(AmbireAccountFactory.abi)
  //     userOp.factoryData = factoryInterface.encodeFunctionData('deploy', [
  //       smartAcc.creation!.bytecode,
  //       smartAcc.creation!.salt
  //     ])

  //     try {
  //       await Bundler.estimate(userOp, optimism)
  //     } catch (e: any) {
  //       expect(e.error.message.indexOf('validateUserOp: not from entryPoint')).not.toBe(-1)
  //     }
  //   })
  //   test('should revert because we are trying to send USDT and the account does not have USDT', async () => {
  //     expect.assertions(1)

  //     const privs = [
  //       {
  //         addr: addrWithDeploySignature,
  //         hash: dedicatedToOneSAPriv
  //       }
  //     ]
  //     const smartAcc = await getSmartAccount(privs)
  //     const ERC20Interface = new Interface(ERC20.abi)
  //     const opOptimism: AccountOp = {
  //       accountAddr: smartAcc.addr,
  //       signingKeyAddr: smartAcc.associatedKeys[0],
  //       signingKeyType: null,
  //       gasLimit: null,
  //       gasFeePayment: null,
  //       networkId: optimism.id,
  //       nonce: 0n,
  //       signature: '0x',
  //       calls: [
  //         // native, passes even though no eth
  //         { to, value: parseEther('10'), data: '0x' },
  //         // USDT, reverts
  //         {
  //           to: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  //           value: 0n,
  //           data: ERC20Interface.encodeFunctionData('transfer', [FEE_COLLECTOR, 10])
  //         }
  //       ],
  //       accountOpToExecuteBefore: null
  //     }
  //     const usedNetworks = [optimism]
  //     const providers = {
  //       [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
  //     }
  //     const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
  //     const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
  //     const userOp = getUserOperation(
  //       smartAcc,
  //       accountState,
  //       opOptimism,
  //       '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b01'
  //     )

  //     const ambireInterface = new Interface(AmbireAccount.abi)
  //     userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
  //       getSignableCalls(opOptimism)
  //     ])
  //     const paymasterAndData = getPaymasterDataForEstimate()
  //     userOp.paymaster = paymasterAndData.paymaster
  //     userOp.paymasterData = paymasterAndData.paymasterData
  //     userOp.nonce = toBeHex(0)
  //     userOp.signature = getSigForCalculations()

  //     try {
  //       await Bundler.estimate(userOp, optimism)
  //     } catch (e: any) {
  //       const buffer = Buffer.from(
  //         e.error.message.substring(e.error.message.indexOf('0x') + 2),
  //         'hex'
  //       ).toString()
  //       expect(buffer.indexOf('transfer amount exceeds balance')).not.toBe(-1)
  //     }
  //   })
  // })

  // describe('Estimation tests: optimism, deployed account', () => {
  //   test('should estimate successfully with and without state override', async () => {
  //     const opOptimism: AccountOp = {
  //       accountAddr: smartAccDeployed.addr,
  //       signingKeyAddr: smartAccDeployed.associatedKeys[0],
  //       signingKeyType: null,
  //       gasLimit: null,
  //       gasFeePayment: null,
  //       networkId: 'optimism',
  //       nonce: 0n,
  //       signature: '0x',
  //       calls: [{ to, value: parseEther('1'), data: '0x' }],
  //       accountOpToExecuteBefore: null
  //     }
  //     const usedNetworks = [optimism]
  //     const providers = {
  //       [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
  //     }
  //     const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAccDeployed])
  //     const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
  //     const userOp = getUserOperation(smartAccDeployed, accountState, opOptimism)
  //     const ambireInterface = new Interface(AmbireAccount.abi)
  //     userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
  //       getSignableCalls(opOptimism)
  //     ])
  //     const paymasterAndData = getPaymasterDataForEstimate()
  //     userOp.paymaster = paymasterAndData.paymaster
  //     userOp.paymasterData = paymasterAndData.paymasterData
  //     userOp.signature = getSigForCalculations()
  //     const bundlerEstimate = await Bundler.estimate(userOp, optimism)
  //     expect(bundlerEstimate).toHaveProperty('preVerificationGas')
  //     expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
  //     expect(bundlerEstimate).toHaveProperty('callGasLimit')
  //     expect(bundlerEstimate).toHaveProperty('paymasterVerificationGasLimit')
  //     expect(bundlerEstimate).toHaveProperty('paymasterPostOpGasLimit')

  //     const estimateWithStateOverride = await Bundler.estimate(userOp, optimism, true)
  //     expect(estimateWithStateOverride).toHaveProperty('preVerificationGas')
  //     expect(estimateWithStateOverride).toHaveProperty('verificationGasLimit')
  //     expect(estimateWithStateOverride).toHaveProperty('callGasLimit')
  //     expect(estimateWithStateOverride).toHaveProperty('paymasterVerificationGasLimit')
  //     expect(estimateWithStateOverride).toHaveProperty('paymasterPostOpGasLimit')
  //   })
  //   test("should revert as we're trying to send USDT and the account does not have USDT", async () => {
  //     expect.assertions(1)
  //     const ERC20Interface = new Interface(ERC20.abi)
  //     const opOptimism: AccountOp = {
  //       accountAddr: smartAccDeployed.addr,
  //       signingKeyAddr: smartAccDeployed.associatedKeys[0],
  //       signingKeyType: null,
  //       gasLimit: null,
  //       gasFeePayment: null,
  //       networkId: optimism.id,
  //       nonce: 0n,
  //       signature: '0x',
  //       calls: [
  //         // native, passes even though no eth
  //         { to, value: parseEther('1'), data: '0x' },
  //         // USDT, reverts
  //         {
  //           to: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  //           value: 0n,
  //           data: ERC20Interface.encodeFunctionData('transfer', [FEE_COLLECTOR, 10])
  //         }
  //       ],
  //       accountOpToExecuteBefore: null
  //     }
  //     const usedNetworks = [optimism]
  //     const providers = {
  //       [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
  //     }
  //     const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAccDeployed])
  //     const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
  //     const userOp = getUserOperation(smartAccDeployed, accountState, opOptimism)
  //     const ambireInterface = new Interface(AmbireAccount.abi)
  //     userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
  //       getSignableCalls(opOptimism)
  //     ])
  //     const paymasterAndData = getPaymasterDataForEstimate()
  //     userOp.paymaster = paymasterAndData.paymaster
  //     userOp.paymasterData = paymasterAndData.paymasterData
  //     userOp.signature = getSigForCalculations()

  //     try {
  //       await Bundler.estimate(userOp, optimism)
  //     } catch (e: any) {
  //       const buffer = Buffer.from(
  //         e.error.message.substring(e.error.message.indexOf('0x') + 2),
  //         'hex'
  //       ).toString()
  //       expect(buffer.indexOf('transfer amount exceeds balance')).not.toBe(-1)
  //     }
  //   })
  //   test('should revert an estimate with an invalid signature', async () => {
  //     expect.assertions(3)

  //     const opOptimism: AccountOp = {
  //       accountAddr: smartAccDeployed.addr,
  //       signingKeyAddr: smartAccDeployed.associatedKeys[0],
  //       signingKeyType: null,
  //       gasLimit: null,
  //       gasFeePayment: null,
  //       networkId: 'optimism',
  //       nonce: 0n,
  //       signature: '0x',
  //       calls: [{ to, value: parseEther('1'), data: '0x' }],
  //       accountOpToExecuteBefore: null
  //     }
  //     const usedNetworks = [optimism]
  //     const providers = {
  //       [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
  //     }
  //     const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAccDeployed])
  //     const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
  //     const userOp = getUserOperation(smartAccDeployed, accountState, opOptimism)
  //     const ambireInterface = new Interface(AmbireAccount.abi)
  //     userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
  //       getSignableCalls(opOptimism)
  //     ])
  //     const paymasterAndData = getPaymasterDataForEstimate()
  //     userOp.paymaster = paymasterAndData.paymaster
  //     userOp.paymasterData = paymasterAndData.paymasterData

  //     await Bundler.estimate(userOp, optimism).catch((e) => {
  //       expect(e).toHaveProperty('error')
  //       expect(e.error).toHaveProperty('message')
  //       expect(e.error.message.includes('SV_SIGLEN')).toBe(true)
  //     })
  //   })
  // })

  describe('Estimation tests: mantle, undeployed account', () => {
    test('should estimate a deploy userOp', async () => {
      const privs = [
        {
          addr: addrWithDeploySignature,
          hash: dedicatedToOneSAPriv
        }
      ]
      const smartAcc = await getSmartAccount(privs)

      const opMantle: AccountOp = {
        accountAddr: smartAcc.addr,
        signingKeyAddr: smartAcc.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: mantle.id,
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: 1n, data: '0x' }],
        accountOpToExecuteBefore: null
      }
      const usedNetworks = [mantle]
      const providers = {
        [mantle.id]: getRpcProvider(mantle.rpcUrls, mantle.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
      const accountState = accountStates[opMantle.accountAddr][opMantle.networkId]

      const privKey = process.env.METAMASK_PK
      const key: Key = {
        addr: addrWithDeploySignature,
        type: 'internal',
        dedicatedToOneSA: true,
        isExternallyStored: false,
        meta: null
      }
      const signer = new KeystoreSigner(key, privKey)
      const sig = await getDummyEntryPointSig(smartAcc.addr, mantle.chainId, signer)
      console.log(sig)

      const userOp = getUserOperation(smartAcc, accountState, opMantle, sig)

      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opMantle)
      ])
      userOp.nonce = toBeHex(0)
      userOp.signature = getSigForCalculations()

      const bundlerEstimate = await Bundler.estimate(userOp, mantle)
      expect(bundlerEstimate).toHaveProperty('preVerificationGas')
      expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('callGasLimit')
      expect(bundlerEstimate).toHaveProperty('paymasterVerificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('paymasterPostOpGasLimit')
    })
    // test('should return an error that the call is not from the entry point', async () => {
    //   expect.assertions(1)

    //   const privs = [
    //     {
    //       addr: addrWithDeploySignature,
    //       hash: dedicatedToOneSAPriv
    //     }
    //   ]
    //   const smartAcc = await getSmartAccount(privs)
    //   const opOptimism: AccountOp = {
    //     accountAddr: smartAcc.addr,
    //     signingKeyAddr: smartAcc.associatedKeys[0],
    //     signingKeyType: null,
    //     gasLimit: null,
    //     gasFeePayment: null,
    //     networkId: optimism.id,
    //     nonce: 0n,
    //     signature: '0x',
    //     calls: [{ to, value: parseEther('10'), data: '0x' }],
    //     accountOpToExecuteBefore: null
    //   }
    //   const usedNetworks = [optimism]
    //   const providers = {
    //     [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
    //   }
    //   const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
    //   const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
    //   const userOp = getUserOperation(
    //     smartAcc,
    //     accountState,
    //     opOptimism,
    //     '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b01'
    //   )
    //   const ambireInterface = new Interface(AmbireAccount.abi)
    //   userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
    //     getSignableCalls(opOptimism)
    //   ])
    //   const paymasterAndData = getPaymasterDataForEstimate()
    //   userOp.paymaster = paymasterAndData.paymaster
    //   userOp.paymasterData = paymasterAndData.paymasterData
    //   userOp.nonce = toBeHex(0)
    //   userOp.signature = getSigForCalculations()

    //   // override the factoryData so it deploy without entry point privs
    //   const factoryInterface = new Interface(AmbireAccountFactory.abi)
    //   userOp.factoryData = factoryInterface.encodeFunctionData('deploy', [
    //     smartAcc.creation!.bytecode,
    //     smartAcc.creation!.salt
    //   ])

    //   try {
    //     await Bundler.estimate(userOp, optimism)
    //   } catch (e: any) {
    //     expect(e.error.message.indexOf('validateUserOp: not from entryPoint')).not.toBe(-1)
    //   }
    // })
    // test('should revert because we are trying to send USDT and the account does not have USDT', async () => {
    //   expect.assertions(1)

    //   const privs = [
    //     {
    //       addr: addrWithDeploySignature,
    //       hash: dedicatedToOneSAPriv
    //     }
    //   ]
    //   const smartAcc = await getSmartAccount(privs)
    //   const ERC20Interface = new Interface(ERC20.abi)
    //   const opOptimism: AccountOp = {
    //     accountAddr: smartAcc.addr,
    //     signingKeyAddr: smartAcc.associatedKeys[0],
    //     signingKeyType: null,
    //     gasLimit: null,
    //     gasFeePayment: null,
    //     networkId: optimism.id,
    //     nonce: 0n,
    //     signature: '0x',
    //     calls: [
    //       // native, passes even though no eth
    //       { to, value: parseEther('10'), data: '0x' },
    //       // USDT, reverts
    //       {
    //         to: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    //         value: 0n,
    //         data: ERC20Interface.encodeFunctionData('transfer', [FEE_COLLECTOR, 10])
    //       }
    //     ],
    //     accountOpToExecuteBefore: null
    //   }
    //   const usedNetworks = [optimism]
    //   const providers = {
    //     [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
    //   }
    //   const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
    //   const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
    //   const userOp = getUserOperation(
    //     smartAcc,
    //     accountState,
    //     opOptimism,
    //     '0x126eabb5d01aa47fdeae4797ae5ae63d3279d12ccfddd0a09ad38a63c4140ab57354a2ef555c0c411b20644627b0f23b1927cec6401ca228b65046b620337dcf1b01'
    //   )

    //   const ambireInterface = new Interface(AmbireAccount.abi)
    //   userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
    //     getSignableCalls(opOptimism)
    //   ])
    //   const paymasterAndData = getPaymasterDataForEstimate()
    //   userOp.paymaster = paymasterAndData.paymaster
    //   userOp.paymasterData = paymasterAndData.paymasterData
    //   userOp.nonce = toBeHex(0)
    //   userOp.signature = getSigForCalculations()

    //   try {
    //     await Bundler.estimate(userOp, optimism)
    //   } catch (e: any) {
    //     const buffer = Buffer.from(
    //       e.error.message.substring(e.error.message.indexOf('0x') + 2),
    //       'hex'
    //     ).toString()
    //     expect(buffer.indexOf('transfer amount exceeds balance')).not.toBe(-1)
    //   }
    // })
  })
})
