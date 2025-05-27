import '@nomicfoundation/hardhat-chai-matchers'

import { expect } from 'chai'
import { Contract, MaxUint256, solidityPackedKeccak256 } from 'ethers'
import { ethers, network } from 'hardhat'

import { ERC20 } from '../../src/libs/humanizer/const/abis'

describe.skip('stkWallet', () => {
  let signer: any
  let stkWallet: any
  const WALLET_ADDRESS = '0x88800092ff476844f74dc2fc427974bbee2794ae'
  const XWALLET_ADDRESS = '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
  const walletContract = new Contract(WALLET_ADDRESS, ERC20, ethers)
  const xWalletContract = new Contract(
    XWALLET_ADDRESS,
    [...ERC20, 'function enter(uint amount) external'],
    ethers
  )

  before(async () => {
    // commented out
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: 'https://invictus.ambire.com/ethereum-5',
            blockNumber: 14390000
          }
        }
      ]
    })
  })

  beforeEach('Use fork of mainnet', async () => {
    ;[signer] = await ethers.getSigners()

    const slot = solidityPackedKeccak256(['uint256', 'uint256'], [signer.address, 1])

    // Override storage slot
    await ethers.provider.send('hardhat_setStorageAt', [
      WALLET_ADDRESS,
      slot,
      `0x${MaxUint256.toString(16)}`
    ])

    const StkWallet = await ethers.getContractFactory('stkWALLET')
    stkWallet = await StkWallet.deploy(WALLET_ADDRESS, XWALLET_ADDRESS)
  })
  it('Basic wrap with xWALLET ', async () => {
    const amount = BigInt(10 * 1e18)
    await (walletContract.connect(signer) as any).approve(XWALLET_ADDRESS, amount)
    await (xWalletContract.connect(signer) as any).enter(amount)

    const balanceInXWallet = await xWalletContract.balanceOf(signer.address)
    await (xWalletContract.connect(signer) as any).approve(stkWallet.target, balanceInXWallet)
    await (stkWallet.connect(signer) as any).wrap(balanceInXWallet)
    expect(await xWalletContract.balanceOf(stkWallet.target)).eq(balanceInXWallet)
    expect(await stkWallet.balanceOf(signer.address)).gt(amount)
  })

  it('Basic stake and wrap with WALLET ', async () => {
    const amount = BigInt(10 * 1e18)
    await (walletContract.connect(signer) as any).approve(stkWallet.target, amount)
    // await (walletContract.connect(signer) as any).approve(XWALLET_ADDRESS, amount)

    const xWalletBalanceOfStkWalletBefore = await xWalletContract.balanceOf(stkWallet.target)
    await (stkWallet.connect(signer) as any).enterTo(signer.address, amount)
    const xWalletBalanceOfStkWalletAfter = await xWalletContract.balanceOf(stkWallet.target)
    const newXWallets = xWalletBalanceOfStkWalletAfter - xWalletBalanceOfStkWalletBefore
    const storedXWallets = await stkWallet.shares(signer.address)

    expect(newXWallets).eq(storedXWallets)
  })
})
