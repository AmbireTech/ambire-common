import { ethers } from 'hardhat'
import { pk1, pk2, AmbireAccount, validSig, expect } from '../config'
import { wrapSchnorr } from '../ambireSign'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
const Schnorrkel = require('@borislav.itskov/schnorrkel.js')
const schnorrkel = new Schnorrkel()

/**
 * Generate the multisig address that will have permissions to sign
 *
 * @returns address
 */
function getSchnorrAddress() {
  const publicKey = ethers.getBytes(ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true))
  const px = ethers.toQuantity(publicKey.slice(1, 33))
  const hash = ethers.keccak256(ethers.solidityPacked(['string', 'bytes'], ['SCHNORR', px]))
  return '0x' + hash.slice(hash.length - 40, hash.length)
}

let ambireAccountAddress: string

describe('Schnorr tests', function () {
  it('successfully deploys the ambire account', async function () {
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: getSchnorrAddress(), hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('successfully validate a basic schnorr signature', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const { s, e } = schnorrkel.sign(msg, ethers.getBytes(pk1))

    const publicKey = ethers.getBytes(
      ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true)
    )
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const abiCoder = new ethers.AbiCoder()
    const sigData = abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint8'], [px, e, s, parity])
    const ambireSignature = wrapSchnorr(sigData)
    const hash = ethers.solidityPackedKeccak256(['string'], [msg])
    expect(await contract.isValidSignature(hash, ambireSignature)).to.equal(validSig)
  })
  it('fails validation when an unauthorized private key signs', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const { s, e } = schnorrkel.sign(msg, ethers.getBytes(pk2))

    const publicKey = ethers.getBytes(
      ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true)
    )
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const abiCoder = new ethers.AbiCoder()
    const sigData = abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint8'], [px, e, s, parity])
    const ambireSignature = wrapSchnorr(sigData)
    const hash = ethers.solidityPackedKeccak256(['string'], [msg])

    await expect(contract.isValidSignature(hash, ambireSignature))
      .to.be.revertedWith('SV_SCHNORR_FAILED')
  })
  it('fails validation when the message is different', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const { s, e } = schnorrkel.sign(msg, ethers.getBytes(pk1))

    const publicKey = ethers.getBytes(
      ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true)
    )
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const abiCoder = new ethers.AbiCoder()
    const sigData = abiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint8'], [px, e, s, parity])
    const ambireSignature = wrapSchnorr(sigData)
    const msg2 = 'test2'
    const hash = ethers.solidityPackedKeccak256(['string'], [msg2])

    await expect(contract.isValidSignature(hash, ambireSignature))
      .to.be.revertedWith('SV_SCHNORR_FAILED')
  })
})
