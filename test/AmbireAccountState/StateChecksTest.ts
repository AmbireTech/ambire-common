import { ethers } from 'hardhat'
import {
  expect
} from '../config'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { Contract } from 'ethers'

let ambireAccountAddress: string
let accountState: Contract

describe('Account state checks tests', function () {
  it('should successfully deploys the ambire account and the account state', async function () {
    const [signer] = await ethers.getSigners()
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signer.address, hash: true }
    ])
    ambireAccountAddress = addr

    accountState = await ethers.deployContract('AmbireAccountState')
    const accountStateAddr = accountState.address
    expect(accountStateAddr).not.to.be.null
  })
  it('should check if ambireV2Check works as intended', async function () {
    const alabala = await accountState.ambireV2Check(ambireAccountAddress)
    console.log(alabala)
  })
})
