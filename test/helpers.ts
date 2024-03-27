import { BaseContract, FallbackProvider, JsonRpcProvider } from 'ethers'
import { ethers } from 'hardhat'

import { Storage } from '../src/interfaces/storage'
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

async function getNonce(ambireAccountAddr: string, provider: JsonRpcProvider | FallbackProvider) {
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

async function buildUserOp(paymaster: BaseContract, entryPointAddr: string, options: any = {}) {
  const [relayer, sender] = await ethers.getSigners()

  const userOp = {
    sender: options.sender ?? sender.address,
    nonce: options.userOpNonce ?? ethers.toBeHex(0, 1),
    initCode: options.initCode ?? '0x',
    callData: options.callData ?? '0x',
    callGasLimit: options.callGasLimit ?? ethers.toBeHex(500000),
    verificationGasLimit: ethers.toBeHex(500000),
    preVerificationGas: ethers.toBeHex(500000),
    maxFeePerGas: ethers.toBeHex(500000),
    maxPriorityFeePerGas: ethers.toBeHex(500000),
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
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256'
      ],
      [
        options.chainId ?? 31337,
        await paymaster.getAddress(),
        entryPointAddr,
        validUntil,
        validAfter,
        userOp.sender,
        options.signedNonce ?? userOp.nonce,
        userOp.initCode,
        userOp.callData,
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas
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
  const paymasterAndData = ethers.hexlify(
    ethers.concat([await paymaster.getAddress(), paymasterData])
  )
  // (uint48 validUntil, uint48 validAfter, bytes memory signature) = abi.decode(userOp.paymasterAndData[20:], (uint48, uint48, bytes));

  userOp.paymasterAndData = paymasterAndData
  return userOp
}

function getTargetNonce(userOperation: any) {
  return `0x${ethers
    .keccak256(
      abiCoder.encode(
        ['bytes', 'bytes', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes'],
        [
          userOperation.initCode,
          userOperation.callData,
          userOperation.callGasLimit,
          userOperation.verificationGasLimit,
          userOperation.preVerificationGas,
          userOperation.maxFeePerGas,
          userOperation.maxPriorityFeePerGas,
          userOperation.paymasterAndData
        ]
      )
    )
    .substring(18)}${ethers.toBeHex(0, 8).substring(2)}`
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
  getTargetNonce
}
