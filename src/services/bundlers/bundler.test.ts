/* eslint-disable @typescript-eslint/no-floating-promises */

import { concat, hexlify, Interface, parseEther, toBeHex } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { arbNotDeployed, optyDeployed } from '../../../test/config'
import { getAccountsInfo } from '../../../test/helpers'
import { AMBIRE_ACCOUNT_FACTORY, PROXY_NO_REVERTS } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { dedicatedToOneSAPriv } from '../../interfaces/keystore'
import { AccountOp, getSignableCalls } from '../../libs/accountOp/accountOp'
import { getProxyDeployBytecode } from '../../libs/proxyDeploy/deploy'
import { getAmbireAccountAddress } from '../../libs/proxyDeploy/getAmbireAddressTwo'
import {
  getOneTimeNonce,
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation
} from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'
import { Bundler } from './bundler'

const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

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

  describe('Estimation tests: arbitrum', () => {
    // test('should estimate an userOp for an undeployed account', async () => {
    //   const opArbitrum: AccountOp = {
    //     accountAddr: arbNotDeployed.addr,
    //     signingKeyAddr: arbNotDeployed.associatedKeys[0],
    //     signingKeyType: null,
    //     gasLimit: null,
    //     gasFeePayment: null,
    //     networkId: 'arbitrum',
    //     nonce: 0n,
    //     signature: '0x',
    //     calls: [{ to, value: parseEther('10000000'), data: '0x' }],
    //     accountOpToExecuteBefore: null
    //   }
    //   const arbitrum = networks.find((net) => net.id === 'arbitrum')!
    //   const usedNetworks = [arbitrum]
    //   const providers = {
    //     [arbitrum.id]: getRpcProvider(arbitrum.rpcUrls, arbitrum.chainId)
    //   }
    //   const accountStates = await getAccountsInfo(usedNetworks, providers, [arbNotDeployed])
    //   const accountState = accountStates[opArbitrum.accountAddr][opArbitrum.networkId]
    //   const userOp = getUserOperation(arbNotDeployed, accountState, opArbitrum)
    //   const factoryInterface = new Interface(AmbireAccountFactory.abi)
    //   const bytecode = getProxyDeployBytecode(
    //     PROXY_NO_REVERTS,
    //     [{ addr: AMBIRE_ACCOUNT_FACTORY, hash: dedicatedToOneSAPriv }],
    //     { privSlot: 0 }
    //   )
    //   userOp.sender = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode)
    //   userOp.factory = AMBIRE_ACCOUNT_FACTORY
    //   userOp.factoryData = factoryInterface.encodeFunctionData('deploy', [bytecode, toBeHex(0, 32)])
    //   const ambireInterface = new Interface(AmbireAccount.abi)
    //   userOp.callData = ambireInterface.encodeFunctionData('executeMultiple', [
    //     [[getSignableCalls(opArbitrum), getSigForCalculations()]]
    //   ])
    //   const paymasterAndData = getPaymasterDataForEstimate()
    //   userOp.paymaster = paymasterAndData.paymaster
    //   userOp.paymasterVerificationGasLimit = paymasterAndData.paymasterVerificationGasLimit
    //   userOp.paymasterPostOpGasLimit = paymasterAndData.paymasterPostOpGasLimit
    //   userOp.paymasterData = paymasterAndData.paymasterData
    //   userOp.nonce = getOneTimeNonce(userOp)

    //   const bundlerEstimate = await Bundler.estimate(userOp, arbitrum)
    //   console.log(bundlerEstimate)
    //   expect(bundlerEstimate).toHaveProperty('preVerificationGas')
    //   expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
    //   expect(bundlerEstimate).toHaveProperty('callGasLimit')
    // })

    // TODO: mark this as optimism test
    test('should estimate an userOp for a deployed account', async () => {
      const opOptimism: AccountOp = {
        accountAddr: optyDeployed.addr,
        signingKeyAddr: optyDeployed.associatedKeys[0],
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
      const accountStates = await getAccountsInfo(usedNetworks, providers, [optyDeployed])
      const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
      const userOp = getUserOperation(optyDeployed, accountState, opOptimism)
      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opOptimism)
      ])
      const paymasterAndData = getPaymasterDataForEstimate()
      userOp.paymaster = paymasterAndData.paymaster
      userOp.paymasterVerificationGasLimit = paymasterAndData.paymasterVerificationGasLimit
      userOp.paymasterPostOpGasLimit = paymasterAndData.paymasterPostOpGasLimit
      userOp.paymasterData = paymasterAndData.paymasterData
      userOp.signature = getSigForCalculations()

      const bundlerEstimate = await Bundler.estimate(userOp, arbitrum)
      expect(bundlerEstimate).toHaveProperty('preVerificationGas')
      expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('callGasLimit')
    })
    // test('should revert an estimate with an invalid signature', async () => {
    //   const opArbitrum: AccountOp = {
    //     accountAddr: optyDeployed.addr,
    //     signingKeyAddr: optyDeployed.associatedKeys[0],
    //     signingKeyType: null,
    //     gasLimit: null,
    //     gasFeePayment: null,
    //     networkId: 'arbitrum',
    //     nonce: 0n,
    //     signature: '0x',
    //     calls: [{ to, value: parseEther('10000000'), data: '0x' }],
    //     accountOpToExecuteBefore: null
    //   }
    //   const arbitrum = networks.find((net) => net.id === 'arbitrum')!
    //   const usedNetworks = [arbitrum]
    //   const providers = {
    //     [arbitrum.id]: getRpcProvider(arbitrum.rpcUrls, arbitrum.chainId)
    //   }
    //   const accountStates = await getAccountsInfo(usedNetworks, providers, [optyDeployed])
    //   const accountState = accountStates[opArbitrum.accountAddr][opArbitrum.networkId]
    //   const userOp = getUserOperation(optyDeployed, accountState, opArbitrum)
    //   const ambireInterface = new Interface(AmbireAccount.abi)
    //   userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
    //     getSignableCalls(opArbitrum)
    //   ])
    //   userOp.paymasterAndData = getPaymasterDataForEstimate()

    //   await Bundler.estimate(userOp, arbitrum).catch((e) => {
    //     expect(e).toHaveProperty('error')
    //     expect(e.error).toHaveProperty('message')
    //     expect(e.error.message.includes('SV_SIGLEN')).toBe(true)
    //   })
    // })
  })
})
