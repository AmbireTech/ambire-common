/* eslint-disable @typescript-eslint/no-floating-promises */

import { concat, hexlify, Interface, parseEther, toBeHex } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import { optyDeployed, optyNotDeployed } from '../../../test/config'
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
  describe('Basic tests', () => {
    test('should check if the network is supported by the bundler', async () => {
      // it supports mantle
      const mantleShouldBeSupported = await Bundler.isNetworkSupported(5000n)
      expect(mantleShouldBeSupported).toBe(true)
      // it doesn't support filecoin
      const filecoinShouldNotBeSupported = await Bundler.isNetworkSupported(134n)
      expect(filecoinShouldNotBeSupported).toBe(false)
    })
  })

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
        [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [optyNotDeployed])
      const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
      const userOp = getUserOperation(optyNotDeployed, accountState, opOptimism)
      const factoryInterface = new Interface(AmbireAccountFactory.abi)
      const bytecode = getProxyDeployBytecode(
        PROXY_NO_REVERTS,
        [{ addr: AMBIRE_ACCOUNT_FACTORY, hash: dedicatedToOneSAPriv }],
        { privSlot: 0 }
      )
      userOp.sender = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode)
      userOp.initCode = hexlify(
        concat([
          AMBIRE_ACCOUNT_FACTORY,
          factoryInterface.encodeFunctionData('deploy', [bytecode, toBeHex(0, 32)])
        ])
      )
      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeMultiple', [
        [[getSignableCalls(opOptimism), getSigForCalculations()]]
      ])
      userOp.paymasterAndData = getPaymasterDataForEstimate()
      userOp.nonce = getOneTimeNonce(userOp)

      const bundlerEstimate = await Bundler.estimate(userOp, optimism)
      expect(bundlerEstimate).toHaveProperty('preVerificationGas')
      expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('callGasLimit')
    })
    test('should estimate an userOp for a deployed account', async () => {
      const opOptimism: AccountOp = {
        accountAddr: optyDeployed.addr,
        signingKeyAddr: optyDeployed.associatedKeys[0],
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
        [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [optyDeployed])
      const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
      const userOp = getUserOperation(optyDeployed, accountState, opOptimism)
      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opOptimism)
      ])
      userOp.paymasterAndData = getPaymasterDataForEstimate()
      userOp.signature = getSigForCalculations()

      const bundlerEstimate = await Bundler.estimate(userOp, optimism)
      expect(bundlerEstimate).toHaveProperty('preVerificationGas')
      expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('callGasLimit')
    })
    test('should revert an estimate with an invalid signature', async () => {
      const opOptimism: AccountOp = {
        accountAddr: optyDeployed.addr,
        signingKeyAddr: optyDeployed.associatedKeys[0],
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
        [optimism.id]: getRpcProvider(optimism.rpcUrls, optimism.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [optyDeployed])
      const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
      const userOp = getUserOperation(optyDeployed, accountState, opOptimism)
      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opOptimism)
      ])
      userOp.paymasterAndData = getPaymasterDataForEstimate()

      await Bundler.estimate(userOp, optimism).catch((e) => {
        expect(e).toHaveProperty('error')
        expect(e.error).toHaveProperty('message')
        expect(e.error.message.includes('SV_SIGLEN')).toBe(true)
      })
    })
  })
})
