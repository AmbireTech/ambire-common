import { ethers } from 'hardhat'
import { wrapEthSign } from '../../test/ambireSign'
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from '../../src/libs/proxyDeploy/deploy'
import { BaseContract } from 'ethers'
import { abiCoder } from '../config'
import { buildUserOp, getPriviledgeTxn } from '../helpers'

const salt = '0x0'

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(factoryAddress, ethers.toBeHex(salt, 32), ethers.keccak256(bytecode))
}

function getDeployCalldata(bytecodeWithArgs: string, txns: any, sig: string) {
  const abi = ['function deployAndExecute(bytes calldata code, uint256 salt, tuple(address, uint256, bytes)[] calldata txns, bytes calldata signature) external returns (address)']
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('deployAndExecute', [
    bytecodeWithArgs,
    salt,
    txns,
    sig
  ])
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

describe('ERC-4337 deploys the account via userOp and add the entry point permissions in the initCode', function () {
  before('deploy the necessary contracts', async function(){
    const [relayer] = await ethers.getSigners()
    factory = await ethers.deployContract('AmbireAccountFactory', [relayer.address])
    paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
    entryPoint = await ethers.deployContract('EntryPointPaymaster')
  })
  it('successfully deploys the account with entry point without a userOp signature', async function () {
    const [relayer, signer] = await ethers.getSigners()
    const privs = [
      { addr: signer.address, hash: true },
    ]
    const bytecodeWithArgs = await get4437Bytecode(privs)
    const senderAddress = getAmbireAccountAddress(await factory.getAddress(), bytecodeWithArgs)
    // const ambireAccount = new ethers.Contract(senderAddress, AMBIRE_ACCOUNT.abi)
    const txn = getPriviledgeTxn(senderAddress, await entryPoint.getAddress(), true)
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
      getDeployCalldata(bytecodeWithArgs, [txn], s)
    ]))
    const userOperation = buildUserOp(paymaster, {
      sender: senderAddress,
      userOpNonce: '0x', // todo: craft nonce
      signedNonce: ethers.toBeHex(0, 1),
      initCode,
      callData: '0x', // set this
    })
    await entryPoint.handleOps([userOperation], relayer)

    // confirm everything is set by sending another userOp
    // const anotherTxn = [senderAddress, 0, '0x68656c6c6f']
    // const userOperation2 = {
    //   sender: senderAddress,
    //   nonce: ethers.toBeHex(await entryPoint.getNonce(senderAddress, 0), 1),
    //   initCode: '0x',
    //   callData: ambireAccount.interface.encodeFunctionData('executeBySender', [[anotherTxn]]),
    //   callGasLimit: ethers.toBeHex(100000),
    //   verificationGasLimit: ethers.toBeHex(500000),
    //   preVerificationGas: ethers.toBeHex(50000),
    //   maxFeePerGas: ethers.toBeHex(100000),
    //   maxPriorityFeePerGas: ethers.toBeHex(100000),
    //   paymasterAndData: '0x',
    //   signature: '0x'
    // }
    // const signature = wrapEthSign(await signer.signMessage(
    //   ethers.getBytes(await entryPoint.getUserOpHash(userOperation2))
    // ))
    // userOperation2.signature = signature
    // await entryPoint.handleOps([userOperation2], relayer)
    // if it doesn't revert here, everything is good
  })
})
