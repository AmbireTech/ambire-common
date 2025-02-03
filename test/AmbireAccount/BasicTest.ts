import { hashMessage } from 'ethers'
import { ethers } from 'hardhat'

import { getExecute712Data, wrapEIP712 } from '../ambireSign'
import {
  abiCoder,
  addressFour,
  addressOne,
  addressThree,
  addressTwo,
  AmbireAccount,
  chainId,
  expect,
  provider
} from '../config'
import { getPriviledgeTxn, getTimelockData, sendFunds } from '../helpers'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

let ambireAccountAddress: string

describe('Basic Ambire Account tests', () => {
  before('successfully deploys the ambire account', async () => {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      {
        addr: signer.address,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ])
    ambireAccountAddress = addr
  })
  it('should successfully perform execute and validate that the nonce has moved', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const txns: [string, string, string][] = [
      [addressTwo, ethers.parseEther('0.01').toString(), '0x'],
      [addressThree, ethers.parseEther('0.01').toString(), '0x']
    ]
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, nonce, txns]
      )
    )
    const typedData = getExecute712Data(chainId, nonce, txns, ambireAccountAddress, executeHash)
    const s = wrapEIP712(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    await contract.execute(txns, s)
    const nonceAfterExecute = await contract.nonce()
    expect(nonceAfterExecute).to.equal(nonce + 1n)
  })
  it('ONLY_ACCOUNT_CAN_CALL on setAddrPrivilege', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.setAddrPrivilege(addressTwo, ethers.toBeHex(1, 32))).to.be.revertedWith(
      'ONLY_ACCOUNT_CAN_CALL'
    )
  })
  it('ONLY_ACCOUNT_CAN_CALL on tryCatch', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.tryCatch(addressTwo, 1, '0x00')).to.be.revertedWith(
      'ONLY_ACCOUNT_CAN_CALL'
    )
  })
  it('ONLY_ACCOUNT_CAN_CALL on tryCatchLimit', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.tryCatchLimit(addressTwo, 1, '0x00', 100000)).to.be.revertedWith(
      'ONLY_ACCOUNT_CAN_CALL'
    )
  })
  it('ONLY_ACCOUNT_CAN_CALL on executeBySelf', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await expect(contract.executeBySelf([[addressTwo, 1, '0x00']])).to.be.revertedWith(
      'ONLY_ACCOUNT_CAN_CALL'
    )
  })
  it('execute should fail if the account does not have privileges', async () => {
    const [signer, signer2] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const normalTxns: [string, string, string][] = [
      [addressTwo, ethers.parseEther('0.01').toString(), '0x00']
    ]
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, nonce, normalTxns]
      )
    )
    const typedData = getExecute712Data(
      chainId,
      nonce,
      normalTxns,
      ambireAccountAddress,
      executeHash
    )
    const s = wrapEIP712(
      await signer2.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    await expect(contract.execute(normalTxns, s)).to.be.revertedWith('INSUFFICIENT_PRIVILEGE')
  })
  it('fail on downgrading my own key priviledge', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const txns: [string, string, string][] = [
      getPriviledgeTxn(ambireAccountAddress, addressOne, false)
    ]
    const nonce = await contract.nonce()
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, nonce, txns]
      )
    )
    const typedData = getExecute712Data(chainId, nonce, txns, ambireAccountAddress, executeHash)
    const s = wrapEIP712(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    await expect(contract.execute(txns, s)).to.be.revertedWith('PRIVILEGE_NOT_DOWNGRADED')
  })
  it('should successfully set the timelock permission to 1', async () => {
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
  it('successfully remove the timelock', async () => {
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
  it('executeBySender should fail if the account does not have privileges', async () => {
    const [, signer2] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer2)
    const txns = [[addressOne, 1, '0x00']]
    await expect(contract.executeBySender(txns)).to.be.revertedWith('INSUFFICIENT_PRIVILEGE')
  })
  it('should successfully executeMultiple', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const firstBatch: [string, string, string][] = [
      [addressTwo, ethers.parseEther('0.01').toString(), '0x00'],
      [addressThree, ethers.parseEther('0.01').toString(), '0x00']
    ]
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, nonce, firstBatch]
      )
    )
    const typedData = getExecute712Data(
      chainId,
      nonce,
      firstBatch,
      ambireAccountAddress,
      executeHash
    )
    const s = wrapEIP712(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const secondBatch: [string, string, string][] = [
      [addressOne, ethers.parseEther('0.01').toString(), '0x00'],
      [addressFour, ethers.parseEther('0.01').toString(), '0x00']
    ]
    const incrementedNonce = nonce + ethers.toBigInt(1)
    const executeHash2 = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, incrementedNonce, secondBatch]
      )
    )
    const typedData2 = getExecute712Data(
      chainId,
      incrementedNonce,
      secondBatch,
      ambireAccountAddress,
      executeHash2
    )
    const s2 = wrapEIP712(
      await signer.signTypedData(typedData2.domain, typedData2.types, typedData2.value)
    )
    const balance = await provider.getBalance(ambireAccountAddress)
    const multipleTxn = await contract.executeMultiple([
      [firstBatch, s],
      [secondBatch, s2]
    ])
    const receipt = await multipleTxn.wait()
    const postBalance = await provider.getBalance(ambireAccountAddress, receipt.blockNumber)
    expect(balance - postBalance).to.equal(ethers.parseEther('0.04'))
  })
  it('should successfully execute a txn using accountOpSignableHash', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    await sendFunds(ambireAccountAddress, 1)
    const nonce = await contract.nonce()
    const txns: [string, string, string][] = [
      [addressTwo, ethers.parseEther('0.01').toString(), '0x00'],
      [addressThree, ethers.parseEther('0.01').toString(), '0x00']
    ]
    const executeHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, chainId, nonce, txns]
      )
    )
    const typedData = getExecute712Data(chainId, nonce, txns, ambireAccountAddress, executeHash)
    const s = wrapEIP712(
      await signer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const balance = await provider.getBalance(ambireAccountAddress)
    const txn = await contract.execute(txns, s)
    const receipt = await txn.wait()
    const postBalance = await provider.getBalance(ambireAccountAddress, receipt.blockNumber)
    expect(balance - postBalance).to.equal(ethers.parseEther('0.02'))
  })
  it('should allow a signed message to validate for the signer with a signature length of 65', async () => {
    const [signer] = await ethers.getSigners()
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signer)
    const msg = 'message does not matter'
    const s = await signer.signMessage(msg)
    const isValid = await contract.isValidSignature(hashMessage(msg), s)
    const isValidStandardWrap = await contract.isValidSignature(hashMessage(msg), wrapEIP712(s))
    expect(isValid).to.equal('0x1626ba7e')
    expect(isValidStandardWrap).to.equal('0x1626ba7e')
  })
})
