import { ethers } from 'ethers'
import {
  AmbireAccount,
  wallet,
  addressOne,
  addressTwo,
  chainId,
  wallet2,
  abiCoder,
  addressThree,
  addressFour,
  provider,
  expect,
  assertion
} from '../config'
import { wait } from '../polling'
import { sendFunds, getPriviledgeTxn, getTimelockData } from '../helpers'
import { wrapEthSign } from '../ambireSign'
import { deployAmbireAccount } from '../implementations'

let ambireAccountAddress: string

describe('Basic Ambire Account tests', function () {
  it('successfully deploys the ambire account', async function () {
    const {ambireAccountAddress: addr} = await deployAmbireAccount([
      {addr: addressOne, hash: true}
    ])
    ambireAccountAddress = addr
  })
  it('ONLY_IDENTITY_CAN_CALL on setAddrPrivilege', async function () {
    assertion.expectExpects(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.setAddrPrivilege(addressTwo, ethers.toBeHex(1, 32))
    } catch (error: any) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
    }
  })
  it('ONLY_IDENTITY_CAN_CALL on tryCatch', async function () {
    assertion.expectExpects(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.tryCatch(addressTwo, 1, '0x00')
    } catch (error: any) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
    }
  })
  it('ONLY_IDENTITY_CAN_CALL on tryCatchLimit', async function () {
    assertion.expectExpects(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.tryCatchLimit(addressTwo, 1, '0x00', 100000)
    } catch (error: any) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
    }
  })
  it('ONLY_IDENTITY_CAN_CALL on executeBySelf', async function () {
    assertion.expectExpects(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.executeBySelf([[addressTwo, 1, '0x00']])
    } catch (error: any) {
      expect(error.reason).to.equal('ONLY_IDENTITY_CAN_CALL')
    }
  })
  it('execute should fail if the account does not have privileges', async function () {
    assertion.expectExpects(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const normalTxns = [[addressTwo, ethers.parseEther('0.01'), '0x00']]
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, normalTxns])
    ))
    const s = wrapEthSign(await wallet2.signMessage(msg))
    try {
      await contract.execute(normalTxns, s)
    } catch (error: any) {
      expect(error.reason).to.equal('INSUFFICIENT_PRIVILEGE')
    }
  })
  it('fail on downgrading my own key priviledge', async function () {
    assertion.expectExpects(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const txns = [getPriviledgeTxn(ambireAccountAddress, addressOne, false)]
    const nonce = await contract.nonce()
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [ambireAccountAddress, chainId, nonce, txns])
    ))
    const s = wrapEthSign(await wallet.signMessage(msg))
    try {
      await contract.execute(txns, s)
    } catch (error: any) {
      expect(error.reason).to.equal('PRIVILEGE_NOT_DOWNGRADED')
    }
  })
  it('should successfully set the timelock permission to 1', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)

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
    const fulPerm = contract.executeBySender(unsetPrivTxn)
    await wait(wallet, fulPerm)
    const noTimelock = await contract.privileges(timelockAddress)
    expect(noTimelock).to.equal('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
  it('successfully remove the timelock', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)

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
  it('executeBySender should fail if the account does not have privileges', async function () {
    assertion.expectExpects(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet2)
    try {
      const txns = [[addressOne, 1, '0x00']]
      await contract.executeBySender(txns)
    } catch (error: any) {
      expect(error.reason).to.equal('INSUFFICIENT_PRIVILEGE')
    }
  })
  it('should successfully executeMultiple', async function() {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
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
