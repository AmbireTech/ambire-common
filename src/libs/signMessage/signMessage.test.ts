import {
  concat,
  Contract,
  getBytes,
  hashMessage,
  hexlify,
  Interface,
  JsonRpcProvider,
  recoverAddress,
  toBeHex,
  toUtf8Bytes,
  Wallet
} from 'ethers'

import { beforeAll, describe, expect, test } from '@jest/globals'
import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import Safe from '../../../contracts/compiled/Safe.json'
import { produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { PERMIT_2_ADDRESS } from '../../consts/addresses'
import { EIP_7702_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { KeystoreController } from '../../controllers/keystore/keystore'
import { StorageController } from '../../controllers/storage/storage'
import { UiController } from '../../controllers/ui/ui'
import { Account, AccountStates } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { IKeystoreController } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { TypedMessageUserRequest } from '../../interfaces/userRequest'
import { getRpcProvider } from '../../services/provider'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import { callToTuple, getSignableHash } from '../accountOp/accountOp'
import { getAccountState } from '../accountState/accountState'
import { KeystoreSigner } from '../keystoreSigner/keystoreSigner'
import {
  adaptTypedMessageForMetaMaskSigUtil,
  getAmbireReadableTypedData,
  getAuthorizationHash,
  getEIP712Signature,
  getPlainTextSignature,
  getSafeTypedData,
  getTypedData,
  getVerifyMessageSignature,
  verifyMessage,
  wrapWallet
} from './signMessage'

const ethereumNetwork = networks.find((n) => n.chainId === 1n)!
const polygonNetwork = networks.find((n) => n.chainId === 137n)!
const contractSuccess = '0x1626ba7e'
// const unsupportedNetwork = {
//   id: 'zircuit mainnet',
//   name: 'Zircuit Mainnet',
//   nativeAssetSymbol: 'ETH',
//   nativeAssetName: 'Ether',
//   rpcUrls: ['https://zircuit1-mainnet.p2pify.com'],
//   selectedRpcUrl: 'https://zircuit1-mainnet.p2pify.com',
//   rpcNoStateOverride: false,
//   chainId: 48900n,
//   explorerUrl: 'https://explorer.zircuit.com',
//   erc4337: { enabled: false, hasPaymaster: false, hasBundlerSupport: false },
//   isSAEnabled: false,
//   areContractsDeployed: false,
//   hasRelayer: false,
//   platformId: 'zircuit',
//   nativeAssetId: 'weth',
//   hasSingleton: false,
//   features: [],
//   feeOptions: { is1559: true },
//   predefined: false,
//   has7702: false
// }

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
const eoaAccountHackedDelegation: Account = {
  addr: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  associatedKeys: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'],
  creation: null,
  initialPrivileges: [],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
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
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) =>
      getAccountState(providers[network.chainId.toString()], network, accounts, [])
    )
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: Network, netIndex: number) => {
          return [network.chainId, result[netIndex]![accIndex]]
        })
      )
    ]
  })
  return Object.fromEntries(states)
}

let keystore: IKeystoreController
describe('Sign Message, Keystore with key dedicatedToOneSA: true ', () => {
  beforeAll(async () => {
    const storage: Storage = produceMemoryStore()
    const storageCtrl = new StorageController(storage)
    const { uiManager } = mockUiManager()
    const uiCtrl = new UiController({ uiManager })
    keystore = new KeystoreController('default', storageCtrl, { internal: KeystoreSigner }, uiCtrl)
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
      },
      {
        addr: eoaAccountHackedDelegation.addr,
        type: 'internal' as 'internal',
        label: 'Anvil key 1',
        privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        dedicatedToOneSA: true,
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
      hexlify(toUtf8Bytes('test')) as Hex,
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr]![ethereumNetwork.chainId.toString()]!,
      signer
    )
    const provider = getRpcProvider(ethereumNetwork.rpcUrls, ethereumNetwork.chainId)
    const firstRes = await verifyMessage({
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: signatureForPlainText.signature,
      message: 'test'
    })
    expect(firstRes).toBe(true)

    const signatureForUint8Array = await getPlainTextSignature(
      hexlify(toUtf8Bytes('test')) as Hex,
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr]![ethereumNetwork.chainId.toString()]!,
      signer
    )
    const secondRes = await verifyMessage({
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: signatureForUint8Array.signature,
      message: toUtf8Bytes('test')
    })
    expect(secondRes).toBe(true)

    const signatureForNumberAsString = await getPlainTextSignature(
      hexlify(toUtf8Bytes('1')) as Hex,
      ethereumNetwork,
      eoaAccount,
      accountStates[eoaAccount.addr]![ethereumNetwork.chainId.toString()]!,
      signer
    )
    const thirdRes = await verifyMessage({
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: signatureForNumberAsString.signature,
      message: '1'
    })
    expect(thirdRes).toBe(true)
  })
  test('Signing [Dedicated to one SA]: plain text', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const signatureForPlainText = await getPlainTextSignature(
      hexlify(toUtf8Bytes('test')) as Hex,
      polygonNetwork,
      smartAccount,
      accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!,
      signer
    )
    // the key should be dedicatedToOneSA, so we expect the signature to end in 00
    expect(signatureForPlainText.signature.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const res = await verifyMessage({
      provider,
      signer: smartAccount.addr,
      signature: signatureForPlainText.signature,
      message: 'test'
    })
    expect(res).toBe(true)

    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider) as any
    const isValidSig = await contract.isValidSignature(
      hashMessage('test'),
      signatureForPlainText.signature
    )
    expect(isValidSig).toBe(contractSuccess)
  })
  test('Signing [V1 SA]: plain text, should allow as it contains the address in the message', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    const msg = hexlify(toUtf8Bytes(`test for ${v1Account.addr}`)) as Hex
    const signatureForPlainText = await getPlainTextSignature(
      msg,
      polygonNetwork,
      v1Account,
      accountStates[v1Account.addr]![polygonNetwork.chainId.toString()]!,
      signer
    )
    // the key should be 00 because it's a v1 account
    expect(signatureForPlainText.signature.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const res = await verifyMessage({
      provider,
      signer: v1Account.addr,
      signature: signatureForPlainText.signature,
      message: hexStringToUint8Array(msg)
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA]: plain text, should throw an error as it does NOT contain the address in the message', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')

    try {
      await getPlainTextSignature(
        hexlify(toUtf8Bytes('test')) as Hex,
        ethereumNetwork,
        v1Account,
        accountStates[v1Account.addr]![ethereumNetwork.chainId.toString()]!,
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

  test('Signing [V1 SA]: disallowed plain text, but with OG mode', async () => {
    const signer = await keystore.getSigner(v1siger.keyPublicAddress, 'internal')
    const accountStates = await getAccountsInfo([v1Account])

    const accountState = accountStates[v1Account.addr]![ethereumNetwork.chainId.toString()]!

    const plaintextSigNoAddrInMessage = await getPlainTextSignature(
      hexlify(toUtf8Bytes('test')) as Hex,
      ethereumNetwork,
      v1Account,
      accountState,
      signer,
      true
    )

    const typedData = getTypedData(
      ethereumNetwork.chainId,
      v1siger.keyPublicAddress, // this is the difference
      hashMessage('test')
    )
    const typedSigNoAddrInMessage = await getEIP712Signature(
      typedData,
      v1Account,
      accountState,
      signer,
      polygonNetwork,
      true
    )

    expect(plaintextSigNoAddrInMessage).toBeTruthy()
    expect(typedSigNoAddrInMessage).toBeTruthy()
  })
  test('Signing [EOA]: eip-712', async () => {
    const accountStates = await getAccountsInfo([eoaAccount])
    const accountState = accountStates[eoaAccount.addr]![ethereumNetwork.chainId.toString()]!
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
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: eip712SigNum,
      typedData: typedDataNumber
    })
    expect(secondRes).toBe(true)
  })
  test('Signing [EOA]: eip-712 OrderComponents[2] array index case', async () => {
    const accountStates = await getAccountsInfo([eoaAccount])
    const accountState = accountStates[eoaAccount.addr]![ethereumNetwork.chainId.toString()]!
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const typedDataTest: TypedMessageUserRequest['meta']['params'] = {
      types: {
        BulkOrder: [
          {
            name: 'tree',
            type: 'OrderComponents[2]'
          }
        ],
        OrderComponents: [
          {
            name: 'offerer',
            type: 'address'
          },
          {
            name: 'zone',
            type: 'address'
          },
          {
            name: 'offer',
            type: 'OfferItem[]'
          },
          {
            name: 'consideration',
            type: 'ConsiderationItem[]'
          },
          {
            name: 'orderType',
            type: 'uint8'
          },
          {
            name: 'startTime',
            type: 'uint256'
          },
          {
            name: 'endTime',
            type: 'uint256'
          },
          {
            name: 'zoneHash',
            type: 'bytes32'
          },
          {
            name: 'salt',
            type: 'uint256'
          },
          {
            name: 'conduitKey',
            type: 'bytes32'
          },
          {
            name: 'counter',
            type: 'uint256'
          }
        ],
        EIP712Domain: [],
        OfferItem: [
          {
            name: 'itemType',
            type: 'uint8'
          },
          {
            name: 'token',
            type: 'address'
          },
          {
            name: 'identifierOrCriteria',
            type: 'uint256'
          },
          {
            name: 'startAmount',
            type: 'uint256'
          },
          {
            name: 'endAmount',
            type: 'uint256'
          }
        ],
        ConsiderationItem: [
          {
            name: 'itemType',
            type: 'uint8'
          },
          {
            name: 'token',
            type: 'address'
          },
          {
            name: 'identifierOrCriteria',
            type: 'uint256'
          },
          {
            name: 'startAmount',
            type: 'uint256'
          },
          {
            name: 'endAmount',
            type: 'uint256'
          },
          {
            name: 'recipient',
            type: 'address'
          }
        ]
      },
      domain: {
        name: 'Seaport',
        version: '1.6',
        chainId: 8453,
        verifyingContract: '0x0000000000000068f116a894984e2db1123eb395'
      },
      message: {
        tree: [
          {
            offerer: '0x090102422f003438ee2e2709acebf9f060702306',
            zone: '0x0000000000000000000000000000000000000000',
            offer: [
              {
                itemType: 2,
                token: '0x62e094f8b4ab1291dd2d8821ad3cba64b8b8c7a6',
                identifierOrCriteria: '790',
                startAmount: '1',
                endAmount: '1'
              }
            ],
            consideration: [
              {
                itemType: 0,
                token: '0x0000000000000000000000000000000000000000',
                identifierOrCriteria: '0',
                startAmount: '970000000000000000',
                endAmount: '970000000000000000',
                recipient: '0x090102422f003438ee2e2709acebf9f060702306'
              },
              {
                itemType: 0,
                token: '0x0000000000000000000000000000000000000000',
                identifierOrCriteria: '0',
                startAmount: '5000000000000000',
                endAmount: '5000000000000000',
                recipient: '0x0000a26b00c1f0df003000390027140000faa719'
              },
              {
                itemType: 0,
                token: '0x0000000000000000000000000000000000000000',
                identifierOrCriteria: '0',
                startAmount: '25000000000000000',
                endAmount: '25000000000000000',
                recipient: '0x61de28c8bef7ad4786fb732a05fd59317eca2bfb'
              }
            ],
            orderType: 0,
            startTime: '1751376310',
            endTime: '1753968310',
            zoneHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
            salt: '27855337018906766782546881864045825683096516384821792734234219145737770391551',
            conduitKey: '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
            counter: '0',
            totalOriginalConsiderationItems: 3
          },
          {
            offerer: '0x090102422f003438ee2e2709acebf9f060702306',
            zone: '0x0000000000000000000000000000000000000000',
            offer: [
              {
                itemType: 2,
                token: '0x62e094f8b4ab1291dd2d8821ad3cba64b8b8c7a6',
                identifierOrCriteria: '1013',
                startAmount: '1',
                endAmount: '1'
              }
            ],
            consideration: [
              {
                itemType: 0,
                token: '0x0000000000000000000000000000000000000000',
                identifierOrCriteria: '0',
                startAmount: '18333000000000000',
                endAmount: '18333000000000000',
                recipient: '0x090102422f003438ee2e2709acebf9f060702306'
              },
              {
                itemType: 0,
                token: '0x0000000000000000000000000000000000000000',
                identifierOrCriteria: '0',
                startAmount: '94500000000000',
                endAmount: '94500000000000',
                recipient: '0x0000a26b00c1f0df003000390027140000faa719'
              },
              {
                itemType: 0,
                token: '0x0000000000000000000000000000000000000000',
                identifierOrCriteria: '0',
                startAmount: '472500000000000',
                endAmount: '472500000000000',
                recipient: '0x61de28c8bef7ad4786fb732a05fd59317eca2bfb'
              }
            ],
            orderType: 0,
            startTime: '1751376310',
            endTime: '1753968310',
            zoneHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
            salt: '27855337018906766782546881864045825683096516384821792734247284322247575321829',
            conduitKey: '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000',
            counter: '0',
            totalOriginalConsiderationItems: 3
          }
        ]
      },
      primaryType: 'BulkOrder'
    }
    const provider = getRpcProvider(ethereumNetwork.rpcUrls, ethereumNetwork.chainId)
    const eip712Sig = await getEIP712Signature(
      typedDataTest,
      eoaAccount,
      accountState,
      signer,
      ethereumNetwork
    )
    const res = await verifyMessage({
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: eip712Sig,
      typedData: typedDataTest
    })
    expect(res).toBe(true)
  })
  test('Signing [Dedicated to one SA]: eip-712', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const accountState = accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!
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
      provider,
      signer: smartAccount.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)

    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider) as any
    const isValidSig = await contract.isValidSignature(
      TypedDataUtils.eip712Hash(
        adaptTypedMessageForMetaMaskSigUtil(typedData),
        SignTypedDataVersion.V4
      ),
      eip712Sig
    )
    expect(isValidSig).toBe(contractSuccess)
  })
  test('Signing [V1 SA]: eip-712, should pass as the smart account address is in the typed data', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const accountState = accountStates[v1Account.addr]![ethereumNetwork.chainId.toString()]!
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
      provider,
      signer: v1Account.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)
  })
  test("Signing [V1 SA]: eip-712, should pass as the verifying contract is Uniswap's permit contract", async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const accountState = accountStates[v1Account.addr]![ethereumNetwork.chainId.toString()]!
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
      provider,
      signer: v1Account.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA]: eip-712, should throw an error as the smart account address is NOT in the typed data', async () => {
    const accountStates = await getAccountsInfo([v1Account])
    const accountState = accountStates[v1Account.addr]![ethereumNetwork.chainId.toString()]!
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
    const v2AccountState = accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!
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
    const contractV2 = new Contract(v2SmartAccAddr, AmbireAccount.abi, provider) as any
    const isValidSigforv2 = await contractV2.isValidSignature(hash, eip712Sig.slice(0, 134))
    expect(isValidSigforv2).toBe(contractSuccess)

    // v1 account
    const contract = new Contract(v1Account.addr, AmbireAccount.abi, provider) as any
    const isValidSig = await contract.isValidSignature(hash, eip712Sig)
    expect(isValidSig).toBe(contractSuccess)

    // verify message should pass
    const res = await verifyMessage({
      provider,
      signer: v1Account.addr,
      signature: eip712Sig,
      typedData
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA, V2 Signer]: signing a normal EIP-712 request', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const v2AccountState = accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!
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
      provider,
      signer: v1Account.addr,
      signature: wrappedSig,
      typedData
    })
    expect(res).toBe(true)
  })
  test('Signing [V1 SA, V2 Signer]: plain text', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const v2AccountState = accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!
    const signer = await keystore.getSigner(eoaSigner.keyPublicAddress, 'internal')

    const signatureForPlainText = await getPlainTextSignature(
      hexlify(toUtf8Bytes('test')) as Hex,
      polygonNetwork,
      smartAccount,
      v2AccountState,
      signer
    )
    expect(signatureForPlainText.signature.slice(-2)).toEqual('00')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const wrappedSig = wrapWallet(signatureForPlainText.signature, smartAccount.addr)

    const res = await verifyMessage({
      provider,
      signer: v1Account.addr,
      signature: wrappedSig,
      message: 'test'
    })
    expect(res).toBe(true)
  })

  test('Signing [V1 SA, V2 Signer]: a request for an AmbireReadableOperation should revert if the execution address is the same (signing for the current wallet instead of a diff wallet)', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const v2AccountState = accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!
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

    const signature = await signer.sign7702({
      chainId: 1n,
      contract: EIP_7702_AMBIRE_ACCOUNT,
      nonce: 0n
    })
    const provider = getRpcProvider(ethereumNetwork.rpcUrls, ethereumNetwork.chainId)
    const authorizationHash = getAuthorizationHash(1n, EIP_7702_AMBIRE_ACCOUNT, 0n)
    const authorizationRes = await verifyMessage({
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: getVerifyMessageSignature(
        signature,
        eoaAccount,
        accountStates[eoaAccount.addr]![ethereumNetwork.chainId.toString()]!
      ),
      authorization: authorizationHash
    })
    expect(authorizationRes).toBe(true)

    const signature2 = await signer.sign7702({
      chainId: 1n,
      contract: EIP_7702_AMBIRE_ACCOUNT,
      // increment the nonce to be sure 'v' transform is working
      nonce: 1n
    })
    const authorizationHash2 = getAuthorizationHash(1n, EIP_7702_AMBIRE_ACCOUNT, 1n)
    const authorizationRes2 = await verifyMessage({
      provider,
      signer: eoaSigner.keyPublicAddress,
      signature: getVerifyMessageSignature(
        signature2,
        eoaAccount,
        accountStates[eoaAccount.addr]![ethereumNetwork.chainId.toString()]!
      ),
      authorization: authorizationHash2
    })
    expect(authorizationRes2).toBe(true)
  })
  test("Signing [EOA, hacked delegation]: Sign successfully on ethereum with an EOA with a hacked delegation - it should succeed as the private key's signature is respected", async () => {
    const accountStates = await getAccountsInfo([eoaAccountHackedDelegation])
    const accountState =
      accountStates[eoaAccountHackedDelegation.addr]![ethereumNetwork.chainId.toString()]!
    const signer = await keystore.getSigner(
      eoaAccountHackedDelegation.associatedKeys[0]!,
      'internal'
    )

    const signatureForPlainText = await getPlainTextSignature(
      hexlify(toUtf8Bytes('test')) as Hex,
      ethereumNetwork,
      eoaAccountHackedDelegation,
      accountState,
      signer
    )
    const provider = getRpcProvider(ethereumNetwork.rpcUrls, ethereumNetwork.chainId)
    const firstRes = await verifyMessage({
      provider,
      signer: eoaAccountHackedDelegation.addr,
      signature: signatureForPlainText.signature,
      message: 'test'
    })
    expect(firstRes).toBe(true)
  })
})

describe('Sign Message, Keystore with key dedicatedToOneSA: false', () => {
  beforeAll(async () => {
    const storage: Storage = produceMemoryStore()
    const storageCtrl = new StorageController(storage)
    const { uiManager } = mockUiManager()
    const uiCtrl = new UiController({ uiManager })
    keystore = new KeystoreController('default', storageCtrl, { internal: KeystoreSigner }, uiCtrl)
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
      hexlify(toUtf8Bytes('test')) as Hex,
      polygonNetwork,
      smartAccount,
      accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!,
      signer
    )
    // the key should not be dedicatedToOneSA, so we expect the signature to end in 01
    expect(signatureForPlainText.signature.slice(-2)).toEqual('01')

    const provider = getRpcProvider(polygonNetwork.rpcUrls, polygonNetwork.chainId)
    const contract = new Contract(smartAccount.addr, AmbireAccount.abi, provider) as any
    const isValidSig = await contract.isValidSignature(
      hashMessage('test'),
      signatureForPlainText.signature
    )
    expect(isValidSig).toBe(contractSuccess)

    const res = await verifyMessage({
      provider,
      signer: smartAccount.addr,
      signature: signatureForPlainText.signature,
      message: 'test'
    })
    expect(res).toBe(true)
  })
  test('Signing [Not dedicated to one SA]: eip-712, should throw an error', async () => {
    const accountStates = await getAccountsInfo([smartAccount])
    const accountState = accountStates[smartAccount.addr]![polygonNetwork.chainId.toString()]!
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

describe('Sign Message, Safe accounts', () => {
  beforeAll(async () => {
    const storage: Storage = produceMemoryStore()
    const storageCtrl = new StorageController(storage)
    const { uiManager } = mockUiManager()
    const uiCtrl = new UiController({ uiManager })
    keystore = new KeystoreController('default', storageCtrl, { internal: KeystoreSigner }, uiCtrl)
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
  test('Signing [Safe]: txn typed data', async () => {
    const safeTxn = {
      baseGas: toBeHex(0) as Hex,
      data: '0xa9059cbb0000000000000000000000005d8dd39a360e5d5219f965695f9c0290862ca24a0000000000000000000000000000000000000000000000000000000000002710' as Hex,
      gasPrice: toBeHex(0) as Hex,
      gasToken: '0x0000000000000000000000000000000000000000' as Hex,
      nonce: toBeHex(4n) as Hex,
      operation: 0,
      refundReceiver: '0x0000000000000000000000000000000000000000' as Hex,
      safeTxGas: toBeHex(0) as Hex,
      to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Hex,
      value: toBeHex(0) as Hex
    }
    const safeAddr = '0x8c8979A7d79C4CdDA170C008b797d466F00dD167'
    const baseProvider = new JsonRpcProvider('https://invictus.ambire.com/base')
    const safeContract = new Contract(safeAddr, Safe, baseProvider) as any
    const validHash = await safeContract.getTransactionHash(
      safeTxn.to,
      safeTxn.value,
      safeTxn.data,
      safeTxn.operation,
      safeTxn.safeTxGas,
      safeTxn.baseGas,
      safeTxn.gasPrice,
      safeTxn.gasToken,
      safeTxn.refundReceiver,
      safeTxn.nonce
    )

    const typedData = getSafeTypedData(8453n, safeAddr, safeTxn)
    const ourHash = TypedDataUtils.eip712Hash(
      adaptTypedMessageForMetaMaskSigUtil({ ...typedData }),
      SignTypedDataVersion.V4
    ).toString('hex')

    expect(`0x${ourHash}`).toBe(validHash)

    const sigs = [
      '0x3c43f96c5b4ad0d4ceb4ee7eee107bc68b602c50a79dac4ba673a2619ac27032296a168c06f455930c69a85ad96a29de3d79f7691ca9cb424b03f953045b9aac1b',
      '0x2d747b2ede426ccaa6de4fa561df8f893df3308757d719077facd35e718316fd07c26b41df74b0669f993bdc40e247937c208041d22f69b867e1d601807cc5611c'
    ]
    delete typedData.types.EIP712Domain
    const recovered = recoverAddress(
      validHash,
      '0x3c43f96c5b4ad0d4ceb4ee7eee107bc68b602c50a79dac4ba673a2619ac27032296a168c06f455930c69a85ad96a29de3d79f7691ca9cb424b03f953045b9aac1b'
    )
    const isOwnerOne = await safeContract.isOwner(recovered)
    expect(isOwnerOne).toBe(true)

    const recovered2 = recoverAddress(
      validHash,
      '0x2d747b2ede426ccaa6de4fa561df8f893df3308757d719077facd35e718316fd07c26b41df74b0669f993bdc40e247937c208041d22f69b867e1d601807cc5611c'
    )
    const isOwnerTwo = await safeContract.isOwner(recovered2)
    expect(isOwnerTwo).toBe(true)

    const signature = concat(sigs)
    await safeContract.checkNSignatures(validHash, '0x', signature, 2)
    // not reverting here means success
  })
  test('Signing [Safe]: sign plain text message', async () => {
    const safeAddr = '0x8c8979A7d79C4CdDA170C008b797d466F00dD167'
    const baseProvider = new JsonRpcProvider('https://invictus.ambire.com/base')
    const msg = hexlify(toUtf8Bytes('testesetgs'))
    const hash = hashMessage(getBytes(msg))
    const isValidSigAbi = ['function isValidSignature(bytes32, bytes) public view returns (bytes4)']
    const isValidSigInt = new Interface(isValidSigAbi)
    const encodedData = isValidSigInt.encodeFunctionData('isValidSignature', [
      hash,
      '0x7ebeaeca3f7ed26bf23dd512f1abd9f174cfff98e41edffab851cb5beb31836574706c90e16ec80e07d03b6174966a4b0fb6ec99555871f11668a2a054c1ee5e1bff22d35ecef7ffaf72e2ab8ae27b21d803facdde1bc892ed6b0b7df6199aad5c7e792845c6c98dfb652ac252707e0e3e43d4091a62049a3556bec7cb978450be1b'
    ])
    const validHash = await baseProvider.call({
      to: safeAddr,
      data: encodedData
    })
    expect(validHash.substring(0, 10)).toBe('0x1626ba7e')
  })
})
