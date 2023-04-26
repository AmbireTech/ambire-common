const { ethers } = require('ethers')
const { expect } = require('chai')
const {
  pk1,
  pk2,
  AmbireAccount,
  validSig,
  wallet,
  addressOne,
  addressTwo,
  chainId,
  wallet2
} = require('../config')
const { wait } = require('../polling')
const { sendFunds, getPriviledgeTxn } = require('../helpers')
const { wrapEthSign } = require('../ambireSign')

let ambireAccountAddress = null
async function deployAmbireAccount() {
  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const contract = await factory.deploy([addressOne])
  await wait(wallet, contract)
  expect(await contract.getAddress()).to.not.be.null
  const isSigner = await contract.privileges(addressOne)
  expect(isSigner).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')

  ambireAccountAddress = await contract.getAddress()
  return {contract}
}

describe('Basic Ambire Account tests', function () {
  it('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  it('check if setAddrPrivilege is a function that only the ambire account contract can call', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    let errorCaught = false
    try {
      await contract.setAddrPrivilege(addressTwo, ethers.toBeHex(1, 32))
    } catch (error) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('fail execute with an address that does not have priv', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const normalTxns = [[addressTwo, ethers.parseEther('0.01'), '0x00']]
    const abiCoder = new ethers.AbiCoder()
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, normalTxns])
    ))
    const s = wrapEthSign(await wallet2.signMessage(msg))
    let errorCaught = false
    try {
      await contract.execute(normalTxns, s)
    } catch (error) {
      expect(error.reason).to.equal('INSUFFICIENT_PRIVILEGE')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('fail on downgrading my own key priviledge', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const txns = [getPriviledgeTxn(ambireAccountAddress, addressOne, false)]
    const nonce = await contract.nonce()
    const abiCoder = new ethers.AbiCoder()
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, txns])
    ))
    const s = wrapEthSign(await wallet.signMessage(msg))
    let errorCaught = false
    try {
      await contract.execute(txns, s)
    } catch (error) {
      expect(error.reason).to.equal('PRIVILEGE_NOT_DOWNGRADED')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
})