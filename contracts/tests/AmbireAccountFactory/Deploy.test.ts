import { ethers } from 'ethers'
import {
  AmbireAccount,
  AmbireAccountFactory,
  wallet,
  wallet2,
  addressOne,
  addressTwo,
  chainId
} from '../../../test/config'
import { wait } from '../../../test/polling'
import { wrapEthSign } from '../../../test/ambireSign'
import { describe, expect, test } from '@jest/globals'
const salt = 0
const abiCoder = new ethers.AbiCoder()

let factoryAddress: string
let factoryContract: any

function getAmbireAccountAddress(bytecode: string) {
  return ethers.getCreate2Address(factoryAddress, ethers.toBeHex(salt, 32), ethers.keccak256(bytecode))
}

describe('AmbireAccountFactory tests', function(){
  test('deploys the factory', async function(){
    const contractFactory = new ethers.ContractFactory(AmbireAccountFactory.abi, AmbireAccountFactory.bytecode, wallet)
    const factory = await contractFactory.deploy(addressOne)
    await wait(wallet, factory)
    expect(await factory.getAddress()).not.toBe(null)

    factoryAddress = await factory.getAddress()
    factoryContract = new ethers.BaseContract(factoryAddress, AmbireAccountFactory.abi, wallet)
  })
  test('deploys the ambire account via the factory; no revert upon redeploy to same address', async function(){
    const data = abiCoder.encode(['address[]'], [[addressOne]])
    const bytecode = ethers.concat([
      AmbireAccount.bytecode,
      data
    ])
    const accountAddr = getAmbireAccountAddress(bytecode)
    const factoryDeploy = await factoryContract.deploy(bytecode, salt)
    await wait(wallet, factoryDeploy)
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, wallet)
    const canSign = await ambireAccount.privileges(addressOne)
    expect(canSign).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')

    // just confirm that no reverts happen
    const reDeploy = await factoryContract.deploy(bytecode, salt)
    await wait(wallet, reDeploy)
  })
  test('deploy the contract and execute a transaction along with the deploy', async function(){
    const data = abiCoder.encode(['address[]'], [[addressTwo]])
    const bytecode = ethers.concat([
      AmbireAccount.bytecode,
      data
    ])
    const accountAddr = getAmbireAccountAddress(bytecode)

    const setAddrPrivilegeABI = [
      'function setAddrPrivilege(address addr, bytes32 priv)'
    ]
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [ addressOne, ethers.toBeHex(1, 32) ])
    const setPrivTxn = [[accountAddr, 0, calldata]]
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [accountAddr, chainId, 0, setPrivTxn])
    ))
    const s = wrapEthSign(await wallet2.signMessage(msg))
    const factoryDeployAndExecute = await factoryContract.deployAndExecute(bytecode, salt, setPrivTxn, s)
    await wait(wallet, factoryDeployAndExecute)
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, wallet)
    const canSignOne = await ambireAccount.privileges(addressOne)
    expect(canSignOne).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
    const canSignTwo = await ambireAccount.privileges(addressTwo)
    expect(canSignTwo).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
  test('deploy and execute on an already deployed contract - it should execute the call', async function(){
    const data = abiCoder.encode(['address[]'], [[addressOne]])
    const bytecode = ethers.concat([
      AmbireAccount.bytecode,
      data
    ])
    const accountAddr = getAmbireAccountAddress(bytecode)

    const setAddrPrivilegeABI = [
      'function setAddrPrivilege(address addr, bytes32 priv)'
    ]
    const iface = new ethers.Interface(setAddrPrivilegeABI)
    const calldata = iface.encodeFunctionData('setAddrPrivilege', [ addressTwo, ethers.toBeHex(1, 32) ])
    const setPrivTxn = [[accountAddr, 0, calldata]]
    const msg = ethers.getBytes(ethers.keccak256(
      abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [accountAddr, chainId, 0, setPrivTxn])
    ))
    const s = wrapEthSign(await wallet.signMessage(msg))
    const factoryDeployAndExecute = await factoryContract.deployAndExecute(bytecode, salt, setPrivTxn, s)
    await wait(wallet, factoryDeployAndExecute)
    const ambireAccount: any = new ethers.BaseContract(accountAddr, AmbireAccount.abi, wallet)
    const canSignTwo = await ambireAccount.privileges(addressTwo)
    expect(canSignTwo).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
  })
})