import { ethers } from 'hardhat'

import { addressOne, expect } from '../config'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

let ambireAccountAddress: string

describe('Receive ETH tests', () => {
  it('should successfully deploy the ambire account', async () => {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      {
        addr: signer.address,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002'
      }
    ])
    ambireAccountAddress = addr
  })
  it('should receive ETH via the fallback method of the AmbireAccount and check gas cost', async () => {
    const [signer] = await ethers.getSigners()
    const abi = [
      'function methodNoExist(address, address, uint256, bytes calldata) external pure returns (bytes4)'
    ]
    const iface = new ethers.Interface(abi)
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
    expect(receipt.gasUsed).to.be.lessThan(32000n)
  })
  it('should receive ETH via the receive method of the AmbireAccount and check gas cost', async () => {
    const [signer] = await ethers.getSigners()
    const txn = await signer.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    const receipt: any = await txn.wait()
    expect(receipt.gasUsed).to.be.lessThan(24000n)
  })
})
