import { ethers } from 'hardhat'
import { expect } from '../config'
import { buildUserOp } from '../helpers'

let paymaster: any
describe('Basic Ambire Paymaster tests', function () {
  before('successfully deploys the paymaster ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
  })
  it('should pass a sample valid data to validatePaymasterUserOp and succeed', async function () {
    const userOp = await buildUserOp(paymaster) // valid data
    const result = await paymaster.validatePaymasterUserOp(
      userOp,
      ethers.toBeHex(0, 32),
      0
    )
    expect(result[1]).to.equal(0n)
  })
  it('should fail if the chain is different', async function () {
    const userOp = await buildUserOp(paymaster, {chainId: 1}) // invalid chain id
    const result = await paymaster.validatePaymasterUserOp(
      userOp,
      ethers.toBeHex(0, 32),
      0
    )
    expect(result[1]).to.equal(1n)
  })
  it('should fail if callData is set to execute but the signed nonce is not 0', async function () {
    const ambireAccount = await ethers.deployContract('AmbireAccount')
    const userOp = await buildUserOp(paymaster, {
      userOpNonce: 1000,
      signedNonce: 1, // we change it to 1 => it should fail; it should work only with 0
      callData: ambireAccount.interface.encodeFunctionData('execute', [[], ethers.toBeHex(0, 1)])
    })
    const result = await paymaster.validatePaymasterUserOp(
      userOp,
      ethers.toBeHex(0, 32),
      0
    )
    expect(result[1]).to.equal(1n)
  })
  it('should pass validAfter and validUntil and validation should still pass without problems', async function () {
    const validAfter = Date.now()
    const validUntil = Date.now() + 60 * 60 * 24 * 3
    const userOp = await buildUserOp(paymaster, {
      validAfter: validAfter,
      validUntil: validUntil,
    })
    const result = await paymaster.validatePaymasterUserOp(
      userOp,
      ethers.toBeHex(0, 32),
      0
    )
    // 0x + 12 hex symbol = 6 bytes = 48 bits for the numbers
    const validAfterHex = ethers.toBeHex(result[1]).substring(0, 14)
    const validUntilHex = '0x' + ethers.toBeHex(result[1]).substring(14, 26)
    expect(ethers.toBigInt(validAfter)).to.equal(ethers.toBigInt(ethers.getBytes(validAfterHex)))
    expect(ethers.toBigInt(validUntil)).to.equal(ethers.toBigInt(ethers.getBytes(validUntilHex)))

    // everything after the numbers is the result
    const success = '0x' + ethers.toBeHex(result[1]).substring(26, 66)
    expect(ethers.toBigInt(success)).to.equal(0n)
  })
})
