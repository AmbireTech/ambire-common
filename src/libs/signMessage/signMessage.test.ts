import {
  Contract,
  hashMessage,
  JsonRpcProvider,
  toUtf8Bytes,
  verifyMessage,
  verifyTypedData
} from 'ethers'

import { beforeAll, describe, expect, test } from '@jest/globals'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import { produceMemoryStore } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { KeystoreController } from '../../controllers/keystore/keystore'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { getAccountState } from '../accountState/accountState'
import { KeystoreSigner } from '../keystoreSigner/keystoreSigner'
import { getPlainTextSignature, getTypedData } from './signMessage'

const ethereumNetwork = networks.find((net) => net.id === 'ethereum')!
const polygonNetwork = networks.find((net) => net.id === 'polygon')!
const contractSuccess = '0x1626ba7e'

const eoaSigner = {
  privKey: '0x8ad1e4982a3a2e5ef35db11d498d48ab33cbe91bb258802bc8703c943c5a256a',
  keyPublicAddress: '0x49355Fa4514FA49531C3Be16c75dE6c96B99718C',
  pass: 'testpass'
}
const eoaAccount: Account = {
  addr: eoaSigner.keyPublicAddress,
  associatedKeys: [eoaSigner.keyPublicAddress],
  creation: null
}

const smartAccount: Account = {
  addr: '0x26d6a373397d553595Cd6A7BBaBD86DEbd60a1Cc',
  associatedKeys: [eoaSigner.keyPublicAddress],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027f4cddd6c90a7055aa3d00deceb0664950d2f31114946678b79df2a5540a3238f8553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  }
}

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)

const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) => getAccountState(providers[network.id], network, accounts))
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: NetworkDescriptor, netIndex: number) => {
          return [network.id, result[netIndex][accIndex]]
        })
      )
    ]
  })
  return Object.fromEntries(states)
}

let keystore: KeystoreController
describe('Sign Message with key dedicatedToOneSA: true ', () => {
  beforeAll(async () => {
    const storage: Storage = produceMemoryStore()
    keystore = new KeystoreController(storage, { internal: KeystoreSigner })
    await keystore.addSecret('passphrase', eoaSigner.pass, '', false)
    await keystore.unlockWithSecret('passphrase', eoaSigner.pass)
    await keystore.addKeys([{ privateKey: eoaSigner.privKey, dedicatedToOneSA: true }])
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
    expect(verifyMessage('test', signatureForPlainText)).toBe(eoaSigner.keyPublicAddress)

    const signatureForUint8Array = await getPlainTextSignature(
      toUtf8Bytes('test'),
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr][ethereumNetwork.id],
      signer
    )
    expect(verifyMessage(toUtf8Bytes('test'), signatureForUint8Array)).toBe(
      eoaSigner.keyPublicAddress
    )

    const signatureForNumberAsString = await getPlainTextSignature(
      '1',
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr][ethereumNetwork.id],
      signer
    )
    expect(verifyMessage('1', signatureForNumberAsString)).toBe(eoaSigner.keyPublicAddress)
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
    // the key should dedicatedToOneSA, so we expect the signature to end in 00
    expect(signatureForPlainText.slice(-2)).toEqual('00')

    const unwrappedSig = signatureForPlainText.slice(0, -2)
    expect(verifyMessage('test', unwrappedSig)).toBe(eoaSigner.keyPublicAddress)

    const provider = new JsonRpcProvider(polygonNetwork.rpcUrl)
    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider)
    const isValidSig = await contract.isValidSignature(hashMessage('test'), signatureForPlainText)
    expect(isValidSig).toBe(contractSuccess)
  })
})

describe('Sign Message with key dedicatedToOneSA: false', () => {
  beforeAll(async () => {
    const storage: Storage = produceMemoryStore()
    keystore = new KeystoreController(storage, { internal: KeystoreSigner })
    await keystore.addSecret('passphrase', eoaSigner.pass, '', false)
    await keystore.unlockWithSecret('passphrase', eoaSigner.pass)
    await keystore.addKeys([{ privateKey: eoaSigner.privKey, dedicatedToOneSA: false }])
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

    const typedData = getTypedData(polygonNetwork.chainId, smartAccount.addr, hashMessage('test'))
    const unwrappedSig = signatureForPlainText.slice(0, -2)
    delete typedData.types.EIP712Domain
    expect(
      verifyTypedData(typedData.domain, typedData.types, typedData.message, unwrappedSig)
    ).toBe(eoaSigner.keyPublicAddress)

    const provider = new JsonRpcProvider(polygonNetwork.rpcUrl)
    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider)
    const isValidSig = await contract.isValidSignature(hashMessage('test'), signatureForPlainText)
    expect(isValidSig).toBe(contractSuccess)
  })
})
