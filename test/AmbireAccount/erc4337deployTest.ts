import { ethers } from 'hardhat'
import { wrapEthSign } from '../../test/ambireSign'
import { PrivLevels, getProxyDeployBytecode, getStorageSlotsFromArtifact } from '../../src/libs/proxyDeploy/deploy'
import { BaseContract } from 'ethers'
import { abiCoder, expect, provider } from '../config'
import { buildUserOp, getPriviledgeTxnWithCustomHash, getTargetNonce } from '../helpers'

const salt = '0x0'

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(factoryAddress, ethers.toBeHex(salt, 32), ethers.keccak256(bytecode))
}

function getDeployCalldata(bytecodeWithArgs: string) {
  const abi = ['function deploy(bytes calldata code, uint256 salt) external returns(address)']
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('deploy', [bytecodeWithArgs, salt])
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
    entryPoint = await ethers.deployContract('EntryPoint', relayer)
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

    const callData = proxy.interface.encodeFunctionData('executeMultiple', [[[[txn], s]]])
    const userOperation = await buildUserOp(paymaster, {
      sender: senderAddress,
      signedNonce: ethers.toBeHex(0, 1),
      initCode,
      callData
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await entryPoint.handleOps([userOperation], relayer)

    // confirm everything is set by sending an userOp through the entry point
    // with a normal paymaster signature
    const nextTxn = [senderAddress, 0, '0x68656c6c6f']
    const userOperation2 = await buildUserOp(paymaster, {
      sender: senderAddress,
      userOpNonce: ethers.toBeHex(await entryPoint.getNonce(senderAddress, 0), 1),
      callData: proxy.interface.encodeFunctionData('executeBySender', [[nextTxn]]),
    })
    const signature = wrapEthSign(await signer.signMessage(
      ethers.getBytes(await entryPoint.getUserOpHash(userOperation2))
    ))
    userOperation2.signature = signature
    await entryPoint.handleOps([userOperation2], relayer)
    // if it doesn't revert, all's good. The paymaster has payed

    // send money to senderAddress so it has funds to pay for the transaction
    await relayer.sendTransaction({
      to: senderAddress,
      value: ethers.parseEther('1')
    })
    const balance = await provider.getBalance(senderAddress)

    // send a txn with no paymasterAndData. Because the addr has a prefund,
    // it should be able to pass
    const anotherTxn = [senderAddress, 0, '0x68656c6c6f']
    const userOperation3 = {
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
    const sig = wrapEthSign(await signer.signMessage(
      ethers.getBytes(await entryPoint.getUserOpHash(userOperation3))
    ))
    userOperation3.signature = sig
    await entryPoint.handleOps([userOperation3], relayer)

    const balanceAfterPayment = await provider.getBalance(senderAddress)
    expect(balance).to.be.greaterThan(balanceAfterPayment)

    // prefund the payment
    await entryPoint.depositTo(senderAddress, {
      value: ethers.parseEther('1')
    })

    const userOperation4 = {
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
    const sigLatest = wrapEthSign(await signer.signMessage(
      ethers.getBytes(await entryPoint.getUserOpHash(userOperation4))
    ))
    userOperation4.signature = sigLatest
    await entryPoint.handleOps([userOperation4], relayer)

    const balanceShouldNotHaveChanged = await provider.getBalance(senderAddress)
    expect(balanceAfterPayment).to.equal(balanceShouldNotHaveChanged)
  })
})
