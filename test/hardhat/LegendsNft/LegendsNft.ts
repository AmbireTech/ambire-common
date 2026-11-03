import '@nomicfoundation/hardhat-chai-matchers'

import { expect } from 'chai'
import { hexlify } from 'ethers'
import { ethers } from 'hardhat'

describe('Legends nft', () => {
  let legendsNftContract: any
  let signer: any
  let signer2: any
  let signer3: any
  let proxyAsProxy: any
  let proxyAsImplementation: any
  beforeEach('successfully deploys the ambire account', async () => {
    ;[signer, signer2, signer3] = await ethers.getSigners()
    const LegendsNftContract = await ethers.getContractFactory('LegendsNFTImplementation')
    legendsNftContract = await LegendsNftContract.deploy()
    const LegendsProxy = await ethers.getContractFactory('LegendsNFT')
    proxyAsProxy = await LegendsProxy.deploy(legendsNftContract.target, 'Ambire Legends', 'AML')
    proxyAsImplementation = LegendsNftContract.attach(proxyAsProxy.target)

    await legendsNftContract.setBaseUri('random data')
    await legendsNftContract.setBaseUri('https://staging-relayer.ambire.com/legends/nft-meta/')
  })
  it('token mint', async () => {
    expect(await legendsNftContract.balanceOf(signer.address)).eq(0)
    await expect(legendsNftContract.mint(1)).to.not.be.reverted
    expect(await legendsNftContract.balanceOf(signer.address)).eq(1)
    await expect(legendsNftContract.mint(1)).to.be.revertedWith('ERC721: token already minted')
    expect(await legendsNftContract.balanceOf(signer.address)).eq(1)
    await expect(legendsNftContract.connect(signer2).mint(2)).to.not.be.reverted
    expect(await legendsNftContract.balanceOf(signer2.address)).eq(1)
  })

  it('tokenURI', async () => {
    expect(await legendsNftContract.tokenURI(BigInt(signer.address))).eq(
      `https://staging-relayer.ambire.com/legends/nft-meta/${signer.address.toLowerCase()}`
    )
    await legendsNftContract.mint(1)
    expect(await legendsNftContract.tokenURI(BigInt(signer.address))).eq(
      `https://staging-relayer.ambire.com/legends/nft-meta/${signer.address.toLowerCase()}`
    )
  })

  it('set base uri not owner', async () => {
    await expect(legendsNftContract.connect(signer2).setBaseUri('')).to.be.revertedWith(
      'Ownable: caller is not the owner'
    )
  })

  it('try to transfer or approve', async () => {
    await legendsNftContract.mint(2)
    await legendsNftContract.connect(signer2).mint(2)

    await expect(
      legendsNftContract.transferFrom(signer.address, signer2.address, BigInt(signer.address))
    ).to.be.revertedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract.safeTransferFrom(signer.address, signer2.address, BigInt(signer.address))
    ).to.be.revertedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract['safeTransferFrom(address,address,uint256,bytes)'](
        signer.address,
        signer2.address,
        BigInt(signer.address),
        ethers.toUtf8Bytes('asd')
      )
    ).to.be.revertedWith('Soulbound: cannot transfer nft')
    await expect(
      legendsNftContract.approve(signer2.address, BigInt(signer.address))
    ).to.be.revertedWith('Soulbound: cannot approve token transfer')

    await expect(legendsNftContract.setApprovalForAll(signer2.address, true)).to.be.revertedWith(
      'Soulbound: cannot set approval for all'
    )

    await legendsNftContract.setAllowTransfer(true)
    await expect(
      legendsNftContract.connect(signer2).burn(BigInt(signer.address))
    ).to.be.revertedWith('You cannot burn this NFT.')

    await legendsNftContract.burn(BigInt(signer.address))
    await legendsNftContract.burn(BigInt(signer2.address))
    await expect(legendsNftContract.ownerOf(BigInt(signer.address))).to.be.revertedWith(
      'ERC721: invalid token ID'
    )
    await expect(legendsNftContract.ownerOf(BigInt(signer2.address))).to.be.revertedWith(
      'ERC721: invalid token ID'
    )
    await legendsNftContract.mint(2)
    expect(await legendsNftContract.ownerOf(BigInt(signer.address))).eq(signer.address)
  })
  it('opensea update', async () => {
    const supportsInterface721 = await legendsNftContract.supportsInterface(hexlify('0x80ac58cd'))
    const supportsInterface721Enumerable = await legendsNftContract.supportsInterface(
      hexlify('0x780e9d63')
    )
    const supportsInterface4906 = await legendsNftContract.supportsInterface(hexlify('0x49064906'))
    expect(supportsInterface721).eq(true)
    expect(supportsInterface721Enumerable).eq(true)
    expect(supportsInterface4906).eq(true)
    await legendsNftContract.mint(1)
    const tx = await legendsNftContract.updateMetadata([0n, 1n, BigInt(signer.address)])
    const { logs } = await tx.wait()
    expect(logs.length).to.eq(1)
    expect(logs[0].address).to.eq(legendsNftContract.target)
    expect(logs[0].args[0]).to.eq(BigInt(signer.address))
    expect(logs[0].fragment.name).to.eq('MetadataUpdate')
  })
  it('basic test for upgradable proxy', async () => {
    const implementation = legendsNftContract.target
    expect(await proxyAsImplementation.name()).eq('Ambire Legends')
    expect(proxyAsImplementation.target).eq(proxyAsProxy.target)
    expect(await proxyAsProxy.implementation()).eq(implementation)
    expect(await proxyAsProxy.admin()).eq(signer.address)
    await proxyAsImplementation.mint(2)
    expect(await proxyAsImplementation.ownerOf(BigInt(signer.address))).eq(signer.address)
    expect(await proxyAsImplementation.pickedCharacters(signer.address)).eq(2)
    const LegendsNftContract = await ethers.getContractFactory('LegendsNFTImplementation')
    const secondImplementation = await LegendsNftContract.deploy()
    await proxyAsProxy.setImplementation(secondImplementation.target)
    expect(await proxyAsProxy.implementation()).eq(secondImplementation.target)
    expect(await proxyAsImplementation.ownerOf(BigInt(signer.address))).eq(signer.address)
    expect(await proxyAsImplementation.pickedCharacters(signer.address)).eq(2)
    await proxyAsImplementation.connect(signer2).mint(1)
    expect(await proxyAsImplementation.pickedCharacters(signer2.address)).eq(1)
    expect(await proxyAsImplementation.pickedCharacters(signer3.address)).eq(0)
    expect(await legendsNftContract.pickedCharacters(signer.address)).eq(0)
    const randomUri = 'https://staging-relayer.ambire.com/legends/nft-meta/'
    const randomUri2 = 'https://relayer.ambire.com/legends/nft-meta/'
    await proxyAsImplementation.setBaseUri(randomUri)
    expect(await proxyAsImplementation.tokenURI(BigInt(signer.address))).eq(
      randomUri + signer.address.toLowerCase()
    )
    await proxyAsImplementation.transferOwnership(signer2.address)
    await proxyAsImplementation.connect(signer2).setBaseUri(randomUri2)
    expect(await proxyAsImplementation.tokenURI(BigInt(signer.address))).eq(
      randomUri2 + signer.address.toLowerCase()
    )
  })
})
