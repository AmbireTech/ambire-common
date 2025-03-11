import { ethers } from 'hardhat'

import { wrapEthSign, wrapMultiSig, wrapTypedData } from '../ambireSign'
import {
  addressOne,
  addressThree,
  addressTwo,
  AmbireAccount,
  chainId,
  expect,
  invalidSig,
  validSig,
  wallet2,
  wallet3
} from '../config'
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
    const kecak = ethers.keccak256(
      ethers.solidityPacked(['address', 'address'], [finalSigner, signers[i]])
    )
    finalSigner = ethers.toQuantity(ethers.getBytes(kecak).slice(12, 32))
  }
  return finalSigner
}

let ambireAccountAddress: string

describe('Two of two multisignature tests', () => {
  it('successfully deploys the ambire account', async () => {
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      {
        addr: getMsAddress(),
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ])
    ambireAccountAddress = addr
  })
  it('validates successfully a basic two-of-two multisig test', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigTwo = wrapEthSign(
      await wallet2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)

    expect(await contract.isValidSignature(hash, ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigTwo = wrapEthSign(
      await wallet2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigTwo, sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(hash, ambireSig)).to.equal(invalidSig)
  })
  it('fails when only a single signature is passed to the multisig', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(hash, ambireSig)).to.equal(invalidSig)
  })
  it('fails validation when a single signer passes two signatures', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigTwo = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(hash, ambireSig)).to.equal(invalidSig)
  })
  it('fails validation when the message of the second signer is different', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const msg2 = 'test2'
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes(msg2))
    const typedData2 = wrapTypedData(chainId, ambireAccountAddress, hash2)
    const sigTwo = wrapEthSign(
      await wallet2.signTypedData(typedData2.domain, typedData2.types, typedData2.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(hash, ambireSig)).to.equal(invalidSig)
  })
})

describe('Three of three multisignature tests', () => {
  before('successfully deploys the ambire account', async () => {
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      {
        addr: getMsAddress([addressOne, addressTwo, addressThree]),
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ])
    ambireAccountAddress = addr
  })
  it('validates successfully a basic three-of-three multisig test', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigTwo = wrapEthSign(
      await wallet2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigThree = wrapEthSign(
      await wallet3.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(hash, ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigTwo = wrapEthSign(
      await wallet2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigThree = wrapEthSign(
      await wallet3.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigThree, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when two of three signatures are passed to the multisig', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigTwo = wrapEthSign(
      await wallet2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when one of the signers signs a different message', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'test'
    const msg2 = 'test2'
    const hash = ethers.keccak256(ethers.toUtf8Bytes(msg))
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes(msg2))
    const typedData = wrapTypedData(chainId, ambireAccountAddress, hash)
    const typedData2 = wrapTypedData(chainId, ambireAccountAddress, hash2)
    const sigOne = wrapEthSign(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigTwo = wrapEthSign(
      await wallet2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigThree = wrapEthSign(
      await wallet3.signTypedData(typedData2.domain, typedData2.types, typedData2.value)
    )
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
})
