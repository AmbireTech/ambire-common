import { BaseContract, keccak256, toUtf8Bytes } from 'ethers'
import { ethers } from 'hardhat'

import { Hex } from '../../src/interfaces/hex'
import { getProxyDeployBytecode, PrivLevels } from '../../src/libs/proxyDeploy/deploy'
import { getExecute712Data, getUserOp712Data, wrapEIP712 } from '../ambireSign'
import { abiCoder, chainId, expect, provider } from '../config'
import {
  buildUserOp,
  getAccountGasLimits,
  getGasFees,
  getPriviledgeTxnWithCustomHash
} from '../helpers'

const salt = '0x0'

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(
    factoryAddress,
    ethers.toBeHex(salt, 32),
    ethers.keccak256(bytecode)
  )
}

function getDeployCalldata(
  bytecodeWithArgs: string,
  epPrivTxn: [string, string, string],
  executeSig: string
) {
  const abi = [
    'function deployAndExecute(bytes calldata code, uint256 salt, tuple(address, uint256, bytes)[] calldata txns, bytes calldata signature) external returns(address)'
  ]
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('deployAndExecute', [
    bytecodeWithArgs,
    salt,
    [epPrivTxn],
    executeSig
  ])
}

export async function get4437Bytecode(priLevels: PrivLevels[]): Promise<string> {
  const contract: BaseContract = await ethers.deployContract('AmbireAccount')

  // get the bytecode and deploy it
  return getProxyDeployBytecode(await contract.getAddress(), priLevels, {
    privSlot: `${keccak256(toUtf8Bytes('ambire.smart.contracts.storage'))}`
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
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
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
    const typedData = getExecute712Data(chainId, 0n, [txn], senderAddress, executeHash)
    const s = wrapEIP712(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const initCode = ethers.hexlify(
      ethers.concat([await factory.getAddress(), getDeployCalldata(bytecodeWithArgs, txn, s)])
    )

    // const epTxn: [string, string, string] = [senderAddress, '0', '0x68656c6c6f']
    // const callData = proxy.interface.encodeFunctionData('executeBySender', [[epTxn]])
    const nextTxn: [string, string, string] = [senderAddress, '0', '0x68656c6c6f']
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      userOpNonce: await entryPoint.getNonce(senderAddress, 0),
      sender: senderAddress,
      initCode,
      callData: proxy.interface.encodeFunctionData('executeBySender', [[nextTxn]])
    })
    const typedDataFirstUserOp = getUserOp712Data(
      chainId,
      [nextTxn],
      userOperation,
      await entryPoint.getUserOpHash(userOperation)
    )
    const firstSignature = wrapEIP712(
      await signer.signTypedData(
        typedDataFirstUserOp.domain,
        typedDataFirstUserOp.types,
        typedDataFirstUserOp.value
      )
    ) as Hex
    userOperation.signature = firstSignature
    await entryPoint.handleOps([userOperation], relayer)

    // confirm everything is set by sending an userOp through the entry point
    // with a normal paymaster signature
    const userOperation2 = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: senderAddress,
      userOpNonce: await entryPoint.getNonce(senderAddress, 0),
      callData: proxy.interface.encodeFunctionData('executeBySender', [[nextTxn]]),
      chainId
    })
    const typedDataUserOp = getUserOp712Data(
      chainId,
      [nextTxn],
      userOperation2,
      await entryPoint.getUserOpHash(userOperation2)
    )
    const signature = wrapEIP712(
      await signer.signTypedData(
        typedDataUserOp.domain,
        typedDataUserOp.types,
        typedDataUserOp.value
      )
    ) as Hex
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
    const anotherTxn: [string, string, string] = [senderAddress, '0', '0x68656c6c6f']
    const userOperation3 = {
      sender: senderAddress,
      nonce: BigInt(await entryPoint.getNonce(senderAddress, 0)),
      initCode: '0x' as Hex,
      callData: proxy.interface.encodeFunctionData('executeBySender', [[anotherTxn]]) as Hex,
      accountGasLimits: getAccountGasLimits(500000, 100000),
      preVerificationGas: 500000n,
      gasFees: getGasFees(100000, 100000),
      paymasterAndData: '0x' as Hex,
      signature: '0x' as Hex
    }
    const typedDataUserOp3 = getUserOp712Data(
      chainId,
      [anotherTxn],
      userOperation3,
      await entryPoint.getUserOpHash(userOperation3)
    )
    const sig = wrapEIP712(
      await signer.signTypedData(
        typedDataUserOp3.domain,
        typedDataUserOp3.types,
        typedDataUserOp3.value
      )
    ) as Hex
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
      nonce: BigInt(await entryPoint.getNonce(senderAddress, 0)),
      initCode: '0x' as Hex,
      callData: proxy.interface.encodeFunctionData('executeBySender', [[anotherTxn]]) as Hex,
      accountGasLimits: getAccountGasLimits(500000, 100000),
      preVerificationGas: 500000n,
      gasFees: getGasFees(100000, 100000),
      paymasterAndData: '0x' as Hex,
      signature: '0x' as Hex
    }
    const typedDataUserOp4 = getUserOp712Data(
      chainId,
      [anotherTxn],
      userOperation4,
      await entryPoint.getUserOpHash(userOperation4)
    )
    const sigLatest = wrapEIP712(
      await signer.signTypedData(
        typedDataUserOp4.domain,
        typedDataUserOp4.types,
        typedDataUserOp4.value
      )
    ) as Hex
    userOperation4.signature = sigLatest
    await entryPoint.handleOps([userOperation4], relayer)

    const balanceShouldNotHaveChanged = await provider.getBalance(senderAddress)
    expect(balanceAfterPayment).to.equal(balanceShouldNotHaveChanged)
  })
})
