import { ethers } from 'hardhat'

import { AbiCoder, getBytes, hexlify, keccak256, solidityPacked } from 'ethers'
import secp256k1 from 'secp256k1'
import { Hex } from '../../src/interfaces/hex'
import { expect, pk1, provider } from '../config'
import { buildUserOp, getPriviledgeTxnWithCustomHash } from '../helpers'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

const ENTRY_POINT_PRIV = '0x0000000000000000000000000000000000000000000000000000000000007171'
let paymaster: any
let ambireAccount: any
let entryPoint: any
let ambireAccountAddress: any
const coder = new AbiCoder()

const sortHexes = (hexes: string[]) => {
  return hexes.sort((x, y) => {
    const a = BigInt(x)
    const b = BigInt(y)
    if (a > b) return 1
    if (a === b) return 0
    return -1
  })
}

describe('AmbireAccountOmni tests', () => {
  before('successfully deploys the contracts', async () => {
    const [relayer] = await ethers.getSigners()
    paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
    entryPoint = await ethers.deployContract('EntryPoint')
    const { ambireAccount: acc } = await deployAmbireAccountHardhatNetwork(
      [
        {
          addr: relayer.address,
          hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
        }
      ],
      'AmbireAccountOmni'
    )
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
  it('should successfully execute 3 userOps with one multichain signature', async () => {
    const [relayer] = await ethers.getSigners()
    const latestBlock = await provider.getBlock('latest')
    const timestamp = latestBlock?.timestamp || 0
    const nonce = await entryPoint.getNonce(...[ambireAccountAddress, 0])
    const userOpOne = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      userOpNonce: nonce,
      validUntil: timestamp + 60
    })
    const userOpTwo = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      userOpNonce: nonce + 1n,
      validUntil: timestamp + 60
    })
    const userOpThree = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      userOpNonce: nonce + 2n,
      validUntil: timestamp + 60
    })
    const [userOpHashOne, userOpHashTwo, userOpHashThree] = await Promise.all([
      entryPoint.getUserOpHash(userOpOne),
      entryPoint.getUserOpHash(userOpTwo),
      entryPoint.getUserOpHash(userOpThree)
    ])
    const validAfter = 0
    const validUntil = 0
    const leafOne = keccak256(
      solidityPacked(['uint48', 'uint48', 'bytes32'], [validUntil, validAfter, userOpHashOne])
    )
    const leafTwo = keccak256(
      solidityPacked(['uint48', 'uint48', 'bytes32'], [validUntil, validAfter, userOpHashTwo])
    )
    const leafThree = keccak256(
      solidityPacked(['uint48', 'uint48', 'bytes32'], [validUntil, validAfter, userOpHashThree])
    )
    const levelOneLeft = keccak256(
      solidityPacked(['bytes32', 'bytes32'], sortHexes([leafOne, leafTwo]))
    )
    const levelOneRight = keccak256(solidityPacked(['bytes32', 'bytes32'], [leafThree, leafThree]))
    const merkleRoot = keccak256(
      solidityPacked(['bytes32', 'bytes32'], sortHexes([levelOneLeft, levelOneRight]))
    )
    const ecdsa = secp256k1.ecdsaSign(getBytes(merkleRoot), getBytes(pk1))
    const merkleTreeSig = `${hexlify(ecdsa.signature)}${ecdsa.recid === 0 ? '1B' : '1C'}`

    // broadcast first txn
    const fullSigWithoutWrapping = coder.encode(
      ['uint48', 'uint48', 'bytes32', 'bytes32[]', 'bytes'],
      [validUntil, validAfter, merkleRoot, [leafTwo, levelOneRight], merkleTreeSig]
    ) as Hex
    const multiUserOpSig = `${fullSigWithoutWrapping}06`
    userOpOne.signature = multiUserOpSig as Hex
    await entryPoint.handleOps([userOpOne], relayer)

    // broadcast second txn
    const fullSigWithoutWrappingTwo = coder.encode(
      ['uint48', 'uint48', 'bytes32', 'bytes32[]', 'bytes'],
      [validUntil, validAfter, merkleRoot, [leafOne, levelOneRight], merkleTreeSig]
    ) as Hex
    const multiUserOpSigTwo = `${fullSigWithoutWrappingTwo}06`
    userOpTwo.signature = multiUserOpSigTwo as Hex
    await entryPoint.handleOps([userOpTwo], relayer)

    // broadcast third txn
    const fullSigWithoutWrappingThree = coder.encode(
      ['uint48', 'uint48', 'bytes32', 'bytes32[]', 'bytes'],
      [validUntil, validAfter, merkleRoot, [leafThree, levelOneLeft], merkleTreeSig]
    ) as Hex
    const multiUserOpSigThree = `${fullSigWithoutWrappingThree}06`
    userOpThree.signature = multiUserOpSigThree as Hex
    await entryPoint.handleOps([userOpThree], relayer)
  })
})
