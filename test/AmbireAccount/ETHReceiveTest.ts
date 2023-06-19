import { ethers } from 'ethers'
import {
  wallet,
  addressOne,
  expect,
} from '../config'
import { wait } from '../polling'
import { deployAmbireAccount } from '../implementations'

let ambireAccountAddress: string
let identityAddress: string

describe('Receive ETH tests', function () {
  it('should successfully deploy the ambire account', async function () {
    const { ambireAccountAddress: addr } = await deployAmbireAccount([
      { addr: addressOne, hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('should receive ETH via the fallback method of the AmbireAccount and check gas cost', async function () {
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
    const receipt: any = await txn.wait()
    expect(parseInt(receipt.gasUsed)).to.be.lessThan(32000)
  })
  it('should receive ETH via the receive method of the AmbireAccount and check gas cost', async function () {
    const txn = await wallet.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    await wait(wallet, txn)
    const receipt: any = await txn.wait()
    expect(parseInt(receipt.gasUsed)).to.be.lessThan(24000)
  })
})
