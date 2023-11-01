import { ethers } from 'hardhat'
import {
  AmbireAccount,
  validSig,
  invalidSig,
  wallet2,
  addressOne,
  addressTwo,
  addressThree,
  wallet3,
  expect,
  abiCoder,
} from '../config'
import { wrapEthSign, wrapMultiSig } from '../ambireSign'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

/**
 * Generate the multisig address that will have permissions to sign
 *
 * @returns address
 */
function getMsAddress(accounts: string[] = []) {
  let finalSigner = ethers.ZeroAddress
  const signers = accounts.length ? accounts : [addressOne, addressTwo]
  for (let i = 0; i < signers.length; i++) {
    let kecak = ethers.keccak256(
      ethers.solidityPacked(['address', 'address'], [finalSigner, signers[i]])
    )
    finalSigner = ethers.hexlify(ethers.getBytes(kecak).slice(12, 32))
  }
  return finalSigner
}

let ambireAccountAddress: string

describe('Two of two multisignature tests', function () {
  before('successfully deploys the ambire account', async function () {
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: getMsAddress(), hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('validates successfully a basic two-of-two multisig test', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await wallet2.signMessage(msgHashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(msgHash, ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await wallet2.signMessage(msgHashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigTwo, sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(msgHash, ambireSig)).to.equal(invalidSig)
  })
  it('fails when only a single signature is passed to the multisig', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(msgHash, ambireSig)).to.equal(invalidSig)
  })
  it('fails when only a single signature is passed to EIP712 validation', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    expect(await contract.isValidSignature(msgHash, sigOne)).to.equal(invalidSig)
  })
  it('fails validation when a single signer passes two signatures', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await signer.signMessage(msgHashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(msgHash, ambireSig)).to.equal(invalidSig)
  })
  it('fails validation when the message of the second signer is different', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msg2 = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msg2Hash = ethers.keccak256(ethers.toUtf8Bytes(msg2))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const msg2HashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msg2Hash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await signer.signMessage(msg2HashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
})

describe('Three of three multisignature tests', function () {
  before('successfully deploys the ambire account', async function () {
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: getMsAddress([addressOne, addressTwo, addressThree]), hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('validates successfully a basic three-of-three multisig test', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await wallet2.signMessage(msgHashToSign))
    const sigThree = wrapEthSign(await wallet3.signMessage(msgHashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(msgHash, ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await wallet2.signMessage(msgHashToSign))
    const sigThree = wrapEthSign(await wallet3.signMessage(msgHashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigThree, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when two of three signatures are passed to the multisig', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await wallet2.signMessage(msgHashToSign))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when one of the signers signs a different message', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const msgHash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const msgHashToSign = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash, ambireAccountAddress])))
    const sigOne = wrapEthSign(await signer.signMessage(msgHashToSign))
    const sigTwo = wrapEthSign(await wallet2.signMessage(msgHashToSign))

    const msg2 = 'test2'
    const msgHash2 = ethers.keccak256(ethers.toUtf8Bytes(msg2))
    const msgHashToSign2 = ethers.getBytes(ethers.keccak256(abiCoder.encode(['bytes32', 'address'], [msgHash2, ambireAccountAddress])))
    const sigThree = wrapEthSign(await wallet3.signMessage(msgHashToSign2))

    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(msgHash, ambireSig)).to.equal(invalidSig)
  })
})
