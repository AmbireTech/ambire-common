import { BaseContract } from 'ethers'
import { ethers } from 'hardhat'

import {
  getProxyDeployBytecode,
  getStorageSlotsFromArtifact,
  PrivLevels
} from '../../src/libs/proxyDeploy/deploy'
import { wrapEthSign, wrapTypedData } from '../ambireSign'
import { abiCoder, chainId, expect, provider } from '../config'
import {
  buildUserOp,
  getAccountGasLimits,
  getGasFees,
  getPriviledgeTxnWithCustomHash,
  getTargetNonce
} from '../helpers'

const salt = '0x0'

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(
    factoryAddress,
    ethers.toBeHex(salt, 32),
    ethers.keccak256(bytecode)
  )
}

function getDeployCalldata(bytecodeWithArgs: string) {
  const abi = ['function deploy(bytes calldata code, uint256 salt) external returns(address)']
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('deploy', [bytecodeWithArgs, salt])
}

export async function get4437Bytecode(priLevels: PrivLevels[]): Promise<string> {
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

describe('ERC-4337 deploys the account via userOp and adds the entry point permissions in the initCode', () => {
  before(
    'deploy the necessary contracts and adds an entry point deposit for the paymaster',
    async () => {
      const [relayer] = await ethers.getSigners()
      factory = await ethers.deployContract('AmbireFactory', [relayer.address])
      paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
      entryPoint = await ethers.deployContract('EntryPoint', relayer)
      proxy = await ethers.deployContract('AmbireAccount')

      // paymaster deposit
      await entryPoint.depositTo(await paymaster.getAddress(), {
        value: ethers.parseEther('1')
      })
    }
  )
  it('successfully deploys the account with entry point without a userOp signature', async () => {
    const [relayer, signer] = await ethers.getSigners()
    const privs = [
      {
        addr: signer.address,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    ]
    const bytecodeWithArgs = await get4437Bytecode(privs)
    const senderAddress = getAmbireAccountAddress(await factory.getAddress(), bytecodeWithArgs)
    const txn = getPriviledgeTxnWithCustomHash(
      senderAddress,
      await entryPoint.getAddress(),
      '0x0000000000000000000000000000000000000000000000000000000000007171'
    )
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [senderAddress, 31337, 0, [txn]]
      )
    )
    const typedData = wrapTypedData(chainId, senderAddress, executeHash)
    const s = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const initCode = ethers.hexlify(
      ethers.concat([await factory.getAddress(), getDeployCalldata(bytecodeWithArgs)])
    )

    const callData = proxy.interface.encodeFunctionData('executeMultiple', [[[[txn], s]]])
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
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
    const userOperation2 = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: senderAddress,
      userOpNonce: ethers.toBeHex(await entryPoint.getNonce(senderAddress, 0), 1),
      callData: proxy.interface.encodeFunctionData('executeBySender', [[nextTxn]])
    })
    const typedDataUserOp = wrapTypedData(
      chainId,
      senderAddress,
      await entryPoint.getUserOpHash(userOperation2)
    )
    const signature = wrapEthSign(
      await signer.signTypedData(
        typedDataUserOp.domain,
        typedDataUserOp.types,
        typedDataUserOp.value
      )
    )
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
      accountGasLimits: getAccountGasLimits(500000, 100000),
      preVerificationGas: 500000n,
      gasFees: getGasFees(100000, 100000),
      paymasterAndData: '0x',
      signature: '0x'
    }
    const typedDataUserOp3 = wrapTypedData(
      chainId,
      senderAddress,
      await entryPoint.getUserOpHash(userOperation3)
    )
    const sig = wrapEthSign(
      await signer.signTypedData(
        typedDataUserOp3.domain,
        typedDataUserOp3.types,
        typedDataUserOp3.value
      )
    )
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
      accountGasLimits: getAccountGasLimits(500000, 100000),
      preVerificationGas: 500000n,
      gasFees: getGasFees(100000, 100000),
      paymasterAndData: '0x',
      signature: '0x'
    }
    const typedDataUserOp4 = wrapTypedData(
      chainId,
      senderAddress,
      await entryPoint.getUserOpHash(userOperation4)
    )
    const sigLatest = wrapEthSign(
      await signer.signTypedData(
        typedDataUserOp4.domain,
        typedDataUserOp4.types,
        typedDataUserOp4.value
      )
    )
    userOperation4.signature = sigLatest
    await entryPoint.handleOps([userOperation4], relayer)

    const balanceShouldNotHaveChanged = await provider.getBalance(senderAddress)
    expect(balanceAfterPayment).to.equal(balanceShouldNotHaveChanged)
  })
})
