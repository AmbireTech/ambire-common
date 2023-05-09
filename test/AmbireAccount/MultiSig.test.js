const { ethers } = require('ethers')
const { expect } = require('chai')
const {
  AmbireAccount,
  validSig,
  invalidSig,
  wallet,
  wallet2,
  addressOne,
  addressTwo,
  addressThree,
  wallet3,
} = require('../config')
const {wrapEIP712, wrapMultiSig} = require('../ambireSign')
const { wait } = require('../polling')

/**
 * Generate the multisig address that will have permissions to sign
 *
 * @returns address
 */
function getMsAddress(accounts = []) {
  let finalSigner = ethers.ZeroAddress;
  const signers = accounts.length ? accounts : [addressOne, addressTwo]
  for (let i = 0; i < signers.length; i++) {
    let kecak = ethers.keccak256(ethers.solidityPacked(['address', 'address'], [finalSigner, signers[i]]))
    finalSigner = ethers.toQuantity(ethers.getBytes(kecak).slice(12, 32))
  }
  return finalSigner
}

let ambireAccountAddress = null
async function deployAmbireAccount(accounts = []) {
  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const msAddress = getMsAddress(accounts)
  const contract = await factory.deploy([msAddress])
  await wait(wallet, contract)
  const isSigner = await contract.privileges(msAddress)
  expect(isSigner).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')

  ambireAccountAddress = await contract.getAddress()
  return {contract}
}

describe('Two of two multisignature tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  });
  it('validates successfully a basic two-of-two multisig test', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet2.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet2.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigTwo, sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when only a single signature is passed to the multisig', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when only a single signature is passed to EIP712 validation', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    expect(await contract.isValidSignature(ethers.hashMessage(msg), sigOne)).to.equal(invalidSig)
  })
  it('fails validation when a single signer passes two signatures', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails validation when the message of the second signer is different', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const msg2 = 'test2'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet2.signMessage(msg2))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
})

describe('Three of three multisignature tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount([addressOne, addressTwo, addressThree])
  });
  it('validates successfully a basic three-of-three multisig test', async function () {    
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)

    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet2.signMessage(msg))
    const sigThree = wrapEIP712(await wallet3.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet2.signMessage(msg))
    const sigThree = wrapEIP712(await wallet3.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigThree, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when two of three signatures are passed to the multisig', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet2.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when one of the signers signs a different message', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    
    const msg = 'test'
    const msg2 = 'test2'
    const sigOne = wrapEIP712(await wallet.signMessage(msg))
    const sigTwo = wrapEIP712(await wallet2.signMessage(msg))
    const sigThree = wrapEIP712(await wallet3.signMessage(msg2))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
});