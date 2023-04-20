const { ethers } = require('ethers')
const { expect } = require('chai')
const pk1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const pk2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const addressOne = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const addressTwo = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const AmbireAccount = require('../../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json')
const localhost = 'http://localhost:8545'
const validSig = '0x1626ba7e'
const invalidSig = '0xffffffff'
const provider = new ethers.JsonRpcProvider(localhost)
const wallet = new ethers.Wallet(pk1, provider)
const wallet2 = new ethers.Wallet(pk2, provider)

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

/**
 * SignatureMode.EIP712 sign
 *
 * @param BytesLike sig 
 * @returns BytesLike
 */
function wrapSig(sig) {
  return `${sig}${'00'}`
}

/**
 * SignatureMode.Multisig sign
 *
 * @param BytesLike sig
 * @returns BytesLike
 */
function wrapMultiSig(sig) {
  return `${sig}${'05'}`
}

let ambireAccountAddress = null
async function deployAmbireAccount(accounts = []) {
  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const msAddress = getMsAddress(accounts)
  const contract = await factory.deploy([msAddress])
  // we wait for the deployment to end to be sure the nonce goes up
  // else we might face race conditions in tests
  await contract.waitForDeployment()
  expect(await contract.getAddress()).to.not.be.null
  const isSigner = await contract.privileges(msAddress)
  expect(isSigner).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')

  ambireAccountAddress = await contract.getAddress()
  return {contract}
}

async function getCachedAmbireAccount() {
  if (ambireAccountAddress) {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    return {contract}
  }

  return deployAmbireAccount()
}

describe('Two of two multisignature tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  });
  it('validates successfully a basic two-of-two multisig test', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet2.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet2.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigTwo, sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when only a single signature is passed to the multisig', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when only a single signature is passed to EIP712 validation', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    expect(await contract.isValidSignature(ethers.hashMessage(msg), sigOne)).to.equal(invalidSig)
  })
  it('fails validation when a single signer passes two signatures', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails validation when the message of the second signer is different', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const msg2 = 'test2'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet2.signMessage(msg2))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
})

describe('Three of three multisignature tests', function () {
  addressThree = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  pk3 = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
  const wallet3 = new ethers.Wallet(pk3, provider)

  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount([addressOne, addressTwo, addressThree])
  });
  it('validates successfully a basic three-of-three multisig test', async function () {    
    const {contract} = await getCachedAmbireAccount()

    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet2.signMessage(msg))
    const sigThree = wrapSig(await wallet3.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(validSig)
  })
  it('fails validation when the order of the passed signatures is not correct', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet2.signMessage(msg))
    const sigThree = wrapSig(await wallet3.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigThree, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when two of three signatures are passed to the multisig', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet2.signMessage(msg))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
  it('fails when one of the signers signs a different message', async function () {
    const {contract} = await getCachedAmbireAccount()
    
    const msg = 'test'
    const msg2 = 'test2'
    const sigOne = wrapSig(await wallet.signMessage(msg))
    const sigTwo = wrapSig(await wallet2.signMessage(msg))
    const sigThree = wrapSig(await wallet3.signMessage(msg2))
    const abi = new ethers.AbiCoder()
    const signature = abi.encode(['bytes[]'], [[sigOne, sigTwo, sigThree]])
    const ambireSig = wrapMultiSig(signature)
    expect(await contract.isValidSignature(ethers.hashMessage(msg), ambireSig)).to.equal(invalidSig)
  })
});