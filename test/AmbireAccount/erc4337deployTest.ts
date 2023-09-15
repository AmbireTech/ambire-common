import { ethers } from 'hardhat'
import { wrapEthSign } from '../../test/ambireSign'
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from '../../src/libs/proxyDeploy/deploy'
import { BaseContract } from 'ethers'
import { abiCoder } from '../config'
import { buildUserOp, getPriviledgeTxn, getPriviledgeTxnWithCustomHash } from '../helpers'

const salt = '0x0'

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(factoryAddress, ethers.toBeHex(salt, 32), ethers.keccak256(bytecode))
}

function getDeployCalldata(bytecodeWithArgs: string) {
  const abi = ['function deploy(bytes calldata code, uint256 salt) external returns(address)']
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('deploy', [bytecodeWithArgs, salt])
}

function leftShift (a: any, n: any, fillWith = 0) {
  const padding = fillWith ? 0xff : 0x00
  const mod = n & 7 // n % 8
  const div = n >> 3 // Math.floor(n / 8)

  const dest = Buffer.allocUnsafe(a.length)

  let i = 0

  while (i + div + 1 < a.length) {
    dest[i] = (a[i + div] << mod) | (a[i + div + 1] >> (8 - mod))
    i += 1
  }

  dest[i] = (a[i + div] << mod) | (padding >> (8 - mod))
  i += 1

  while (i < a.length) {
    dest[i] = padding
    i += 1
  }

  return dest
}

export async function get4437Bytecode(
  priLevels: PrivLevels[]
): Promise<string> {
  const contract: BaseContract = await ethers.deployContract('AmbireAccount')
  
  // get the bytecode and deploy it
  return getProxyDeployBytecode(await contract.getAddress(), priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}

let factory: any
let paymaster: any
let entryPoint: any
let proxy: any

describe('ERC-4337 deploys the account via userOp and adds the entry point permissions in the initCode', function () {
  before('deploy the necessary contracts and adds an entry point deposit for the paymaster', async function(){
    const [relayer] = await ethers.getSigners()
    factory = await ethers.deployContract('AmbireAccountFactory', [relayer.address])
    paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
    entryPoint = await ethers.deployContract('EntryPointPaymaster', relayer)
    proxy = await ethers.deployContract('AmbireAccount')

    // paymaster deposit
    await entryPoint.depositTo(await paymaster.getAddress(), {
      value: ethers.parseEther('1')
    })
  })
  it('successfully deploys the account with entry point without a userOp signature', async function () {
    const [relayer, signer] = await ethers.getSigners()
    const privs = [
      { addr: signer.address, hash: true },
    ]
    const bytecodeWithArgs = await get4437Bytecode(privs)
    const senderAddress = getAmbireAccountAddress(await factory.getAddress(), bytecodeWithArgs)
    const txn = getPriviledgeTxnWithCustomHash(
      senderAddress,
      await entryPoint.getAddress(),
      '0x0000000000000000000000000000000000000000000000000000000000007171'
    )
    const msg = ethers.getBytes(
      ethers.keccak256(
        abiCoder.encode(
          ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
          [senderAddress, 31337, 0, [txn]]
        )
      )
    )
    const s = wrapEthSign(await signer.signMessage(msg))
    const initCode = ethers.hexlify(ethers.concat([
      await factory.getAddress(),
      getDeployCalldata(bytecodeWithArgs)
    ]))

    const callData = proxy.interface.encodeFunctionData('execute', [[txn], s])
    const userOperation = await buildUserOp(paymaster, {
      sender: senderAddress,
      signedNonce: ethers.toBeHex(0, 1),
      initCode,
      callData
    })

    const uint192Number = Buffer.from(ethers.keccak256(
      abiCoder.encode([
        'bytes',
        'bytes',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes',
      ], [
        userOperation.initCode,
        userOperation.callData,
        userOperation.callGasLimit,
        userOperation.verificationGasLimit,
        userOperation.preVerificationGas,
        userOperation.maxFeePerGas,
        userOperation.maxPriorityFeePerGas,
        userOperation.paymasterAndData,
      ])
    ).substring(18), 'hex')
    const leftShifting = Buffer.from('64')
    const targetNonce = ethers.hexlify(leftShift(uint192Number, leftShifting))

    userOperation.nonce = targetNonce
    await entryPoint.handleOps([userOperation], relayer)

    // prefund the payment
    await entryPoint.depositTo(senderAddress, {
      value: ethers.parseEther('1')
    })

    // confirm everything is set by sending an userOp through the entry point
    const anotherTxn = [senderAddress, 0, '0x68656c6c6f']
    const userOperation2 = {
      sender: senderAddress,
      nonce: ethers.toBeHex(await entryPoint.getNonce(senderAddress, 0), 1),
      initCode: '0x',
      callData: proxy.interface.encodeFunctionData('executeBySender', [[anotherTxn]]),
      callGasLimit: ethers.toBeHex(100000),
      verificationGasLimit: ethers.toBeHex(500000),
      preVerificationGas: ethers.toBeHex(50000),
      maxFeePerGas: ethers.toBeHex(100000),
      maxPriorityFeePerGas: ethers.toBeHex(100000),
      paymasterAndData: '0x',
      signature: '0x'
    }
    const signature = wrapEthSign(await signer.signMessage(
      ethers.getBytes(await entryPoint.getUserOpHash(userOperation2))
    ))
    userOperation2.signature = signature
    await entryPoint.handleOps([userOperation2], relayer)
    // if it doesn't revert, all's good
  })
})
