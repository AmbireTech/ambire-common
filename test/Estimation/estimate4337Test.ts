import { ethers } from 'hardhat'
import { abiCoder, expect, provider } from '../config'
import { getPriviledgeTxnWithCustomHash } from '../helpers'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import AmbireAccountFactory from '../../artifacts/contracts/AmbireAccountFactory.sol/AmbireAccountFactory.json'
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from '../../src/libs/proxyDeploy/deploy'
import { BaseContract } from 'ethers'
import { ENTRY_POINT_MARKER } from '../../src/consts/deploy'

const ENTRY_POINT_PRIV = '0x0000000000000000000000000000000000000000000000000000000000007171'
const SPOOF_SIGTYPE = '03'
const SPOOFER = '0x0000000000000000000000000000000000000001'
let estimation: any
let ambireAccount: any
let entryPoint: any
let ambireAccountAddress: any
let paymaster: any

const salt = '0x0000000000000000000000000000000000000000000000000000000000000000'

export async function get4437Bytecode(
  priLevels: PrivLevels[]
): Promise<string> {
  const contract: BaseContract = await ethers.deployContract('AmbireAccount')

  // get the bytecode and deploy it
  return getProxyDeployBytecode(await contract.getAddress(), priLevels, {
    ...getStorageSlotsFromArtifact(null)
  })
}

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(factoryAddress, salt, ethers.keccak256(bytecode))
}

describe('Estimate 4337 Tests', function () {
  before('successfully deploys the contracts', async function () {
    const [signer, relayer] = await ethers.getSigners()
    estimation = await ethers.deployContract('Estimation4337')
    entryPoint = await ethers.deployContract('EntryPoint')
    paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
    const { ambireAccount: acc } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true }
    ])
    ambireAccount = acc
    ambireAccountAddress = await ambireAccount.getAddress()
    const txn = getPriviledgeTxnWithCustomHash(ambireAccountAddress, await entryPoint.getAddress(), ENTRY_POINT_PRIV)
    await signer.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: ambireAccount.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await ambireAccount.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal('0000000000000000000000000000000000007171')

    // ambireAccountAddress funds
    await signer.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    // paymaster deposit
    await entryPoint.depositTo(await paymaster.getAddress(), {
      value: ethers.parseEther('1')
    })
  })
  it('successfully performs an estimation', async function () {
    const [,relayer,signer3] = await ethers.getSigners()
    const txns = [
      [relayer.address, ethers.parseEther('0.001'), '0x'],
      [signer3.address, ethers.parseEther('0.001'), '0x']
    ]

    const spoofSig = abiCoder.encode(['address'], [await relayer.getAddress()]) + SPOOF_SIGTYPE
    const simulationData = abiCoder.encode(
      ['uint48', 'uint48', 'bytes'],
      [0, 0, spoofSig]
    )
    const paymasterSimulationData = ethers.hexlify(ethers.concat([
      await paymaster.getAddress(),
      simulationData
    ]))

    const callData = ambireAccount.interface.encodeFunctionData('executeBySender', [txns])

    const FIXED_OVERHEAD = 25000n
    const bytes = Buffer.from(callData.substring(2))
    const nonZeroBytes = BigInt(bytes.filter(b => b).length)
    const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
    const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n
    const pvg = txDataGas + FIXED_OVERHEAD

    const userOp = {
      sender: ambireAccountAddress,
      nonce: ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1),
      initCode: '0x',
      callData,
      preVerificationGas: ethers.toBeHex(pvg),
      verificationGasLimit: ethers.toBeHex(500000),
      callGasLimit: ethers.toBeHex(500000),
      maxFeePerGas: ethers.toBeHex(500000),
      maxPriorityFeePerGas: ethers.toBeHex(500000),
      paymasterAndData: paymasterSimulationData,
      signature: '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
    }
    const result = await provider.call({
      to: await estimation.getAddress(),
      data: estimation.interface.encodeFunctionData('estimate', [userOp, await entryPoint.getAddress()]),
      from: SPOOFER
    })
    // verificationGasLimit, gasUsed, failure
    const decoded = estimation.interface.decodeFunctionResult('estimate', result)[0]
    expect(decoded[2]).to.equal('0x')
  })
  it('successfully performs an estimation on an account that is yet to be deployed', async function () {
    const [,relayer,signer3] = await ethers.getSigners()
    const factory = await ethers.deployContract('AmbireAccountFactory', [relayer.address])
    const txns = [
      [relayer.address, ethers.parseEther('0.001'), '0x'],
      [signer3.address, ethers.parseEther('0.001'), '0x']
    ]

    const spoofSig = abiCoder.encode(['address'], [await relayer.getAddress()]) + SPOOF_SIGTYPE
    const simulationData = abiCoder.encode(
      ['uint48', 'uint48', 'bytes'],
      [0, 0, spoofSig]
    )
    const paymasterSimulationData = ethers.hexlify(ethers.concat([
      await paymaster.getAddress(),
      simulationData
    ]))

    const callData = ambireAccount.interface.encodeFunctionData('executeBySender', [txns])

    const FIXED_OVERHEAD = 25000n
    const bytes = Buffer.from(callData.substring(2))
    const nonZeroBytes = BigInt(bytes.filter(b => b).length)
    const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes)
    const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n
    const pvg = txDataGas + FIXED_OVERHEAD

    const ambireAccountFactory = new ethers.BaseContract(
      await factory.getAddress(),
      AmbireAccountFactory.abi,
    )
    const privs = [
      { addr: relayer.address, hash: true },
      { addr: await entryPoint.getAddress(), hash: ENTRY_POINT_MARKER },
    ]
    const bytecode = await get4437Bytecode(privs)
    const senderAddress = getAmbireAccountAddress(await factory.getAddress(), bytecode)
    const initCode = ethers.hexlify(ethers.concat([
      await factory.getAddress(),
      ambireAccountFactory.interface.encodeFunctionData(
        'deploy',
        [bytecode, salt]
      )
    ]))

    const userOp = {
      sender: senderAddress,
      nonce: ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1),
      initCode,
      callData,
      preVerificationGas: ethers.toBeHex(pvg),
      verificationGasLimit: ethers.toBeHex(500000),
      callGasLimit: ethers.toBeHex(500000),
      maxFeePerGas: ethers.toBeHex(500000),
      maxPriorityFeePerGas: ethers.toBeHex(500000),
      paymasterAndData: paymasterSimulationData,
      signature: '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
    }
    const result = await provider.call({
      to: await estimation.getAddress(),
      data: estimation.interface.encodeFunctionData('estimate', [userOp, await entryPoint.getAddress()]),
      from: SPOOFER
    })
    // verificationGasLimit, gasUsed, failure
    const decoded = estimation.interface.decodeFunctionResult('estimate', result)[0]
    expect(decoded[2]).to.equal('0x')
  })
})