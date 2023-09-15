import { ethers } from 'hardhat'
import {
  abiCoder, expect,
} from '../config'
import { wrapEthSign } from '../ambireSign'

async function buildUserOp(options: any = {}) {
  const [relayer, sender] = await ethers.getSigners()

  const userOp = {
    sender: sender.address,
    nonce: options.userOpNonce ?? ethers.toBeHex(0, 1),
    initCode: '0x',
    callData: options.callData ?? '0x',
    callGasLimit: ethers.toBeHex(100000),
    verificationGasLimit: ethers.toBeHex(500000),
    preVerificationGas: ethers.toBeHex(50000),
    maxFeePerGas: ethers.toBeHex(100000),
    maxPriorityFeePerGas: ethers.toBeHex(100000),
    paymasterAndData: '0x',
    signature: '0x'
  }
  const validUntil = options.validUntil ?? 0
  const validAfter = options.validAfter ?? 0
  const hash = ethers.keccak256(abiCoder.encode([
    'uint256',
    'address',
    'uint48',
    'uint48',
    'address',
    'uint256',
    'bytes',
    'bytes',
    'uint256',
    'uint256',
    'uint256',
    'uint256',
    'uint256',
  ], [
    options.chainId ?? 31337,
    await paymaster.getAddress(),
    validUntil,
    validAfter,
    userOp.sender,
    options.signedNonce ?? userOp.nonce,
    userOp.initCode,
    userOp.callData,
    userOp.callGasLimit,
    userOp.verificationGasLimit,
    userOp.preVerificationGas,
    userOp.maxFeePerGas,
    userOp.maxPriorityFeePerGas
  ]));
  const signature = wrapEthSign(await relayer.signMessage(ethers.getBytes(hash)))

  // abi.decode(userOp.paymasterAndData[20:], (uint48, uint48, bytes))
  const paymasterData = abiCoder.encode(
    ['uint48', 'uint48', 'bytes'],
    [validUntil, validAfter, signature]
  )
  const paymasterAndData = ethers.hexlify(ethers.concat([
    await paymaster.getAddress(),
    paymasterData
  ]))
  // (uint48 validUntil, uint48 validAfter, bytes memory signature) = abi.decode(userOp.paymasterAndData[20:], (uint48, uint48, bytes));

  userOp.paymasterAndData = paymasterAndData
  return userOp
}

let paymaster: any
describe('Basic Ambire Paymaster tests', function () {
  before('successfully deploys the paymaster ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    paymaster = await ethers.deployContract('AmbirePaymaster', [relayer.address])
  })
  it('should pass a sample valid data to validatePaymasterUserOp and succeed', async function () {
    const userOp = await buildUserOp() // valid data
    const result = await paymaster.validatePaymasterUserOp(
      userOp,
      ethers.toBeHex(0, 32),
      0
    )
    expect(result[1]).to.equal(0n)
  })
  it('should fail if the chain is different', async function () {
    const userOp = await buildUserOp({chainId: 1}) // invalid chain id
    const result = await paymaster.validatePaymasterUserOp(
      userOp,
      ethers.toBeHex(0, 32),
      0
    )
    expect(result[1]).to.equal(1n)
  })
  it('should pass if callData is set to execute by making the signed nonce 0 on chain even though user op nonce is different ', async function () {
    const ambireAccount = await ethers.deployContract('AmbireAccount')
    const userOp = await buildUserOp({
      userOpNonce: 1000,
      signedNonce: 0, // we sign a 0 nonce
      callData: ambireAccount.interface.encodeFunctionData('execute', [[], ethers.toBeHex(0, 1)])
    })
    const result = await paymaster.validatePaymasterUserOp(
      userOp,
      ethers.toBeHex(0, 32),
      0
    )
    expect(result[1]).to.equal(0n)
  })
  it('should fail if callData is set to execute but the signed nonce is not 0', async function () {
    const ambireAccount = await ethers.deployContract('AmbireAccount')
    const userOp = await buildUserOp({
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
    const userOp = await buildUserOp({
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
