/* eslint-disable @typescript-eslint/no-floating-promises */

import { Interface, JsonRpcProvider, parseEther } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { optyNotDeployed } from '../../../test/config'
import { getAccountsInfo } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { getSpoof } from '../../libs/account/account'
import { AccountOp, getSignableCalls } from '../../libs/accountOp/accountOp'
import {
  getOneTimeNonce,
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation
} from '../../libs/userOperation/userOperation'
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
    test('should estimate an userOp for an undeployed account with initCode 0x', async () => {
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
      const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
      const userOp = getUserOperation(optyNotDeployed, accountState, opOptimism)
      // just use af fake paymasterAndData, no need to be the spoof exactly
      userOp.paymasterAndData = getPaymasterDataForEstimate()
      // remove the init code as we're doing a state override in estimate
      userOp.initCode = '0x'
      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opOptimism)
      ])
      userOp.signature = getSigForCalculations()
      const bundlerEstimate = await Bundler.estimate(userOp, optimism, false)
      expect(bundlerEstimate).toHaveProperty('preVerificationGas')
      expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('callGasLimit')
    })
  })
  test('should estimate an userOp for an undeployed account with real initCode and empty executeMultiple', async () => {
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
    const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
    const userOp = getUserOperation(optyNotDeployed, accountState, opOptimism)
    // just use af fake paymasterAndData, no need to be the spoof exactly
    const ambireInterface = new Interface(AmbireAccount.abi)
    userOp.callData = ambireInterface.encodeFunctionData('executeMultiple', [[]])
    userOp.paymasterAndData = getPaymasterDataForEstimate()
    userOp.nonce = getOneTimeNonce(userOp)

    const bundlerEstimate = await Bundler.estimate(userOp, optimism, false)
    expect(bundlerEstimate).toHaveProperty('preVerificationGas')
    expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
    expect(bundlerEstimate).toHaveProperty('callGasLimit')
  })
  test('should revert because a wrongly formatted signature is passed', async () => {
    expect.assertions(2)

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
    const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
    const userOp = getUserOperation(optyNotDeployed, accountState, opOptimism)
    // just use af fake paymasterAndData, no need to be the spoof exactly
    userOp.paymasterAndData = getPaymasterDataForEstimate()
    // remove the init code as we're doing a state override in estimate
    userOp.initCode = '0x'
    const ambireInterface = new Interface(AmbireAccount.abi)
    userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
      getSignableCalls(opOptimism)
    ])
    // this signature is invalid and estimation will fail because of it
    userOp.signature = getSpoof(optyNotDeployed)

    await Bundler.estimate(userOp, optimism, false).catch((e) => {
      expect(e).toHaveProperty('error')
      expect(e.error).toHaveProperty('message')
    })
  })
})
