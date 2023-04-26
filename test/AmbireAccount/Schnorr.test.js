const { ethers } = require('ethers')
const { expect } = require('chai')
const {
  pk1,
  pk2,
  AmbireAccount,
  validSig,
  invalidSig,
  wallet
} = require('../config')
const {wrapSchnorr} = require('../ambireSign')
const Schnorrkel = require('@borislav.itskov/schnorrkel.js')
const { wait } = require('../polling')
const schnorrkel = new Schnorrkel()

/**
 * Generate the multisig address that will have permissions to sign
 *
 * @returns address
 */
function getSchnorrAddress() {
  const publicKey = ethers.getBytes(ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true))
  const px = ethers.toQuantity(publicKey.slice(1, 33))
  return '0x' + px.slice(px.length - 40, px.length);
}

let ambireAccountAddress = null
async function deployAmbireAccount() {
  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const schnorrAddress = getSchnorrAddress()

  const contract = await factory.deploy([schnorrAddress])
  await wait(wallet, contract)
  expect(await contract.getAddress()).to.not.be.null
  const isSigner = await contract.privileges(schnorrAddress)
  expect(isSigner).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')

  ambireAccountAddress = await contract.getAddress()
  return {contract}
}

describe('Schnorr tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('successfully validate a basic schnorr signature', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const msg = 'test'
    const {s, e} = schnorrkel.sign(msg, ethers.getBytes(pk1))

    const publicKey = ethers.getBytes(ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true))
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const abiCoder = new ethers.AbiCoder()
    const sigData = abiCoder.encode([ 'bytes32', 'bytes32', 'bytes32', 'uint8' ], [
      px,
      e,
      s,
      parity
    ])
    const ambireSignature = wrapSchnorr(sigData)
    const hash = ethers.solidityPackedKeccak256(['string'], [msg])
    expect(await contract.isValidSignature(hash, ambireSignature)).to.equal(validSig)
  })
  it('fails validation when an unauthorized private key signs', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const msg = 'test'
    const {s, e} = schnorrkel.sign(msg, ethers.getBytes(pk2))

    const publicKey = ethers.getBytes(ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true))
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const abiCoder = new ethers.AbiCoder()
    const sigData = abiCoder.encode([ 'bytes32', 'bytes32', 'bytes32', 'uint8' ], [
      px,
      e,
      s,
      parity
    ])
    const ambireSignature = wrapSchnorr(sigData)
    const hash = ethers.solidityPackedKeccak256(['string'], [msg])
    expect(await contract.isValidSignature(hash, ambireSignature)).to.equal(invalidSig)
  })
  it('fails validation when the message is different', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const msg = 'test'
    const {s, e} = schnorrkel.sign(msg, ethers.getBytes(pk1))

    const publicKey = ethers.getBytes(ethers.SigningKey.computePublicKey(ethers.getBytes(pk1), true))
    const px = publicKey.slice(1, 33)
    const parity = publicKey[0] - 2 + 27

    // wrap the result
    const abiCoder = new ethers.AbiCoder()
    const sigData = abiCoder.encode([ 'bytes32', 'bytes32', 'bytes32', 'uint8' ], [
      px,
      e,
      s,
      parity
    ])
    const ambireSignature = wrapSchnorr(sigData)
    const msg2 = 'test2'
    const hash = ethers.solidityPackedKeccak256(['string'], [msg2])
    expect(await contract.isValidSignature(hash, ambireSignature)).to.equal(invalidSig)
  })
})