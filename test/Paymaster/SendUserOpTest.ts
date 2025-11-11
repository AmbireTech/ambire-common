import { ethers } from 'hardhat'

import { Hex } from '../../src/interfaces/hex'
import { getExecute712Data, getUserOp712Data, wrapEIP712 } from '../ambireSign'
import { abiCoder, addressOne, chainId, expect, provider } from '../config'
import { buildUserOp, getPriviledgeTxnWithCustomHash } from '../helpers'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

const ENTRY_POINT_PRIV = '0x0000000000000000000000000000000000000000000000000000000000007171'
let paymaster: any
let ambireAccount: any
let entryPoint: any
let ambireAccountAddress: any

describe('Send User Operation Tests', () => {
  before('successfully deploys the contracts', async () => {
    const [relayer] = await ethers.getSigners()
    paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
    entryPoint = await ethers.deployContract('EntryPoint')
    const { ambireAccount: acc } = await deployAmbireAccountHardhatNetwork([
      {
        addr: relayer.address,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ])
    ambireAccount = acc
    ambireAccountAddress = await ambireAccount.getAddress()
    const txn = getPriviledgeTxnWithCustomHash(
      ambireAccountAddress,
      await entryPoint.getAddress(),
      ENTRY_POINT_PRIV
    )
    await relayer.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: ambireAccount.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await ambireAccount.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal(
      '0000000000000000000000000000000000007171'
    )
    await entryPoint.depositTo(await paymaster.getAddress(), {
      value: ethers.parseEther('1')
    })
  })
  it('should successfully execute an userOp with paymaster validUntil +60 seconds', async () => {
    const [relayer] = await ethers.getSigners()
    const latestBlock = await provider.getBlock('latest')
    const timestamp = latestBlock?.timestamp || 0
    const nonce = await entryPoint.getNonce(...[ambireAccountAddress, 0])
    const userOp = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      userOpNonce: nonce,
      validUntil: timestamp + 60
    })
    const typedData = getUserOp712Data(chainId, [], userOp, await entryPoint.getUserOpHash(userOp))
    const signature = wrapEIP712(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    ) as Hex
    userOp.signature = signature
    await entryPoint.handleOps([userOp], relayer)
  })
  it('should successfully execute an userOp with callData of execute', async () => {
    const [relayer] = await ethers.getSigners()
    const latestBlock = await provider.getBlock('latest')
    const timestamp = latestBlock?.timestamp || 0
    const nonce = await entryPoint.getNonce(...[ambireAccountAddress, 0])

    const accNonce = await ambireAccount.nonce()
    const txns: [string, string, string][] = [
      [addressOne, ethers.parseEther('0.01').toString(), '0x']
    ]
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, accNonce, txns]
      )
    )
    const typedDataExecute = getExecute712Data(
      chainId,
      accNonce,
      txns,
      ambireAccountAddress,
      executeHash
    )
    const executeSignature = wrapEIP712(
      await relayer.signTypedData(
        typedDataExecute.domain,
        typedDataExecute.types,
        typedDataExecute.value
      )
    )
    const userOp = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      userOpNonce: nonce,
      validUntil: timestamp + 60,
      callData: ambireAccount.interface.encodeFunctionData('execute', [txns, executeSignature])
    })
    const typedData = getUserOp712Data(
      chainId,
      txns,
      userOp,
      await entryPoint.getUserOpHash(userOp)
    )
    const signature = wrapEIP712(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    ) as Hex
    userOp.signature = signature
    await entryPoint.handleOps([userOp], relayer)
  })
  it('should revert on executing an userOp with paymaster validUntil -60 seconds', async () => {
    const [relayer] = await ethers.getSigners()
    const latestBlock = await provider.getBlock('latest')
    const timestamp = latestBlock?.timestamp || 0
    const userOp = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      userOpNonce: await entryPoint.getNonce(...[ambireAccountAddress, 0]),
      validUntil: timestamp - 60
    })
    const typedData = getUserOp712Data(chainId, [], userOp, await entryPoint.getUserOpHash(userOp))
    const signature = wrapEIP712(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    ) as Hex
    userOp.signature = signature
    await expect(entryPoint.handleOps([userOp], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA32 paymaster expired or not due')
  })
})
