import { ethers } from 'hardhat'

import Schnorrkel, { Key } from '@borislav.itskov/schnorrkel.js'

import { getRawTypedDataFinalDigest, wrapSchnorr } from '../ambireSign'
import { abiCoder, AmbireAccount, chainId, expect, pk1, pk2, validSig } from '../config'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

/**
 * Generate the multisig address that will have permissions to sign
 *
 * @returns address
 */
function getSchnorrAddress() {
  const publicKey = ethers.getBytes(ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true))
  const px = ethers.toQuantity(publicKey.slice(1, 33))
  const hash = ethers.keccak256(ethers.solidityPacked(['string', 'bytes'], ['SCHNORR', px]))
  return `0x${hash.slice(hash.length - 40, hash.length)}`
}

let ambireAccountAddress: string

describe('Schnorr tests', () => {
  before('successfully deploys the ambire account', async () => {
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      {
        addr: getSchnorrAddress(),
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ])
    ambireAccountAddress = addr
  })
  it('successfully validate a basic schnorr signature', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const msgHashToSign = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const finalDigest = getRawTypedDataFinalDigest(chainId, ambireAccountAddress, msgHashToSign)
    const output = Schnorrkel.signHash(new Key(Buffer.from(pk1.slice(2), 'hex')), finalDigest)
    const s = output.signature.buffer
    const e = output.challenge.buffer

    const publicKey = ethers.getBytes(
      ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true)
    )
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const sigData = abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint8'], [px, e, s, parity])
    const ambireSignature = wrapSchnorr(sigData)
    expect(await contract.isValidSignature(msgHashToSign, ambireSignature)).to.equal(validSig)
  })
  it('fails validation when an unauthorized private key signs', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const msgHashToSign = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const finalDigest = getRawTypedDataFinalDigest(chainId, ambireAccountAddress, msgHashToSign)
    const output = Schnorrkel.signHash(new Key(Buffer.from(pk2.slice(2), 'hex')), finalDigest)
    const s = output.signature.buffer
    const e = output.challenge.buffer

    const publicKey = ethers.getBytes(
      ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true)
    )
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const sigData = abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint8'], [px, e, s, parity])
    const ambireSignature = wrapSchnorr(sigData)

    await expect(contract.isValidSignature(msgHashToSign, ambireSignature)).to.be.revertedWith(
      'SV_SCHNORR_FAILED'
    )
  })
  it('fails validation when the message is different', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const msgHashToSign = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const finalDigest = getRawTypedDataFinalDigest(chainId, ambireAccountAddress, msgHashToSign)
    const output = Schnorrkel.signHash(new Key(Buffer.from(pk2.slice(2), 'hex')), finalDigest)
    const s = output.signature.buffer
    const e = output.challenge.buffer

    const publicKey = ethers.getBytes(
      ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true)
    )
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const sigData = abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint8'], [px, e, s, parity])
    const ambireSignature = wrapSchnorr(sigData)
    const msg2 = 'test2'
    const msgHash2 = ethers.keccak256(ethers.toUtf8Bytes(msg2))
    const finalDigest2 = getRawTypedDataFinalDigest(chainId, ambireAccountAddress, msgHash2)

    await expect(contract.isValidSignature(finalDigest2, ambireSignature)).to.be.revertedWith(
      'SV_SCHNORR_FAILED'
    )
  })
})
