import { ethers } from 'ethers'
import {
  AmbireAccount,
  wallet,
  addressOne,
  addressTwo,  
} from '../../../test/config'
import { wait } from '../../../test/polling'
import { describe, expect, test } from '@jest/globals'
import { compile } from '../../../v2/libs/deployless/compile'

// compile the nft check contract
const nftContractCode = compile('NFTCheck', {
  contractsFolder: 'test/contracts'
})

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

let nftCheckAddress: string
async function deployNftCheck() {
  const factory = new ethers.ContractFactory(nftContractCode.abi, nftContractCode.bytecode, wallet)
  const contract: any = await factory.deploy([addressOne])
  await wait(wallet, contract)
  expect(await contract.getAddress()).not.toBe(null)
  const isSigner = await contract.privileges(addressOne)
  expect(isSigner).toBe('0x0000000000000000000000000000000000000000000000000000000000000001')
  nftCheckAddress = await contract.getAddress()
  return {contract}
}

describe('NFT 721 and 1155 tests original contract tests', function () {
  test('successfully deploys the ambire account', async function () {
    await deployAmbireAccount()
  })
  test('should call onERC721Received and return its signature', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const result = await contract.onERC721Received(addressOne, addressTwo, 1, '0x00')
    const abi = [
      'function onERC721Received(address,address,uint256,bytes)'
    ]
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC721Received')?.selector
    expect(result).toBe(signature)
    expect(result).toBe('0x150b7a02')
  })
  test('should call onERC1155Received and return its signature', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const result = await contract.onERC1155Received(addressOne, addressTwo, 1, 2, '0x00')
    const abi = [
      'function onERC1155Received(address, address, uint256, uint256, bytes calldata)'
    ]
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC1155Received')?.selector
    expect(result).toBe(signature)
    expect(result).toBe('0xf23a6e61')
  })
  test('should call onERC1155BatchReceived and return its signature', async function () {
    const contract: any = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, wallet)
    const result = await contract.onERC1155BatchReceived(addressOne, addressTwo, [1,2], [3,4], '0x00')
    const abi = [
      'function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes calldata)'
    ]
    const iface = new ethers.Interface(abi)
    const signature = iface.getFunction('onERC1155BatchReceived')?.selector
    expect(result).toBe(signature)
    expect(result).toBe('0xbc197c81')
  })
})

describe('NFT 721 and 1155 fallback contract tests', function () {
  test('successfully deploys the nft check contract', async function () {
    await deployNftCheck()
  })
  test('should call onERC721Received and return its signature', async function () {
    const abi = [
      'function onERC721Received(address,address,uint256,bytes)'
    ]
    const iface = new ethers.Interface(abi)
    const calldata = iface.encodeFunctionData('onERC721Received', [ addressOne, addressTwo, 1, '0x00' ])
    const result = await wallet.call({
      to: nftCheckAddress,
      data: calldata
    })
    const signature = iface.getFunction('onERC721Received')?.selector + '00000000000000000000000000000000000000000000000000000000'
    expect(result).toBe(signature)
    expect(result).toBe('0x150b7a0200000000000000000000000000000000000000000000000000000000')
  })
  test('should call onERC1155Received and return its signature', async function () {
    const abi = [
      'function onERC1155Received(address, address, uint256, uint256, bytes calldata)'
    ]
    const iface = new ethers.Interface(abi)
    const calldata = iface.encodeFunctionData('onERC1155Received', [ addressOne, addressTwo, 1, 2, '0x00' ])
    const result = await wallet.call({
      to: nftCheckAddress,
      data: calldata
    })
    const signature = iface.getFunction('onERC1155Received')?.selector + '00000000000000000000000000000000000000000000000000000000'
    expect(result).toBe(signature)
    expect(result).toBe('0xf23a6e6100000000000000000000000000000000000000000000000000000000')
  })
  test('should call onERC1155BatchReceived and return its signature', async function () {
    const abi = [
      'function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes calldata)'
    ]
    const iface = new ethers.Interface(abi)
    const calldata = iface.encodeFunctionData('onERC1155BatchReceived', [ addressOne, addressTwo, [1,2], [3,4], '0x00' ])
    const result = await wallet.call({
      to: nftCheckAddress,
      data: calldata
    })
    const signature = iface.getFunction('onERC1155BatchReceived')?.selector + '00000000000000000000000000000000000000000000000000000000'
    expect(result).toBe(signature)
    expect(result).toBe('0xbc197c8100000000000000000000000000000000000000000000000000000000')
  })
})

describe('Compare gas usage on both contracts', () => {
  test('alalabal', async () => {
    const abi = [
      'function onERC721Received(address,address,uint256,bytes)'
    ]
    const iface = new ethers.Interface(abi)
    const calldata = iface.encodeFunctionData('onERC721Received', [ addressOne, addressTwo, 1, '0x00' ])
    const ambireCall = await wallet.sendTransaction({
      to: ambireAccountAddress,
      data: calldata
    })
    await wait(wallet, ambireCall)
    const ambireTxn: any = await ambireCall.wait()

    const nftCall = await wallet.sendTransaction({
      to: nftCheckAddress,
      data: calldata
    })
    await wait(wallet, nftCall)
    const nftTxn: any = await nftCall.wait()

    console.log(ambireTxn.gasUsed)
    console.log(nftTxn.gasUsed)
  })
})