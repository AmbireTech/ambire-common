import '@nomicfoundation/hardhat-chai-matchers'

import { expect } from 'chai'
import { hexlify, Wallet } from 'ethers'
import { ethers } from 'hardhat'

describe('Rewards nft', () => {
  let RewardsNftImplementation: any
  let RewardsNftProxy: any
  let rewardsNftContract: any
  let signer: any
  let signer2: any
  let rewardsProxy: any
  let rewardsNftImplementation: any
  beforeEach('successfully deploys the ambire account', async () => {
    RewardsNftImplementation = await ethers.getContractFactory('AmbireRewardsNFTImplementation')
    RewardsNftProxy = await ethers.getContractFactory('AmbireRewardsNFT')
    ;[signer, signer2] = await ethers.getSigners()
    rewardsNftImplementation = await RewardsNftImplementation.deploy()
    rewardsProxy = await RewardsNftProxy.deploy(
      rewardsNftImplementation.target,
      'Ambire Rewards',
      'AMR',
      signer.address
    )
    rewardsNftContract = RewardsNftImplementation.attach(rewardsProxy.target)

    await rewardsNftContract.setBaseUri('random data')
    await rewardsNftContract.setBaseUri('https://staging-relayer.ambire.com/legends/nft-meta/')
  })
  it('token mint', async () => {
    expect(await rewardsNftContract.balanceOf(signer.address)).eq(0)
    await expect(rewardsNftContract.mint(1, 0)).to.not.be.reverted
    await expect(rewardsNftContract.mint(1, 0)).to.be.revertedWith(
      'Mint: already has NFT for current season'
    )
    await expect(rewardsNftContract.connect(signer2).mint(2, 1)).to.not.be.reverted
    // have balances
    expect(await rewardsNftContract.balanceOf(signer.address)).eq(1)
    expect(await rewardsNftContract.balanceOf(signer2.address)).eq(1)
    // storage is correctly set
    expect(await rewardsNftContract.nftIds(signer.address, 0)).eq(1)
    expect(await rewardsNftContract.nftIds(signer2.address, 1)).eq(2)
    expect(await rewardsNftContract.nftIds(signer.address, 1)).eq(0)
    expect(await rewardsNftContract.nftIds(signer2.address, 0)).eq(0)
    expect(await rewardsNftContract.nftIdCounter()).eq(2)
  })

  it('tokenURI', async () => {
    expect(await rewardsNftContract.tokenURI(1)).eq(
      'https://staging-relayer.ambire.com/legends/nft-meta/0x0000000000000000000000000000000000000000/0'
    )
    await rewardsNftContract.mint(1, 1)
    expect(await rewardsNftContract.tokenURI(1)).eq(
      `https://staging-relayer.ambire.com/legends/nft-meta/${signer.address.toLowerCase()}/1`
    )
    await expect(rewardsNftContract.connect(signer2).setBaseUri('')).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('opensea update', async () => {
    const supportsInterface721 = await rewardsNftContract.supportsInterface(hexlify('0x80ac58cd'))
    const supportsInterface721Enumerable = await rewardsNftContract.supportsInterface(
      hexlify('0x780e9d63')
    )
    const supportsInterface4906 = await rewardsNftContract.supportsInterface(hexlify('0x49064906'))
    expect(supportsInterface721).eq(true)
    expect(supportsInterface721Enumerable).eq(true)
    expect(supportsInterface4906).eq(true)
    const tx = await rewardsNftContract.metadataUpdate(1)
    const { logs } = await tx.wait()
    expect(logs.length).to.eq(1)
    expect(logs[0].address).to.eq(rewardsNftContract.target)
    // expect(logs[0].args[0]).to.eq(BigInt(signer.address))
    expect(logs[0].fragment.name).to.eq('MetadataUpdate')
  })

  it('batch mint', async () => {
    const randomAddresses = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()]
    await expect(
      rewardsNftContract.connect(signer2).batchMint([randomAddresses], [2], 0)
    ).to.be.revertedWith('Ownable: caller is not the owner')
    await rewardsNftContract.batchMint([randomAddresses], [2], 0)
    await rewardsNftContract.batchMint([randomAddresses], [2], 1)
    expect(await rewardsNftContract.nftIds(randomAddresses[0], 0)).eq(1)
    expect(await rewardsNftContract.nftIds(randomAddresses[1], 0)).eq(2)
    expect(await rewardsNftContract.nftIds(randomAddresses[2], 0)).eq(3)
    expect(await rewardsNftContract.nftTypes(randomAddresses[0], 0)).eq(2)
    expect(await rewardsNftContract.nftTypes(randomAddresses[1], 0)).eq(2)
    expect(await rewardsNftContract.nftTypes(randomAddresses[2], 0)).eq(2)
  })

  it('set season', async () => {
    await expect(rewardsNftContract.connect(signer2).setSeason(2)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
    await expect(rewardsNftContract.mint(2, 2)).to.be.revertedWith('Mint: wrong season requested')

    rewardsNftContract.setSeason(2)
    await rewardsNftContract.mint(2, 2)
  })
})
