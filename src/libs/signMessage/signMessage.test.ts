import { Contract, hashMessage, hexlify, toUtf8Bytes, TypedDataEncoder, Wallet } from 'ethers'
import { EventEmitter } from 'stream'

import { beforeAll, describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { PERMIT_2_ADDRESS } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { KeystoreController } from '../../controllers/keystore/keystore'
import { Account, AccountStates } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { getRpcProvider } from '../../services/provider'
import { callToTuple, getSignableHash } from '../accountOp/accountOp'
import { getAccountState } from '../accountState/accountState'
import { KeystoreSigner } from '../keystoreSigner/keystoreSigner'
import {
  getAmbireReadableTypedData,
  getEIP712Signature,
  getEip7702Authorization,
  getPlainTextSignature,
  getTypedData,
  getVerifyMessageSignature,
  verifyMessage,
  wrapWallet
} from './signMessage'

const ethereumNetwork = networks.find((net) => net.id === 'ethereum')!
const polygonNetwork = networks.find((net) => net.id === 'polygon')!
const contractSuccess = '0x1626ba7e'
const unsupportedNetwork = {
  id: 'zircuit mainnet',
  name: 'Zircuit Mainnet',
  nativeAssetSymbol: 'ETH',
  rpcUrls: ['https://zircuit1-mainnet.p2pify.com'],
  selectedRpcUrl: 'https://zircuit1-mainnet.p2pify.com',
  rpcNoStateOverride: false,
  chainId: 48900n,
  explorerUrl: 'https://explorer.zircuit.com',
  erc4337: { enabled: false, hasPaymaster: false, hasBundlerSupport: false },
  isSAEnabled: false,
  areContractsDeployed: false,
  hasRelayer: false,
  platformId: 'zircuit',
  nativeAssetId: 'weth',
  hasSingleton: false,
  features: [],
  feeOptions: { is1559: true },
  predefined: false
}

const eoaSigner = {
  privKey: '0x8ad1e4982a3a2e5ef35db11d498d48ab33cbe91bb258802bc8703c943c5a256a',
  keyPublicAddress: '0x49355Fa4514FA49531C3Be16c75dE6c96B99718C',
  pass: 'testpass'
}
const v1siger = {
  privKey: '0x9b33bde36ad2252f03e8342a4479464a5342285954330c394879b15da0c7f252',
  keyPublicAddress: '0xB336900deb329bE6E6E515954c31AE610c13B771',
  pass: 'testpass'
}
const eoaAccount: Account = {
  addr: eoaSigner.keyPublicAddress,
  associatedKeys: [eoaSigner.keyPublicAddress],
  creation: null,
  initialPrivileges: [],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: eoaSigner.keyPublicAddress
  }
}

const v2SmartAccAddr = '0x26d6a373397d553595Cd6A7BBaBD86DEbd60a1Cc'
const smartAccount: Account = {
  addr: v2SmartAccAddr,
  associatedKeys: [eoaSigner.keyPublicAddress],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027f4cddd6c90a7055aa3d00deceb0664950d2f31114946678b79df2a5540a3238f8553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: [],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: v2SmartAccAddr
  }
}

const v1Account: Account = {
  addr: '0x254D526978D15C9619288949f9419e918977F9F3',
  // v2SmartAccAddr is a signer only on polygon
  associatedKeys: [v1siger.keyPublicAddress, v2SmartAccAddr],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f832a45b3e3616710ac5703e98191d3827c46e7f1107596b00d26584abe24d690553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
  },
  initialPrivileges: [],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x254D526978D15C9619288949f9419e918977F9F3'
  }
}

const providers = Object.fromEntries(
  networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
)

const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) => getAccountState(providers[network.id], network, accounts))
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: Network, netIndex: number) => {
          return [network.id, result[netIndex][accIndex]]
        })
      )
    ]
  })
  return Object.fromEntries(states)
}

const windowManager = {
  focus: () => Promise.resolve(),
  open: () => Promise.resolve(0),
  remove: () => Promise.resolve(),
  event: new EventEmitter(),
  sendWindowToastMessage: () => {},
  sendWindowUiMessage: () => {}
}

let keystore: KeystoreController
describe('Sign Message, Keystore with key dedicatedToOneSA: true ', () => {
  beforeAll(async () => {
    const storage: Storage = produceMemoryStore()
    keystore = new KeystoreController(storage, { internal: KeystoreSigner }, windowManager)
    await keystore.addSecret('passphrase', eoaSigner.pass, '', false)
    await keystore.unlockWithSecret('passphrase', eoaSigner.pass)
    await keystore.addKeys([
      {
        addr: new Wallet(eoaSigner.privKey).address,
        privateKey: eoaSigner.privKey,
        type: 'internal' as 'internal',
        label: 'Key 1',
        dedicatedToOneSA: true,
        meta: {
          createdAt: new Date().getTime()
        }
      },
      {
        addr: new Wallet(v1siger.privKey).address,
        type: 'internal' as 'internal',
        label: 'Key 2',
        privateKey: v1siger.privKey,
        dedicatedToOneSA: false,
        meta: {
          createdAt: new Date().getTime()
        }
      }
    ])
  })
  test('Signing [EOA]: plain text', async () => {
    const accountStates = await getAccountsInfo([eoaAccount])
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const signatureForPlainText = await getPlainTextSignature(
      'test',
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr][ethereumNetwork.id],
      signer
    )
    const provider = getRpcProvider(ethereumNetwork.rpcUrls, ethereumNetwork.chainId)
    const firstRes = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: signatureForPlainText,
      message: 'test'
    })
    expect(firstRes).toBe(true)

    const signatureForUint8Array = await getPlainTextSignature(
      toUtf8Bytes('test'),
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr][ethereumNetwork.id],
      signer
    )
    const secondRes = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: signatureForUint8Array,
      message: toUtf8Bytes('test')
    })
    expect(secondRes).toBe(true)

    const signatureForNumberAsString = await getPlainTextSignature(
      '1',
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr][ethereumNetwork.id],
      signer
    )
    const thirdRes = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: signatureForNumberAsString,
      message: '1'
    })
    expect(thirdRes).toBe(true)
  })
  test('Signing [Dedicated to one SA]: plain text', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const signatureForPlainText = await getPlainTextSignature(
      'test',
      polygonNetwork,
      smartAccount,
      accountStates[smartAccount.addr][polygonNetwork.id],
      signer
    )
    // the key should be dedicatedToOneSA, so we expect the signature to end in 00
    expect(signatureForPlainText.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const res = await verifyMessage({
      network: polygonNetwork,
      provider,
      signer: smartAccount.addr,
      signature: signatureForPlainText,
      message: 'test'
    })
    expect(res).toBe(true)

    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider)
    const isValidSig = await contract.isValidSignature(hashMessage('test'), signatureForPlainText)
    expect(isValidSig).toBe(contractSuccess)
  })
  test('Signing [V1 SA]: plain text, should allow as it contains the address in the message', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    const msg = `test for ${v1Account.addr}`
    const signatureForPlainText = await getPlainTextSignature(
      msg,
      polygonNetwork,
      v1Account,
      accountStates[v1Account.addr][polygonNetwork.id],
      signer
    )
    // the key should be 00 because it's a v1 account
    expect(signatureForPlainText.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const res = await verifyMessage({
      network: polygonNetwork,
      provider,
      signer: v1Account.addr,
      signature: signatureForPlainText,
      message: msg
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA]: plain text, should throw an error as it does NOT contain the address in the message', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    try {
      await getPlainTextSignature(
        'test',
        ethereumNetwork,
        v1Account,
        accountStates[v1Account.addr][ethereumNetwork.id],
        signer
      )
      console.log('No error was thrown for [V1 SA]: plain text, but it should have')
      expect(true).toEqual(false)
    } catch (e: any) {
      expect(e.message).toBe(
        'Signing messages is disallowed for v1 accounts. Please contact support to proceed'
      )
    }
  })

  test('Signing [V1 SA]: plain text, should throw an error as it disallowed to sign message with contains address in it on unsupported chain', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    await expect(
      getPlainTextSignature(
        `test with address in the message on unsupported chain: ${v1Account.addr}`,
        unsupportedNetwork,
        v1Account,
        accountStates[v1Account.addr][ethereumNetwork.id],
        signer
      )
    ).rejects.toThrow(
      `Signing messages is disallowed for v1 accounts on ${unsupportedNetwork.name}`
    )
  })

  test('Signing [EOA]: eip-712', async () => {
    const accountStates = await getAccountsInfo([eoaAccount])
    const accountState = accountStates[eoaAccount.addr][ethereumNetwork.id]
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const typedDataTest = getTypedData(
      ethereumNetwork.chainId,
      accountState.accountAddr,
      hashMessage('test')
    )
    const provider = getRpcProvider(ethereumNetwork.rpcUrls, ethereumNetwork.chainId)
    const eip712Sig = await getEIP712Signature(
      typedDataTest,
      eoaAccount,
      accountState,
      signer,
      ethereumNetwork
    )
    const res = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: eip712Sig,
      typedData: typedDataTest
    })
    expect(res).toBe(true)

    const typedDataNumber = getTypedData(
      ethereumNetwork.chainId,
      accountState.accountAddr,
      hashMessage('12')
    )
    const eip712SigNum = await getEIP712Signature(
      typedDataNumber,
      eoaAccount,
      accountState,
      signer,
      ethereumNetwork
    )

    const secondRes = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: eip712SigNum,
      typedData: typedDataNumber
    })
    expect(secondRes).toBe(true)
  })
  test('Signing [Dedicated to one SA]: eip-712', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const accountState = accountStates[smartAccount.addr][polygonNetwork.id]
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const typedData = getTypedData(
      polygonNetwork.chainId,
      accountState.accountAddr,
      hashMessage('test')
    )
    const eip712Sig = await getEIP712Signature(
      typedData,
      smartAccount,
      accountState,
      signer,
      polygonNetwork
    )
    // the key should be dedicatedToOneSA, so we expect the signature to end in 00
    expect(eip712Sig.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const res = await verifyMessage({
      network: polygonNetwork,
      provider,
      signer: smartAccount.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)

    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider)
    const isValidSig = await contract.isValidSignature(
      TypedDataEncoder.hash(typedData.domain, typedData.types, typedData.message),
      eip712Sig
    )
    expect(isValidSig).toBe(contractSuccess)
  })
  test('Signing [V1 SA]: eip-712, should pass as the smart account address is in the typed data', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const accountState = accountStates[v1Account.addr][ethereumNetwork.id]
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    const typedData = getTypedData(
      ethereumNetwork.chainId,
      accountState.accountAddr,
      hashMessage('test')
    )
    const eip712Sig = await getEIP712Signature(
      typedData,
      v1Account,
      accountState,
      signer,
      ethereumNetwork
    )
    // the key is for a v1 acc so it should be 00
    expect(eip712Sig.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const res = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: v1Account.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)
  })
  test("Signing [V1 SA]: eip-712, should pass as the verifying contract is Uniswap's permit contract", async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const accountState = accountStates[v1Account.addr][ethereumNetwork.id]
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    const typedData = getTypedData(ethereumNetwork.chainId, PERMIT_2_ADDRESS, hashMessage('test'))
    typedData.domain.name = 'Permit2'
    typedData.message.spender = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
    const eip712Sig = await getEIP712Signature(
      typedData,
      v1Account,
      accountState,
      signer,
      ethereumNetwork
    )
    // the key is for a v1 acc so it should be 00
    expect(eip712Sig.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const res = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: v1Account.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA]: eip-712, should throw an error as the smart account address is NOT in the typed data', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const accountState = accountStates[v1Account.addr][ethereumNetwork.id]
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    const typedData = getTypedData(
      ethereumNetwork.chainId,
      v1siger.keyPublicAddress, // this is the difference
      hashMessage('test')
    )
    try {
      await getEIP712Signature(typedData, v1Account, accountState, signer, polygonNetwork)
      console.log('No error was thrown for [V1 SA]: eip-712, but it should have')
      expect(true).toEqual(false)
    } catch (e: any) {
      expect(e.message).toBe(
        'Signing this eip-712 message is disallowed for v1 accounts as it does not contain the smart account address and therefore deemed unsafe'
      )
    }
  })
  test('Signing [V1 SA, V2 Signer]: signing an ambire operation', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const v2AccountState = accountStates[smartAccount.addr][polygonNetwork.id]
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const ambireReadableOperation = {
      addr: v1Account.addr as Hex,
      nonce: 0n,
      chainId: 137n,
      calls: [{ to: v2SmartAccAddr as Hex, value: 0n, data: '0x' as Hex }]
    }
    const typedData = getAmbireReadableTypedData(
      polygonNetwork.chainId,
      v2SmartAccAddr,
      ambireReadableOperation
    )
    const hash = hexlify(
      getSignableHash(
        ambireReadableOperation.addr,
        ambireReadableOperation.chainId,
        ambireReadableOperation.nonce,
        ambireReadableOperation.calls.map(callToTuple)
      )
    )
    const eip712Sig = await getEIP712Signature(
      typedData,
      smartAccount,
      v2AccountState,
      signer,
      polygonNetwork
    )

    expect(eip712Sig.slice(-2)).toEqual('02')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)

    // v2 account
    const contractV2 = new Contract(v2SmartAccAddr, AmbireAccount.abi, provider)
    const isValidSigforv2 = await contractV2.isValidSignature(hash, eip712Sig.slice(0, 134))
    expect(isValidSigforv2).toBe(contractSuccess)

    // v1 account
    const contract = new Contract(v1Account.addr, AmbireAccount.abi, provider)
    const isValidSig = await contract.isValidSignature(hash, eip712Sig)
    expect(isValidSig).toBe(contractSuccess)

    // verify message should pass
    const res = await verifyMessage({
      network: polygonNetwork,
      provider,
      signer: v1Account.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA, V2 Signer]: signing a normal EIP-712 request', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const v2AccountState = accountStates[smartAccount.addr][polygonNetwork.id]
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const typedData = getTypedData(polygonNetwork.chainId, v2SmartAccAddr, hashMessage('test'))
    const eip712Sig = await getEIP712Signature(
      typedData,
      smartAccount,
      v2AccountState,
      signer,
      polygonNetwork
    )
    expect(eip712Sig.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const wrappedSig = wrapWallet(eip712Sig, smartAccount.addr)

    // verify message should pass
    const res = await verifyMessage({
      network: polygonNetwork,
      provider,
      signer: v1Account.addr,
      signature: wrappedSig,
      typedData
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA, V2 Signer]: plain text', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const v2AccountState = accountStates[smartAccount.addr][polygonNetwork.id]
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const signatureForPlainText = await getPlainTextSignature(
      'test',
      polygonNetwork,
      smartAccount,
      v2AccountState,
      signer
    )
    expect(signatureForPlainText.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const wrappedSig = wrapWallet(signatureForPlainText, smartAccount.addr)

    const res = await verifyMessage({
      network: polygonNetwork,
      provider,
      signer: v1Account.addr,
      signature: wrappedSig,
      message: 'test'
    })
    expect(res).toBe(true)
  })

  test('Signing [V1 SA, V2 Signer]: a request for an AmbireReadableOperation should revert if the execution address is the same (signing for the current wallet instead of a diff wallet)', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const v2AccountState = accountStates[smartAccount.addr][polygonNetwork.id]
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const ambireReadableOperation = {
      addr: v2SmartAccAddr as Hex,
      nonce: 0n,
      chainId: 137n,
      calls: [{ to: v1Account.addr as Hex, value: 0n, data: '0x' as Hex }]
    }
    const typedData = getAmbireReadableTypedData(
      polygonNetwork.chainId,
      v2SmartAccAddr,
      ambireReadableOperation
    )

    try {
      await getEIP712Signature(typedData, smartAccount, v2AccountState, signer, polygonNetwork)
      console.log('No error was thrown, but it should have')
      expect(true).toEqual(false)
    } catch (e: any) {
      expect(e.message).toBe(
        'signature error: trying to sign an AmbireReadableOperation for the same address. Please contact support'
      )
    }
  })
  test('Signing [EOA]: authorization', async () => {
    const accountStates = await getAccountsInfo([eoaAccount])
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const authorizationHash = getEip7702Authorization(1n, 0n)
    const signature = signer.sign7702(authorizationHash)
    const provider = getRpcProvider(ethereumNetwork.rpcUrls, ethereumNetwork.chainId)
    const authorizationRes = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: getVerifyMessageSignature(
        signature,
        eoaAccount,
        accountStates[eoaAccount.addr][ethereumNetwork.id]
      ),
      authorization: authorizationHash
    })
    expect(authorizationRes).toBe(true)

    // increment the nonce to be sure 'v' transform is working
    const authorizationHash2 = getEip7702Authorization(1n, 1n)
    const signature2 = signer.sign7702(authorizationHash2)
    const authorizationRes2 = await verifyMessage({
      network: ethereumNetwork,
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: getVerifyMessageSignature(
        signature2,
        eoaAccount,
        accountStates[eoaAccount.addr][ethereumNetwork.id]
      ),
      authorization: authorizationHash2
    })
    expect(authorizationRes2).toBe(true)
  })
})

describe('Sign Message, Keystore with key dedicatedToOneSA: false', () => {
  beforeAll(async () => {
    const storage: Storage = produceMemoryStore()
    keystore = new KeystoreController(storage, { internal: KeystoreSigner }, windowManager)
    await keystore.addSecret('passphrase', eoaSigner.pass, '', false)
    await keystore.unlockWithSecret('passphrase', eoaSigner.pass)
    await keystore.addKeys([
      {
        addr: new Wallet(eoaSigner.privKey).address,
        privateKey: eoaSigner.privKey,
        type: 'internal' as 'internal',
        label: 'Key 1',
        dedicatedToOneSA: false,
        meta: {
          createdAt: new Date().getTime()
        }
      }
    ])
  })
  test('Signing [Not dedicated to one SA]: plain text', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const signatureForPlainText = await getPlainTextSignature(
      'test',
      polygonNetwork,
      smartAccount,
      accountStates[smartAccount.addr][polygonNetwork.id],
      signer
    )
    // the key should not be dedicatedToOneSA, so we expect the signature to end in 01
    expect(signatureForPlainText.slice(-2)).toEqual('01')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider)
    const isValidSig = await contract.isValidSignature(hashMessage('test'), signatureForPlainText)
    expect(isValidSig).toBe(contractSuccess)

    const res = await verifyMessage({
      network: polygonNetwork,
      provider,
      signer: smartAccount.addr,
      signature: signatureForPlainText,
      message: 'test'
    })
    expect(res).toBe(true)
  })
  test('Signing [Not dedicated to one SA]: eip-712, should throw an error', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const accountState = accountStates[smartAccount.addr][polygonNetwork.id]
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const typedData = getTypedData(
      polygonNetwork.chainId,
      accountState.accountAddr,
      hashMessage('test')
    )
    try {
      await getEIP712Signature(typedData, smartAccount, accountState, signer, polygonNetwork)
      console.log('No error was thrown for [Not dedicated to one SA]: eip-712, but it should have')
      expect(true).toEqual(false)
    } catch (e: any) {
      expect(e.message).toBe(
        `Signer with address ${signer.key.addr} does not have privileges to execute this operation. Please choose a different signer and try again`
      )
    }
  })
})
