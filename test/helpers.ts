import { BaseContract, JsonRpcProvider } from 'ethers'
import { ethers } from 'hardhat'

import { Account, AccountStates } from '../src/interfaces/account'
import { NetworkDescriptor } from '../src/interfaces/networkDescriptor'
import { RPCProviders } from '../src/interfaces/settings'
import { Storage } from '../src/interfaces/storage'
import { getAccountState } from '../src/libs/accountState/accountState'
import { parse, stringify } from '../src/libs/richJson/richJson'
import { wrapEthSign, wrapTypedData } from './ambireSign'
import { abiCoder, addressOne, addressTwo, AmbireAccount, chainId } from './config'

async function sendFunds(to: string, ether: number) {
  const [signer] = await ethers.getSigners()
  await signer.sendTransaction({
    to,
    value: ethers.parseEther(ether.toString())
  })
}

function getPriviledgeTxn(ambireAccountAddr: string, privAddress: string, hasPriv: boolean = true) {
  const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const priv = hasPriv ? 1 : 0
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [
    privAddress,
    ethers.toBeHex(priv, 32)
  ])
  return [ambireAccountAddr, 0, calldata]
}

function getPriviledgeTxnWithCustomHash(
  ambireAccountAddr: string,
  privAddress: string,
  privHash: string
) {
  const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [privAddress, privHash])
  return [ambireAccountAddr, 0, calldata]
}

const timelock = 1 // a 1 second timelock default
const defaultRecoveryInfo = [[addressOne, addressTwo], timelock]
function getTimelockData(recoveryInfo = defaultRecoveryInfo) {
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [recoveryInfo]))
  const timelockAddress = `0x${hash.slice(hash.length - 40, hash.length)}`
  return { hash, timelockAddress }
}

async function getNonce(ambireAccountAddr: string, provider: JsonRpcProvider) {
  const accountContract = new ethers.Contract(ambireAccountAddr, AmbireAccount.abi, provider)
  return accountContract.nonce()
}

function getDKIMValidatorData(parsedContents: any, signer: any, options: any = {}) {
  const emptySecondSig = options.emptySecondSig ?? false
  const acceptEmptyDKIMSig = options.acceptEmptyDKIMSig ?? false
  const onlyOneSigTimelock = options.onlyOneSigTimelock ?? 0
  const acceptUnknownSelectors = options.acceptUnknownSelectors ?? false
  const emailFrom = options.emailFrom ?? 'tt469695@gmail.com'
  const emailTo = options.emailTo ?? 'adamcrein@gmail.com'
  const selector = options.selector ?? `${parsedContents[0].selector}._domainkey.gmail.com`

  if (options.plain) {
    return [
      emailFrom,
      emailTo,
      selector,
      ethers.hexlify(parsedContents[0].modulus),
      ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      signer.address,
      acceptUnknownSelectors,
      0,
      0,
      acceptEmptyDKIMSig,
      emptySecondSig,
      onlyOneSigTimelock
    ]
  }

  return abiCoder.encode(
    ['tuple(string,string,string,bytes,bytes,address,bool,uint32,uint32,bool,bool,uint32)'],
    [
      [
        emailFrom,
        emailTo,
        selector,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
        signer.address,
        acceptUnknownSelectors,
        0,
        0,
        acceptEmptyDKIMSig,
        emptySecondSig,
        onlyOneSigTimelock
      ]
    ]
  )
}

function getSignerKey(validatorAddr: any, validatorData: any) {
  const hash = ethers.keccak256(
    abiCoder.encode(['address', 'bytes'], [validatorAddr, validatorData])
  )
  const signerKey = `0x${hash.slice(hash.length - 40, hash.length)}`
  return { signerKey, hash }
}

function produceMemoryStore(): Storage {
  const storage = new Map()

  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, stringify(value))
      return Promise.resolve(null)
    }
  }
}

function getAccountGasLimits(verificationGasLimit: number, callGasLimit: number) {
  return ethers.concat([ethers.toBeHex(verificationGasLimit, 16), ethers.toBeHex(callGasLimit, 16)])
}

function getGasFees(maxPriorityFeePerGas: number, maxFeePerGas: number) {
  return ethers.concat([ethers.toBeHex(maxPriorityFeePerGas, 16), ethers.toBeHex(maxFeePerGas, 16)])
}

async function buildUserOp(paymaster: BaseContract, entryPointAddr: string, options: any = {}) {
  const [relayer, sender] = await ethers.getSigners()

  const userOp = {
    sender: options.sender ?? sender.address,
    nonce: options.userOpNonce ?? ethers.toBeHex(0, 1),
    initCode: options.initCode ?? '0x',
    callData: options.callData ?? '0x',
    accountGasLimits: getAccountGasLimits(400000, options.callGasLimit ?? 500000),
    preVerificationGas: 500000n,
    gasFees: getGasFees(300000, 200000),
    paymasterAndData: '0x',
    signature: '0x'
  }
  const validUntil = options.validUntil ?? 0
  const validAfter = options.validAfter ?? 0
  const hash = ethers.keccak256(
    abiCoder.encode(
      [
        'uint256',
        'address',
        'address',
        'uint48',
        'uint48',
        'address',
        'uint256',
        'bytes',
        'bytes',
        'bytes32',
        'uint256',
        'bytes32'
      ],
      [
        options.chainId ?? 31337n,
        await paymaster.getAddress(),
        entryPointAddr,
        validUntil,
        validAfter,
        userOp.sender,
        options.signedNonce ?? userOp.nonce,
        userOp.initCode,
        userOp.callData,
        userOp.accountGasLimits,
        userOp.preVerificationGas,
        userOp.gasFees
      ]
    )
  )
  const typedData = wrapTypedData(chainId, await paymaster.getAddress(), hash)
  const signature = wrapEthSign(
    await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
  )

  // abi.decode(userOp.paymasterAndData[20:], (uint48, uint48, bytes))
  const paymasterData = abiCoder.encode(
    ['uint48', 'uint48', 'bytes'],
    [validUntil, validAfter, signature]
  )
  const paymasterVerificationGasLimit = ethers.toBeHex(400000, 16)
  const paymasterPostOp = ethers.toBeHex(0, 16)
  const paymasterAndData = ethers.hexlify(
    ethers.concat([
      await paymaster.getAddress(),
      paymasterVerificationGasLimit,
      paymasterPostOp,
      paymasterData
    ])
  )

  userOp.paymasterAndData = paymasterAndData
  return userOp
}

function getTargetNonce(userOperation: any) {
  return `0x${ethers
    .keccak256(
      abiCoder.encode(
        ['bytes', 'bytes', 'bytes32', 'uint256', 'bytes32', 'bytes'],
        [
          userOperation.initCode,
          userOperation.callData,
          userOperation.accountGasLimits,
          userOperation.preVerificationGas,
          userOperation.gasFees,
          userOperation.paymasterAndData
        ]
      )
    )
    .substring(18)}${ethers.toBeHex(0, 8).substring(2)}`
}

const getAccountsInfo = async (
  networks: NetworkDescriptor[],
  providers: RPCProviders,
  accounts: Account[]
): Promise<AccountStates> => {
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

export {
  sendFunds,
  getPriviledgeTxn,
  getTimelockData,
  getNonce,
  getDKIMValidatorData,
  getSignerKey,
  produceMemoryStore,
  getPriviledgeTxnWithCustomHash,
  buildUserOp,
  getTargetNonce,
  getAccountsInfo,
  getAccountGasLimits,
  getGasFees
}
