import { ethers } from 'hardhat'
import {
  AmbireAccount,
  addressOne,
  addressTwo,
  chainId,
  abiCoder,
  addressThree,
  addressFour,
  provider,
  expect
} from '../config'
import { sendFunds, getPriviledgeTxn, getTimelockData } from '../helpers'
import { wrapEthSign } from '../ambireSign'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { AccountOp, Call, accountOpSignableHash } from '../../src/libs/accountOp/accountOp'

let ambireAccountAddress: string

describe('Basic Ambire Account tests', function () {
  it('successfully deploys the ambire account', async function () {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('ONLY_IDENTITY_CAN_CALL on setAddrPrivilege', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.setAddrPrivilege(addressTwo, ethers.toBeHex(1, 32)))
      .to.be.revertedWith('ONLY_IDENTITY_CAN_CALL')
  })
  it('ONLY_IDENTITY_CAN_CALL on tryCatch', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.tryCatch(addressTwo, 1, '0x00'))
      .to.be.revertedWith('ONLY_IDENTITY_CAN_CALL')
  })
  it('ONLY_IDENTITY_CAN_CALL on tryCatchLimit', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.tryCatchLimit(addressTwo, 1, '0x00', 100000))
      .to.be.revertedWith('ONLY_IDENTITY_CAN_CALL')
  })
  it('ONLY_IDENTITY_CAN_CALL on executeBySelf', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.executeBySelf([[addressTwo, 1, '0x00']]))
      .to.be.revertedWith('ONLY_IDENTITY_CAN_CALL')
  })
  it('execute should fail if the account does not have privileges', async function () {
    const [signer, signer2] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const normalTxns = [[addressTwo, ethers.parseEther('0.01'), '0x00']]
    const msg = ethers.getBytes(
      ethers.keccak256(
        abiCoder.encode(
          ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
          [ambireAccountAddress, chainId, nonce, normalTxns]
        )
      )
    )
    const s = wrapEthSign(await signer2.signMessage(msg))
    await expect(contract.execute(normalTxns, s))
      .to.be.revertedWith('INSUFFICIENT_PRIVILEGE')
  })
  it('fail on downgrading my own key priviledge', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const txns = [getPriviledgeTxn(ambireAccountAddress, addressOne, false)]
    const nonce = await contract.nonce()
    const msg = ethers.getBytes(
      ethers.keccak256(
        abiCoder.encode(
          ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
          [ambireAccountAddress, chainId, nonce, txns]
        )
      )
    )
    const s = wrapEthSign(await signer.signMessage(msg))
    await expect(contract.execute(txns, s))
      .to.be.revertedWith('PRIVILEGE_NOT_DOWNGRADED')
  })
  it('should successfully set the timelock permission to 1', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    // first, add the timelock
    const { hash, timelockAddress } = getTimelockData()
    const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [timelockAddress, hash])
    const setPrivTxn = [
      {
        to: ambireAccountAddress,
        value: 0,
        data: calldata
      }
    ]
    await contract.executeBySender(setPrivTxn)
    const hasTimelock = await contract.privileges(timelockAddress)
    expect(hasTimelock).to.equal(hash)

    // unset it
    const calldata2 = iface.encodeFunctionData('setAddrPrivilege', [
      timelockAddress,
      ethers.toBeHex(1, 32)
    ])
    const unsetPrivTxn = [
      {
        to: ambireAccountAddress,
        value: 0,
        data: calldata2
      }
    ]
    await contract.executeBySender(unsetPrivTxn)
    const noTimelock = await contract.privileges(timelockAddress)
    expect(noTimelock).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    )
  })
  it('successfully remove the timelock', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)

    // first, add the timelock
    const { hash, timelockAddress } = getTimelockData()
    const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [timelockAddress, hash])
    const setPrivTxn = [
      {
        to: ambireAccountAddress,
        value: 0,
        data: calldata
      }
    ]
    await contract.executeBySender(setPrivTxn)
    const hasTimelock = await contract.privileges(timelockAddress)
    expect(hasTimelock).to.equal(hash)

    // unset it
    const calldata2 = iface.encodeFunctionData('setAddrPrivilege', [
      timelockAddress,
      ethers.toBeHex(0, 32)
    ])
    const unsetPrivTxn = [
      {
        to: ambireAccountAddress,
        value: 0,
        data: calldata2
      }
    ]
    await contract.executeBySender(unsetPrivTxn)
    const noTimelock = await contract.privileges(timelockAddress)
    expect(noTimelock).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    )
  })
  it('executeBySender should fail if the account does not have privileges', async function () {
    const [, signer2] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer2)
    const txns = [[addressOne, 1, '0x00']]
    await expect(contract.executeBySender(txns))
      .to.be.revertedWith('INSUFFICIENT_PRIVILEGE')
  })
  it('should successfully executeMultiple', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const firstBatch = [
      [addressTwo, ethers.parseEther('0.01'), '0x00'],
      [addressThree, ethers.parseEther('0.01'), '0x00']
    ]
    const msg = ethers.getBytes(
      ethers.keccak256(
        abiCoder.encode(
          ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
          [ambireAccountAddress, chainId, nonce, firstBatch]
        )
      )
    )
    const s = wrapEthSign(await signer.signMessage(msg))
    const secondBatch = [
      [addressOne, ethers.parseEther('0.01'), '0x00'],
      [addressFour, ethers.parseEther('0.01'), '0x00']
    ]
    const msg2 = ethers.getBytes(
      ethers.keccak256(
        abiCoder.encode(
          ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
          [ambireAccountAddress, chainId, nonce + ethers.toBigInt(1), secondBatch]
        )
      )
    )
    const s2 = wrapEthSign(await signer.signMessage(msg2))
    const balance = await provider.getBalance(ambireAccountAddress)
    const multipleTxn = await contract.executeMultiple([
      [firstBatch, s],
      [secondBatch, s2]
    ])
    const receipt = await multipleTxn.wait()
    const postBalance = await provider.getBalance(ambireAccountAddress, receipt.blockNumber)
    expect(balance - postBalance).to.equal(ethers.parseEther('0.04'))
  })
  it('should successfully execute a txn using accountOpSignableHash', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const txns: Call[] = [
      {to: addressTwo, value: ethers.parseEther('0.01'), data: '0x00'},
      {to: addressThree, value: ethers.parseEther('0.01'), data: '0x00'},
    ]
    const op: AccountOp = {
      accountAddr: ambireAccountAddress,
      networkId: 'hardhat',
      signingKeyAddr: null,
      nonce,
      calls: txns,
      gasLimit: null,
      signature: null,
      gasFeePayment: null,
      accountOpToExecuteBefore: null
    }
    const msg = accountOpSignableHash(op)
    const s = wrapEthSign(await signer.signMessage(msg))
    const balance = await provider.getBalance(ambireAccountAddress)
    const txn = await contract.execute(txns, s)
    const receipt = await txn.wait()
    const postBalance = await provider.getBalance(ambireAccountAddress, receipt.blockNumber)
    expect(balance - postBalance).to.equal(ethers.parseEther('0.02'))
  })
  it('should revert with INSUFFICIENT_PRIVILEGE when executing a txn if the hash is not signed as Uint8Array', async function () {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const txns = [
      [addressTwo, ethers.parseEther('0.01'), '0x00'],
      [addressThree, ethers.parseEther('0.01'), '0x00']
    ]
    // we skip calling ethers.getBytes to confirm it is not
    // working without it
    const msg = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, nonce, txns]
      )
    )
    const s = wrapEthSign(await signer.signMessage(msg))
    await expect(contract.execute(txns, s))
      .to.be.revertedWith('INSUFFICIENT_PRIVILEGE')
  })
})
