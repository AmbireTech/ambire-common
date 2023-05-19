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
} from '../../../test/config'
import { wait } from '../../../test/polling'
import { sendFunds, getPriviledgeTxn, getTimelockData } from '../../../test/helpers'
import { wrapEthSign } from '../../../test/ambireSign'
import { describe, expect, test } from '@jest/globals'

let ambireAccountAddress: string
async function deployAmbireAccount() {
  const factory = new ethers.ContractFactory(AmbireAccount.abi, AmbireAccount.bytecode, wallet)
  const contract: any = await factory.deploy([addressOne])
  await wait(wallet, contract)
  expect(await contract.getAddress()).not.toBe(null)
  const isSigner = await contract.privileges(addressOne)
  expect(isSigner).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
  ambireAccountAddress = await contract.getAddress()
  return {contract}
}

describe('Basic Ambire Account tests', function () {
  test('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  test('ONLY_IDENTITY_CAN_CALL on setAddrPrivilege', async function () {
    expect.assertions(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.setAddrPrivilege(addressTwo, ethers.toBeHex(1, 32))
    } catch (error: any) {
      expect(error.reason).toBe('ONLY_IDENTITY_CAN_CALL')
    }
  })
  test('ONLY_IDENTITY_CAN_CALL on tryCatch', async function () {
    expect.assertions(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.tryCatch(addressTwo, 1, '0x00')
    } catch (error: any) {
      expect(error.reason).toBe('ONLY_IDENTITY_CAN_CALL')
    }
  })
  test('ONLY_IDENTITY_CAN_CALL on tryCatchLimit', async function () {
    expect.assertions(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.tryCatchLimit(addressTwo, 1, '0x00', 100000)
    } catch (error: any) {
      expect(error.reason).toBe('ONLY_IDENTITY_CAN_CALL')
    }
  })
  test('ONLY_IDENTITY_CAN_CALL on executeBySelf', async function () {
    expect.assertions(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.executeBySelf([[addressTwo, 1, '0x00']])
    } catch (error: any) {
      expect(error.reason).toBe('ONLY_IDENTITY_CAN_CALL')
    }
  })
  test('execute should fail if the account does not have privileges', async function () {
    expect.assertions(1)
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
      expect(error.reason).toBe('INSUFFICIENT_PRIVILEGE')
    }
  })
  test('fail on downgrading my own key priviledge', async function () {
    expect.assertions(1)
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
      expect(error.reason).toBe('PRIVILEGE_NOT_DOWNGRADED')
    }
  })
  test('should successfully set the timelock permission to 1', async function () {
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
    expect(hasTimelock).toBe(hash)

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
    expect(noTimelock).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
  test('successfully remove the timelock', async function () {
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
    expect(hasTimelock).toBe(hash)

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
    expect(noTimelock).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
  })
  test('executeBySender should fail if the account does not have privileges', async function () {
    expect.assertions(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet2)
    try {
      const txns = [[addressOne, 1, '0x00']]
      await contract.executeBySender(txns)
    } catch (error: any) {
      expect(error.reason).toBe('INSUFFICIENT_PRIVILEGE')
    }
  })
  test('executeBatch should fail if an empty array is passed', async function () {
    expect.assertions(1)
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    try {
      await contract.executeBySender([])
    } catch (error: any) {
      expect(error.reason).toBe('MUST_PASS_TX')
    }
  })
  test('should successfully executeMultiple', async function() {
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
    expect(balance - postBalance).toBe(ethers.parseEther('0.04'))
  })
})