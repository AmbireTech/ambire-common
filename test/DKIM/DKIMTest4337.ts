import fs from 'fs'
import { ethers } from 'hardhat'
import path from 'path'
import { promisify } from 'util'

import parseEmail from '../../src/libs/dkim/parseEmail'
import { wrapEthSign, wrapExternallyValidated, wrapTypedData } from '../ambireSign'
import { abiCoder, chainId, expect, provider } from '../config'
import {
  buildUserOp,
  getAccountGasLimits,
  getDKIMValidatorData,
  getGasFees,
  getPriviledgeTxnWithCustomHash,
  getSignerKey,
  getTargetNonce
} from '../helpers'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')
const AmbireAccount = require('../../artifacts/contracts/AmbireAccount.sol/AmbireAccount.json')

let dkimRecovery: any
let ambireAccountAddress: string
let account: any
let dkimRecoveryForTesting: any
let dnsSecAddr: any
let rsaSha256DKIMValidatorAddr: any
let entryPoint: any
let paymaster: any

const ENTRY_POINT_PRIV = '0x0000000000000000000000000000000000000000000000000000000000007171'

const accInfoTuple =
  'tuple(string, string, string, bytes, bytes, address, bool, uint32, uint32, bool, bool, uint32)'
const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
const emailPrivValue = '0xfe564763e6c69427036277e09f47a1063bcc76422a8d215852ec20cbbf5753fb'

async function getFailureEventArgs() {
  const filter = entryPoint.filters.UserOperationRevertReason
  const events = await entryPoint.queryFilter(filter, -1)
  const event = events[events.length - 1]
  expect(event.fragment.name).to.equal('UserOperationRevertReason')
  return event.args
}

async function deployDkim() {
  const [signer] = await ethers.getSigners()

  const dnsSec = await ethers.deployContract('DNSSECImpl', [
    '0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d00002b000100000e10000404fefdfd'
  ])

  const rsaSha256 = await ethers.deployContract('RSASHA256Algorithm')
  await dnsSec.setAlgorithm(8, await rsaSha256.getAddress())

  // other algo
  const rsaShaDKIMValidator = await ethers.deployContract('RSASHA256')
  rsaSha256DKIMValidatorAddr = await rsaShaDKIMValidator.getAddress()

  const p256SHA256Algorithm = await ethers.deployContract('P256SHA256Algorithm')
  await dnsSec.setAlgorithm(13, await p256SHA256Algorithm.getAddress())

  const digest = await ethers.deployContract('SHA256Digest')
  await dnsSec.setDigest(2, await digest.getAddress())

  const contractFactory = await ethers.getContractFactory('DKIMRecoverySigValidator', {
    libraries: {
      RSASHA256: rsaSha256DKIMValidatorAddr
    }
  })
  dnsSecAddr = await dnsSec.getAddress()
  dkimRecovery = await contractFactory.deploy(dnsSecAddr, signer.address, signer.address)
  expect(await dkimRecovery.getAddress()).to.not.be.null

  entryPoint = await ethers.deployContract('EntryPoint')
  expect(await entryPoint.getAddress()).to.not.be.null

  paymaster = await ethers.deployContract('AmbirePaymaster', [signer.address])
  expect(await paymaster.getAddress()).to.not.be.null

  await entryPoint.depositTo(await paymaster.getAddress(), {
    value: ethers.parseEther('1')
  })
}

async function deployAmbireAccountAndEntryPointAndPaymaster(validatorDataOptions = {}) {
  const [relayer, , signerWithPrivs] = await ethers.getSigners()
  const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
    encoding: 'ascii'
  })
  const parsedContents: any = await parseEmail(gmail)
  const validatorData = getDKIMValidatorData(parsedContents, relayer, validatorDataOptions)
  const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
  const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
    { addr: signerKey, hash },
    {
      addr: signerWithPrivs.address,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
    }
  ])
  ambireAccountAddress = addr
  account = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signerWithPrivs)

  // set entry point priv
  const txn = getPriviledgeTxnWithCustomHash(
    ambireAccountAddress,
    await entryPoint.getAddress(),
    ENTRY_POINT_PRIV
  )
  await signerWithPrivs.sendTransaction({
    to: ambireAccountAddress,
    value: 0,
    data: account.interface.encodeFunctionData('executeBySender', [[txn]])
  })
  const entryPointPriv = await account.privileges(await entryPoint.getAddress())
  expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal(
    '0000000000000000000000000000000000007171'
  )
}

describe('ERC4337 DKIM sigMode Both', () => {
  before(
    'successfully deploys the ambire account and gives privileges to the entry point',
    async () => {
      await deployDkim()
      await deployAmbireAccountAndEntryPointAndPaymaster()
    }
  )
  it('successfully validate a DKIM signature and execute the recovery transaction', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      plain: true
    })
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const identifier = ethers.keccak256(
      abiCoder.encode(
        ['address', accInfoTuple, sigMetaTuple],
        [ambireAccountAddress, identifierData, sigMetaValues]
      )
    )
    const typedData = wrapTypedData(chainId, validatorAddr, identifier)
    const secondSig = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, dkimSig, secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await relayer.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await entryPoint.handleOps([userOperation], relayer)

    // txn should have completed successfully
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(emailPrivValue)

    // // expect recovery to not have been marked as complete
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.true

    // try to replay, should fail
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA25 invalid account nonce')

    // try to replay the data by placing a valid entry point nonce of 01
    // it should fail in validateUserOp
    const replayTargetNonceOp = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    const targetNonce = getTargetNonce(replayTargetNonceOp)
    replayTargetNonceOp.nonce = `${targetNonce.substring(0, targetNonce.length - 2)}01`
    const isOneTimeNonce = (error: string) => {
      return Buffer.from(error.substring(2), 'hex')
        .toString()
        .includes('execute(): one-time nonce is wrong')
    }
    await expect(entryPoint.handleOps([replayTargetNonceOp], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOpWithRevert')
      .withArgs(0, 'AA23 reverted', isOneTimeNonce)

    // try to replay with a valid paymaster signature, should fail
    // and should not allow to reuse the nonce
    const secondUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]]),
      callGasLimit: 510000
    })
    secondUserOperation.nonce = getTargetNonce(secondUserOperation)
    await expect(entryPoint.handleOps([secondUserOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )
    const args = await getFailureEventArgs()
    expect(args[0]).to.equal(await entryPoint.getUserOpHash(secondUserOperation))
    expect(args[1]).to.equal(ambireAccountAddress)
    expect(args[2]).to.equal(secondUserOperation.nonce)
    expect(
      args[3].indexOf(abiCoder.encode(['string'], ['recovery already done']).substring(2))
    ).to.not.equal(-1)

    await expect(entryPoint.handleOps([secondUserOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA25 invalid account nonce')
  })
  it('should revert with DKIM signature verification failed if headers have been tampered with', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      plain: true
    })
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader.replace('mime-version:1.0', 'mime-version:1.1'),
      newSigner.address,
      emailPrivValue
    ]
    const identifier = ethers.keccak256(
      abiCoder.encode(
        ['address', accInfoTuple, sigMetaTuple],
        [ambireAccountAddress, identifierData, sigMetaValues]
      )
    )
    const typedData = wrapTypedData(chainId, validatorAddr, identifier)
    const secondSig = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, dkimSig, secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await relayer.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await expect(entryPoint.handleOps([userOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )

    const args = await getFailureEventArgs()
    expect(args[0]).to.equal(await entryPoint.getUserOpHash(userOperation))
    expect(args[1]).to.equal(ambireAccountAddress)
    expect(args[2]).to.equal(userOperation.nonce)
    expect(
      args[3].indexOf(abiCoder.encode(['string'], ['SIGNATURE_VALIDATION_FAIL']).substring(2))
    ).to.not.equal(-1)
  })
})

describe('ERC4337 DKIM sigMode OnlyDKIM', () => {
  before(
    'successfully deploys the ambire account and gives privileges to the entry point',
    async () => {
      await deployDkim()
      await deployAmbireAccountAndEntryPointAndPaymaster({
        emptySecondSig: true
      })
    }
  )
  it('should successfully schedule a timelock for the specified onlyOneSigTimelock and execute it after onlyOneSigTimelock has passed', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode1.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(1, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, dkimSig, ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await expect(entryPoint.handleOps([userOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )
    const args = await getFailureEventArgs()
    expect(args[0]).to.equal(await entryPoint.getUserOpHash(userOperation))
    expect(args[1]).to.equal(ambireAccountAddress)
    expect(args[2]).to.equal(userOperation.nonce)
    expect(
      args[3].indexOf(
        abiCoder
          .encode(['string'], ['no txn execution is allowed when setting a timelock'])
          .substring(2)
      )
    ).to.not.equal(-1)

    const secondUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[[], finalSig]]])
    })
    secondUserOperation.nonce = getTargetNonce(secondUserOperation)
    await entryPoint.handleOps([secondUserOperation], relayer)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true,
      plain: true
    })
    const identifier = ethers.keccak256(
      abiCoder.encode(
        ['address', accInfoTuple, sigMetaTuple],
        [ambireAccountAddress, identifierData, sigMetaValues]
      )
    )
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    const thirdUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[[], finalSig]]]),
      callGasLimit: 440000
    })
    thirdUserOperation.nonce = getTargetNonce(thirdUserOperation)
    await expect(entryPoint.handleOps([thirdUserOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )
    const secondArgs = await getFailureEventArgs()
    expect(secondArgs[0]).to.equal(await entryPoint.getUserOpHash(thirdUserOperation))
    expect(secondArgs[1]).to.equal(ambireAccountAddress)
    expect(secondArgs[2]).to.equal(thirdUserOperation.nonce)
    expect(
      secondArgs[3].indexOf(abiCoder.encode(['string'], ['calls length must be 1']).substring(2))
    ).to.not.equal(-1)

    // set the correct callData
    const forthUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]]),
      callGasLimit: 440000
    })
    forthUserOperation.nonce = getTargetNonce(forthUserOperation)
    await entryPoint.handleOps([forthUserOperation], relayer)

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(emailPrivValue)

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    const fifthUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]]),
      callGasLimit: 445000
    })
    fifthUserOperation.nonce = getTargetNonce(fifthUserOperation)
    await expect(entryPoint.handleOps([fifthUserOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )
    const thirdArgs = await getFailureEventArgs()
    expect(thirdArgs[0]).to.equal(await entryPoint.getUserOpHash(fifthUserOperation))
    expect(thirdArgs[1]).to.equal(ambireAccountAddress)
    expect(thirdArgs[2]).to.equal(fifthUserOperation.nonce)
    expect(
      thirdArgs[3].indexOf(abiCoder.encode(['string'], ['recovery already done']).substring(2))
    ).to.not.equal(-1)
  })
})

describe('ERC4337 DKIM sigMode OnlySecond', () => {
  before(
    'successfully deploys the ambire account and gives privileges to the entry point',
    async () => {
      await deployDkim()
      await deployAmbireAccountAndEntryPointAndPaymaster({
        acceptEmptyDKIMSig: true
      })
    }
  )

  it('should successfully schedule a timelock for the specified onlyOneSigTimelock and execute it after onlyOneSigTimelock has passed', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      plain: true,
      acceptEmptyDKIMSig: true
    })
    const identifier = ethers.keccak256(
      abiCoder.encode(
        ['address', accInfoTuple, sigMetaTuple],
        [ambireAccountAddress, identifierData, sigMetaValues]
      )
    )
    const typedData = wrapTypedData(chainId, validatorAddr, identifier)
    const secondSig = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await expect(entryPoint.handleOps([userOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )

    const args = await getFailureEventArgs()
    expect(args[0]).to.equal(await entryPoint.getUserOpHash(userOperation))
    expect(args[1]).to.equal(ambireAccountAddress)
    expect(args[2]).to.equal(userOperation.nonce)
    expect(
      args[3].indexOf(
        abiCoder
          .encode(['string'], ['no txn execution is allowed when setting a timelock'])
          .substring(2)
      )
    ).to.not.equal(-1)

    const secondUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[[], finalSig]]])
    })
    secondUserOperation.nonce = getTargetNonce(secondUserOperation)
    await entryPoint.handleOps([secondUserOperation], relayer)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    const thirdUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]]),
      callGasLimit: 600000
    })
    thirdUserOperation.nonce = getTargetNonce(thirdUserOperation)
    await entryPoint.handleOps([thirdUserOperation], relayer)

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(emailPrivValue)

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    const forthUserOp = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]]),
      callGasLimit: 510000
    })
    forthUserOp.nonce = getTargetNonce(forthUserOp)
    await expect(entryPoint.handleOps([forthUserOp], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )

    const args2 = await getFailureEventArgs()
    expect(args2[0]).to.equal(await entryPoint.getUserOpHash(forthUserOp))
    expect(args2[1]).to.equal(ambireAccountAddress)
    expect(args2[2]).to.equal(forthUserOp.nonce)
    expect(
      args2[3].indexOf(abiCoder.encode(['string'], ['recovery already done']).substring(2))
    ).to.not.equal(-1)
  })

  it('should revert with second key validation failed if the signature is incorrect', async () => {
    const [relayer, , newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [relayer.address, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const typedData = wrapTypedData(chainId, validatorAddr, msgHash)
    const secondSig = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await expect(entryPoint.handleOps([userOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )

    const args = await getFailureEventArgs()
    expect(args[0]).to.equal(await entryPoint.getUserOpHash(userOperation))
    expect(args[1]).to.equal(ambireAccountAddress)
    expect(args[2]).to.equal(userOperation.nonce)
    expect(
      args[3].indexOf(abiCoder.encode(['string'], ['SIGNATURE_VALIDATION_FAIL']).substring(2))
    ).to.not.equal(-1)
  })
})

describe('DKIM sigMode Both with acceptUnknownSelectors true', () => {
  before(
    'successfully deploys the DKIMModifiable validator that helps out with settings some predefined vars',
    async () => {
      const [signer] = await ethers.getSigners()
      const testContractFactory = await ethers.getContractFactory('DKIMModifiable', {
        libraries: {
          RSASHA256: rsaSha256DKIMValidatorAddr
        }
      })
      const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
        encoding: 'ascii'
      })
      const parsedContents: any = await parseEmail(gmail)
      const keys = [
        [
          'unknown._domainkey.gmail.com',
          ethers.hexlify(parsedContents[0].modulus),
          ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
        ],
        [
          'toberemoved._domainkey.gmail.com',
          ethers.hexlify(parsedContents[0].modulus),
          ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
        ],
        [
          'notaddedyet._domainkey.gmail.com',
          ethers.hexlify(parsedContents[0].modulus),
          ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
        ]
      ]
      const waitTimestamps = [0, 0, 120]
      dkimRecoveryForTesting = await testContractFactory.deploy(
        keys,
        waitTimestamps,
        dnsSecAddr,
        signer.address,
        signer.address
      )
      expect(await dkimRecoveryForTesting.getAddress()).to.not.be.null
    }
  )
  it('successfully deploys the ambire account and gives privileges to the entry point', async () => {
    const [relayer, , signerWithPrivs] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const { signerKey, hash } = getSignerKey(
      await dkimRecoveryForTesting.getAddress(),
      validatorData
    )
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash },
      {
        addr: signerWithPrivs.address,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    ])
    ambireAccountAddress = addr
    account = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signerWithPrivs)

    // set entry point priv
    const txn = getPriviledgeTxnWithCustomHash(
      ambireAccountAddress,
      await entryPoint.getAddress(),
      ENTRY_POINT_PRIV
    )
    await signerWithPrivs.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: account.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await account.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal(
      '0000000000000000000000000000000000007171'
    )
  })
  it('should revert with DKIM signature verification failed if a different dkimSig is passed', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const riotEmail = await readFile(path.join(emailsPath, 'sigMode1.eml'), {
      encoding: 'ascii'
    })
    const riotEmailParsedContents: any = await parseEmail(riotEmail)
    const riotEmailSig = riotEmailParsedContents[0].solidity.signature

    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, riotEmailSig, ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await expect(entryPoint.handleOps([userOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )

    const args = await getFailureEventArgs()
    expect(args[0]).to.equal(await entryPoint.getUserOpHash(userOperation))
    expect(args[1]).to.equal(ambireAccountAddress)
    expect(args[2]).to.equal(userOperation.nonce)
    expect(
      args[3].indexOf(abiCoder.encode(['string'], ['SIGNATURE_VALIDATION_FAIL']).substring(2))
    ).to.not.equal(-1)
  })
})

describe('DKIM sigMode OnlySecond with a timelock of 2 minutes', () => {
  before(
    'successfully deploys the ambire account and gives privileges to the entry point',
    async () => {
      await deployDkim()
      await deployAmbireAccountAndEntryPointAndPaymaster({
        acceptEmptyDKIMSig: true,
        onlyOneSigTimelock: 120
      })
    }
  )
  it('should successfully schedule a timelock for 2 minutes and be unable to execute the timelock if the time has not passed', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
      onlyOneSigTimelock: 120
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
      onlyOneSigTimelock: 120,
      plain: true
    })
    const identifier = ethers.keccak256(
      abiCoder.encode(
        ['address', accInfoTuple, sigMetaTuple],
        [ambireAccountAddress, identifierData, sigMetaValues]
      )
    )
    const typedData = wrapTypedData(chainId, validatorAddr, identifier)
    const secondSig = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    const userOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[txns, finalSig]]])
    })
    userOperation.nonce = getTargetNonce(userOperation)
    await expect(entryPoint.handleOps([userOperation], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )
    const args = await getFailureEventArgs()
    expect(args[0]).to.equal(await entryPoint.getUserOpHash(userOperation))
    expect(args[1]).to.equal(ambireAccountAddress)
    expect(args[2]).to.equal(userOperation.nonce)
    expect(
      args[3].indexOf(
        abiCoder
          .encode(['string'], ['no txn execution is allowed when setting a timelock'])
          .substring(2)
      )
    ).to.not.equal(-1)

    const secondUserOperation = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[[], finalSig]]])
    })
    secondUserOperation.nonce = getTargetNonce(secondUserOperation)
    await entryPoint.handleOps([secondUserOperation], relayer)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    // 2 minutes timelock
    const thirdUserOp = await buildUserOp(paymaster, await entryPoint.getAddress(), {
      sender: ambireAccountAddress,
      signedNonce: ethers.toBeHex(0, 1),
      callData: account.interface.encodeFunctionData('executeMultiple', [[[[], finalSig]]]),
      callGasLimit: 456000
    })
    thirdUserOp.nonce = getTargetNonce(thirdUserOp)
    await expect(entryPoint.handleOps([thirdUserOp], relayer)).to.emit(
      entryPoint,
      'UserOperationRevertReason'
    )
    const args2 = await getFailureEventArgs()
    expect(args2[0]).to.equal(await entryPoint.getUserOpHash(thirdUserOp))
    expect(args2[1]).to.equal(ambireAccountAddress)
    expect(args2[2]).to.equal(thirdUserOp.nonce)
    expect(
      args2[3].indexOf(abiCoder.encode(['string'], ['SIGNATURE_VALIDATION_TIMELOCK']).substring(2))
    ).to.not.equal(-1)
  })
})

describe('ERC4337 DKIM sigMode OnlyDKIM with valid entry point that validates everything', () => {
  before(
    'successfully deploys the ambire account and gives privileges to the entry point',
    async () => {
      await deployDkim()
      await deployAmbireAccountAndEntryPointAndPaymaster({
        emptySecondSig: true
      })
    }
  )
  it('should revert on trying recovery through executeBySender', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode1.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature
    const sigMetaValues = [
      ethers.toBeHex(1, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, dkimSig, emailPrivValue]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    await relayer.sendTransaction({
      to: ambireAccountAddress,
      value: ethers.parseEther('1')
    })
    const balance = await provider.getBalance(ambireAccountAddress)
    expect(balance).to.equal(ethers.parseEther('1'))
    const userOperation = {
      sender: ambireAccountAddress,
      nonce: ethers.toBeHex(newNonce, 1),
      initCode: '0x',
      callData: account.interface.encodeFunctionData('executeBySender', [[]]),
      accountGasLimits: getAccountGasLimits(500000, 100000),
      preVerificationGas: 500000n,
      gasFees: getGasFees(100000, 100000),
      paymasterAndData: '0x',
      signature: finalSig
    }
    const isSigMode = (error: string) => {
      return Buffer.from(error.substring(2), 'hex').toString().includes('SV_SIGMODE')
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOpWithRevert')
      .withArgs(0, 'AA23 reverted', isSigMode)
  })
})
