import { ethers } from 'ethers'
import {
  wallet,
  addressOne,
} from '../config'
import { wait } from '../polling'
import { deployAmbireAccount, deployIdentity } from '../implementations'

let ambireAccountAddress: string
let identityAddress: string

describe('Receive ETH tests', function () {
  it('should successfully deploy the ambire account', async function () {
    const { ambireAccountAddress: addr } = await deployAmbireAccount([
      { addr: addressOne, hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('should successfully deploy the identity', async function () {
    const { identityAddress: addr } = await deployIdentity([
      { addr: addressOne, hash: true }
    ])
    identityAddress = addr
  })
  // fallback handlers
  it('should receive ETH via the receive method of the AmbireAccount and check gas cost', async function () {
    let abi = [
      "function methodNoExist(address, address, uint256, bytes calldata) external pure returns (bytes4)"
    ];
    let iface = new ethers.Interface(abi)
    const calldata = iface.encodeFunctionData('methodNoExist', [
      addressOne,
      addressOne,
      1,
      ethers.getBytes(addressOne)
    ])
    
    const txn = await wallet.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1'),
      data: calldata
    })
    await wait(wallet, txn)
    const receipt = await txn.wait()
    console.log('Ambire account receive ETH through fallback gas used: ' + receipt?.gasUsed)
  })
  it('should receive ETH via the receive method of the Identity and check gas cost', async function () {
    let abi = [
      "function methodNoExist(address, address, uint256, bytes calldata) external pure returns (bytes4)"
    ];
    let iface = new ethers.Interface(abi)
    const calldata = iface.encodeFunctionData('methodNoExist', [
      addressOne,
      addressOne,
      1,
      ethers.getBytes(addressOne)
    ])
    
    const txn = await wallet.sendTransaction({
      to: identityAddress,
      value: ethers.parseEther('1'),
      data: calldata
    })
    await wait(wallet, txn)
    const receipt = await txn.wait()
    console.log('Identity receive ETH through fallback gas used: ' + receipt?.gasUsed)
  })
  it('should receive ETH via the receive method of the AmbireAccount and check gas cost', async function () {
    const txn = await wallet.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    await wait(wallet, txn)
    const receipt = await txn.wait()
    console.log('Ambire account receive ETH through receive gas used: ' + receipt?.gasUsed)
  })
  it('should receive ETH via the receive method of the Identity and check gas cost', async function () {
    const txn = await wallet.sendTransaction({
      to: identityAddress,
      value: ethers.parseEther('1')
    })
    await wait(wallet, txn)
    const receipt = await txn.wait()
    console.log('Identity receive ETH through receive gas used: ' + receipt?.gasUsed)
  })
})
