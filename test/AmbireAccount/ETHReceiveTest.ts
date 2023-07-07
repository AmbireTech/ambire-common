import { ethers } from 'hardhat'
import {
  addressOne,
  expect,
} from '../config'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

let ambireAccountAddress: string

describe('Receive ETH tests', function () {
  it('should successfully deploy the ambire account', async function () {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true }
    ])
    ambireAccountAddress = addr
  })
  it('should receive ETH via the fallback method of the AmbireAccount and check gas cost', async function () {
    const [signer] = await ethers.getSigners()
    let abi = [
      'function methodNoExist(address, address, uint256, bytes calldata) external pure returns (bytes4)'
    ]
    let iface = new ethers.Interface(abi)
    const calldata = iface.encodeFunctionData('methodNoExist', [
      addressOne,
      addressOne,
      1,
      ethers.getBytes(addressOne)
    ])
    
    const txn = await signer.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1'),
      data: calldata
    })
    const receipt: any = await txn.wait()
    expect(parseInt(receipt.gasUsed)).to.be.lessThan(32000)
  })
  it('should receive ETH via the receive method of the AmbireAccount and check gas cost', async function () {
    const [signer] = await ethers.getSigners()
    const txn = await signer.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    const receipt: any = await txn.wait()
    expect(parseInt(receipt.gasUsed)).to.be.lessThan(24000)
  })
})
