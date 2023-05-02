const { ethers, assert } = require('ethers')
const { expect } = require('chai')
const {
  AmbireAccount,
  wallet,
  addressOne,
  addressTwo,
  chainId,
  wallet2,
  abiCoder,
  addressThree,
  addressFour,
  provider
} = require('../config')
const { wait } = require('../polling')
const { sendFunds, getPriviledgeTxn, getTimelockData } = require('../helpers')
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
  it('ONLY_IDENTITY_CAN_CALL on setAddrPrivilege', async function () {
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
  it('ONLY_IDENTITY_CAN_CALL on tryCatch', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    let errorCaught = false
    try {
      await contract.tryCatch(addressTwo, 1, '0x00')
    } catch (error) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('ONLY_IDENTITY_CAN_CALL on tryCatchLimit', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    let errorCaught = false
    try {
      await contract.tryCatchLimit(addressTwo, 1, '0x00', 100000)
    } catch (error) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('ONLY_IDENTITY_CAN_CALL on executeBySelf', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    let errorCaught = false
    try {
      await contract.executeBySelf([[addressTwo, 1, '0x00']])
    } catch (error) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('execute should fail if the account does not have priviledges', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const normalTxns = [[addressTwo, ethers.parseEther('0.01'), '0x00']]
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
  it('fail on trying to set the timelock permissions to 1 - the only thing that will happen is the timelock will get invalidated', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)

    // first, add the timelock
    const {hash, timelockAddress} = getTimelockData()
    const setAddrPrivilegeABI = [
      'function setAddrPrivilege(address addr, bytes32 priv)'
    ]
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [ timelockAddress, hash ])
    const setPrivTxn = [{
      to: ambireAccountAddress,
      value: 0,
      data: calldata
    }]
    const txn = await contract.executeBySender(setPrivTxn)
    await wait(wallet, txn)
    const hasTimelock = await contract.privileges(timelockAddress)
    expect(hasTimelock).to.equal(hash)

    // unset it
    const calldata2 = iface.encodeFunctionData('setAddrPrivilege', [ timelockAddress, ethers.toBeHex(1, 32) ])
    const unsetPrivTxn = [{
      to: ambireAccountAddress,
      value: 0,
      data: calldata2
    }]
    let errorCaught = false
    try {
      await contract.executeBySender(unsetPrivTxn)
    } catch (error) {
      expect(error.reason).to.equal('UNSETTING_SPECIAL_DATA')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('successfully remove the timelock', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)

    // first, add the timelock
    const {hash, timelockAddress} = getTimelockData()
    const setAddrPrivilegeABI = [
      'function setAddrPrivilege(address addr, bytes32 priv)'
    ]
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [ timelockAddress, hash ])
    const setPrivTxn = [{
      to: ambireAccountAddress,
      value: 0,
      data: calldata
    }]
    const txn = await contract.executeBySender(setPrivTxn)
    await wait(wallet, txn)
    const hasTimelock = await contract.privileges(timelockAddress)
    expect(hasTimelock).to.equal(hash)

    // unset it
    const calldata2 = iface.encodeFunctionData('setAddrPrivilege', [ timelockAddress, ethers.toBeHex(0, 32) ])
    const unsetPrivTxn = [{
      to: ambireAccountAddress,
      value: 0,
      data: calldata2
    }]
    const unsetTxn = await contract.executeBySender(unsetPrivTxn)
    await wait(wallet, unsetTxn)
    const noTimelock = await contract.privileges(timelockAddress)
    expect(noTimelock).to.equal('0x0000000000000000000000000000000000000000000000000000000000000000')
  })
  it('executeBySender should fail if the account does not have priviledges', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet2)
    let errorCaught = false
    try {
      const txns = [[addressOne, 1, '0x00']]
      await contract.executeBySender(txns)
    } catch (error) {
      expect(error.reason).to.equal('INSUFFICIENT_PRIVILEGE')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('executeBatch should fail if an empty array is passed', async function () {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    let errorCaught = false
    try {
      await contract.executeBySender([])
    } catch (error) {
      expect(error.reason).to.equal('MUST_PASS_TX')
      errorCaught = true
    }
    expect(errorCaught).to.be.true
  })
  it('should successfully executeMultiple', async function() {
    const contract = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const firstBatch = [
      [addressTwo, ethers.parseEther('0.01'), '0x00'],
      [addressThree, ethers.parseEther('0.01'), '0x00'],
    ]
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, firstBatch])
    ))
    const s = wrapEthSign(await wallet.signMessage(msg))
    const secondBatch = [
      [addressOne, ethers.parseEther('0.01'), '0x00'],
      [addressFour, ethers.parseEther('0.01'), '0x00'],
    ]
    const msg2 = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce + ethers.toBigInt(1), secondBatch])
    ))
    const s2 = wrapEthSign(await wallet.signMessage(msg2))
    const balance = await provider.getBalance(ambireAccountAddress)
    const multipleTxn = await contract.executeMultiple([
      [firstBatch, s],
      [secondBatch, s2]
    ])
    await wait(wallet, multipleTxn)
    const receipt = await multipleTxn.wait()
    const postBalance = await provider.getBalance(ambireAccountAddress, receipt.blockNumber)
    expect(balance - postBalance).to.equal(ethers.parseEther('0.04'))
  })
})