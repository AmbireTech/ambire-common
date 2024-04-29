/* eslint-disable @typescript-eslint/no-floating-promises */

import {
  AbiCoder,
  concat,
  hexlify,
  Interface,
  keccak256,
  parseEther,
  toBeHex,
  Wallet
} from 'ethers'

import { describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import AmbireAccountFactory from '../../../contracts/compiled/AmbireAccountFactory.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { arbNotDeployed, optyDeployed } from '../../../test/config'
import { getAccountsInfo } from '../../../test/helpers'
import { FEE_COLLECTOR } from '../../consts/addresses'
import {
  AMBIRE_ACCOUNT_FACTORY,
  ENTRY_POINT_MARKER,
  ERC_4337_ENTRYPOINT,
  PROXY_NO_REVERTS
} from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { dedicatedToOneSAPriv } from '../../interfaces/keystore'
import { getSmartAccount } from '../../libs/account/account'
import { AccountOp, callToTuple, getSignableCalls } from '../../libs/accountOp/accountOp'
import { getProxyDeployBytecode } from '../../libs/proxyDeploy/deploy'
import { getAmbireAccountAddress } from '../../libs/proxyDeploy/getAmbireAddressTwo'
import { getTypedData, wrapStandard } from '../../libs/signMessage/signMessage'
import {
  getActivatorCall,
  getOneTimeNonce,
  getPaymasterDataForEstimate,
  getSigForCalculations,
  getUserOperation
} from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'
import { Bundler } from './bundler'

const to = '0x706431177041C87BEb1C25Fa29b92057Cb3c7089'

const addrWithDeploySignature = '0x52C37FD54BD02E9240e8558e28b11e0Dc22d8e85'
const polygon = networks.find((net) => net.id === 'polygon')!

async function getDeploySignature(smartAcc: Account) {
  // CODE FOR getting a valid deploy signature if you have the PK
  const nonce = 0
  const call = getActivatorCall(smartAcc.addr)
  const tupleCall = callToTuple(call)
  const txns = [tupleCall]
  const abiCoder = new AbiCoder()
  const executeHash = keccak256(
    abiCoder.encode(
      ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
      [smartAcc.addr, polygon.chainId, nonce, txns]
    )
  )
  const typedData = getTypedData(polygon.chainId, smartAcc.addr, executeHash)
  const typesWithoutEIP712Domain = { ...typedData.types }
  if (typesWithoutEIP712Domain.EIP712Domain) {
    // eslint-disable-next-line no-param-reassign
    delete typesWithoutEIP712Domain.EIP712Domain
  }
  const wallet = new Wallet(process.env.METAMASK_PK!)
  const s = wrapStandard(
    await wallet.signTypedData(typedData.domain, typesWithoutEIP712Domain, typedData.message)
  )
  return s
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

  describe('Estimation tests: polygon', () => {
    test('should estimate a valid userOp for an undeployed account', async () => {
      const privs = [
        {
          addr: addrWithDeploySignature,
          hash: dedicatedToOneSAPriv
        }
      ]
      const smartAcc = await getSmartAccount(privs)
      const opPolygon: AccountOp = {
        accountAddr: smartAcc.addr,
        signingKeyAddr: smartAcc.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'polygon',
        nonce: 0n,
        signature: '0x',
        calls: [
          // native passes even though matic balance is below 10
          { to, value: parseEther('10'), data: '0x' }
        ],
        accountOpToExecuteBefore: null
      }
      const usedNetworks = [polygon]
      const providers = {
        [polygon.id]: getRpcProvider(polygon.rpcUrls, polygon.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
      const accountState = accountStates[opPolygon.accountAddr][opPolygon.networkId]
      const userOp = getUserOperation(smartAcc, accountState, opPolygon)

      // override the factoryData so it deploys the contract with entry point privileges
      const factoryInterface = new Interface(AmbireAccountFactory.abi)
      const call = getActivatorCall(smartAcc.addr)
      const tupleCall = callToTuple(call)
      const txns = [tupleCall]
      userOp.factoryData = factoryInterface.encodeFunctionData('deployAndExecute', [
        smartAcc.creation!.bytecode,
        smartAcc.creation!.salt,
        txns,
        '0xd35e03b37ad964c1a0c911e6340e921b77c8027c9ff6d553e4169941a64f59eb6a2378df7148f45fc828f4c5fff9f9f35f23d657893e79f759acafa2db40ccb01b01'
      ])
      // end

      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opPolygon)
      ])
      const paymasterAndData = getPaymasterDataForEstimate()
      userOp.paymaster = paymasterAndData.paymaster
      userOp.paymasterVerificationGasLimit = paymasterAndData.paymasterVerificationGasLimit
      userOp.paymasterPostOpGasLimit = paymasterAndData.paymasterPostOpGasLimit
      userOp.paymasterData = paymasterAndData.paymasterData
      userOp.nonce = toBeHex(0)
      userOp.signature = getSigForCalculations()

      const bundlerEstimate = await Bundler.estimate(userOp, polygon)
      expect(bundlerEstimate).toHaveProperty('preVerificationGas')
      expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('callGasLimit')
      expect(bundlerEstimate).toHaveProperty('paymasterVerificationGasLimit')
      expect(bundlerEstimate).toHaveProperty('paymasterPostOpGasLimit')
    })
    test('should try to estimate an userOp for an undeployed account with a standard deploy and a error should be returned that the call is not from the entry point', async () => {
      expect.assertions(1)

      const privs = [
        {
          addr: addrWithDeploySignature,
          hash: dedicatedToOneSAPriv
        }
      ]
      const smartAcc = await getSmartAccount(privs)
      const opPolygon: AccountOp = {
        accountAddr: smartAcc.addr,
        signingKeyAddr: smartAcc.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'polygon',
        nonce: 0n,
        signature: '0x',
        calls: [{ to, value: parseEther('10'), data: '0x' }],
        accountOpToExecuteBefore: null
      }
      const usedNetworks = [polygon]
      const providers = {
        [polygon.id]: getRpcProvider(polygon.rpcUrls, polygon.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
      const accountState = accountStates[opPolygon.accountAddr][opPolygon.networkId]
      const userOp = getUserOperation(smartAcc, accountState, opPolygon)
      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opPolygon)
      ])
      const paymasterAndData = getPaymasterDataForEstimate()
      userOp.paymaster = paymasterAndData.paymaster
      userOp.paymasterVerificationGasLimit = paymasterAndData.paymasterVerificationGasLimit
      userOp.paymasterPostOpGasLimit = paymasterAndData.paymasterPostOpGasLimit
      userOp.paymasterData = paymasterAndData.paymasterData
      userOp.nonce = toBeHex(0)
      userOp.signature = getSigForCalculations()

      try {
        await Bundler.estimate(userOp, polygon)
      } catch (e: any) {
        expect(e.error.message.indexOf('validateUserOp: not from entryPoint')).not.toBe(-1)
      }
    })
    test('should try to estimate an userOp for an undeployed account with entry point privileges but it should revert because we are trying to send USDT and the account does not have USDT', async () => {
      expect.assertions(1)

      const privs = [
        {
          addr: addrWithDeploySignature,
          hash: dedicatedToOneSAPriv
        }
      ]
      const smartAcc = await getSmartAccount(privs)
      const ERC20Interface = new Interface(ERC20.abi)
      const opPolygon: AccountOp = {
        accountAddr: smartAcc.addr,
        signingKeyAddr: smartAcc.associatedKeys[0],
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'polygon',
        nonce: 0n,
        signature: '0x',
        calls: [
          // native, passes even though no matic
          { to, value: parseEther('10'), data: '0x' },
          // USDT, reverts
          {
            to: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
            value: 0n,
            data: ERC20Interface.encodeFunctionData('transfer', [FEE_COLLECTOR, 10])
          }
        ],
        accountOpToExecuteBefore: null
      }
      const usedNetworks = [polygon]
      const providers = {
        [polygon.id]: getRpcProvider(polygon.rpcUrls, polygon.chainId)
      }
      const accountStates = await getAccountsInfo(usedNetworks, providers, [smartAcc])
      const accountState = accountStates[opPolygon.accountAddr][opPolygon.networkId]
      const userOp = getUserOperation(smartAcc, accountState, opPolygon)

      // override the factoryData so it deploys the contract with entry point privileges
      const factoryInterface = new Interface(AmbireAccountFactory.abi)
      const call = getActivatorCall(smartAcc.addr)
      const tupleCall = callToTuple(call)
      const txns = [tupleCall]
      userOp.factoryData = factoryInterface.encodeFunctionData('deployAndExecute', [
        smartAcc.creation!.bytecode,
        smartAcc.creation!.salt,
        txns,
        '0xd35e03b37ad964c1a0c911e6340e921b77c8027c9ff6d553e4169941a64f59eb6a2378df7148f45fc828f4c5fff9f9f35f23d657893e79f759acafa2db40ccb01b01'
      ])
      // end

      const ambireInterface = new Interface(AmbireAccount.abi)
      userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
        getSignableCalls(opPolygon)
      ])
      const paymasterAndData = getPaymasterDataForEstimate()
      userOp.paymaster = paymasterAndData.paymaster
      userOp.paymasterVerificationGasLimit = paymasterAndData.paymasterVerificationGasLimit
      userOp.paymasterPostOpGasLimit = paymasterAndData.paymasterPostOpGasLimit
      userOp.paymasterData = paymasterAndData.paymasterData
      userOp.nonce = toBeHex(0)
      userOp.signature = getSigForCalculations()

      try {
        await Bundler.estimate(userOp, polygon)
      } catch (e: any) {
        const buffer = Buffer.from(
          e.error.message.substring(e.error.message.indexOf('0x') + 2),
          'hex'
        ).toString()
        expect(buffer.indexOf('transfer amount exceeds balance')).not.toBe(-1)
      }
    })
  })

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
    // test('should estimate an userOp for a deployed account', async () => {
    //   const opOptimism: AccountOp = {
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
    //   const accountState = accountStates[opOptimism.accountAddr][opOptimism.networkId]
    //   const userOp = getUserOperation(optyDeployed, accountState, opOptimism)
    //   const ambireInterface = new Interface(AmbireAccount.abi)
    //   userOp.callData = ambireInterface.encodeFunctionData('executeBySender', [
    //     getSignableCalls(opOptimism)
    //   ])
    //   const paymasterAndData = getPaymasterDataForEstimate()
    //   userOp.paymaster = paymasterAndData.paymaster
    //   userOp.paymasterVerificationGasLimit = paymasterAndData.paymasterVerificationGasLimit
    //   userOp.paymasterPostOpGasLimit = paymasterAndData.paymasterPostOpGasLimit
    //   userOp.paymasterData = paymasterAndData.paymasterData
    //   userOp.signature = getSigForCalculations()
    //   const bundlerEstimate = await Bundler.estimate(userOp, arbitrum)
    //   expect(bundlerEstimate).toHaveProperty('preVerificationGas')
    //   expect(bundlerEstimate).toHaveProperty('verificationGasLimit')
    //   expect(bundlerEstimate).toHaveProperty('callGasLimit')
    // })
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
