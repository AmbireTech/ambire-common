import { ethers } from 'hardhat'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { abiCoder, expect } from '../config'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import { wrapEthSign, wrapExternallyValidated } from '../ambireSign'
import { getDKIMValidatorData, getPriviledgeTxnWithCustomHash, getSignerKey } from '../helpers'
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

const ENTRY_POINT_PRIV = '0x0000000000000000000000000000000000000000000000000000000000007171'

const accInfoTuple = 'tuple(string, string, string, bytes, bytes, address, bool, uint32, uint32, bool, bool, uint32)';
const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
const emailPrivValue = '0xfe564763e6c69427036277e09f47a1063bcc76422a8d215852ec20cbbf5753fb'

async function deployDkim() {
  const [signer] = await ethers.getSigners()

  const dnsSec = await ethers.deployContract('DNSSECImpl', ['0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d00002b000100000e10000404fefdfd'])

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
      RSASHA256: rsaSha256DKIMValidatorAddr,
    },
  })
  dnsSecAddr = await dnsSec.getAddress()
  dkimRecovery = await contractFactory.deploy(dnsSecAddr, signer.address, signer.address)
  expect(await dkimRecovery.getAddress()).to.not.be.null

  entryPoint = await ethers.deployContract('EntryPoint')
  expect(await entryPoint.getAddress()).to.not.be.null
}

describe('ERC4337 DKIM Prep-up', function () {
  it('successfully deploy the DKIM Recovery and Entry Point', async function () {
    await deployDkim()
  })
})

describe('ERC4337 DKIM sigMode Both', function () {
  before('successfully deploys the ambire account and gives priviledges to the entry point', async function () {
    await deployDkim()

    const [relayer, ,signerWithPrivs] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash },
      { addr: signerWithPrivs.address, hash: true }
    ])
    ambireAccountAddress = addr
    account = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signerWithPrivs)

    // set entry point priv
    const txn = getPriviledgeTxnWithCustomHash(ambireAccountAddress, await entryPoint.getAddress(), ENTRY_POINT_PRIV)
    await signerWithPrivs.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: account.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await account.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal('0000000000000000000000000000000000007171')
  })

  it('successfully validate a DKIM signature and execute the recovery transaction', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      plain: true
    })
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const identifier = ethers.keccak256(abiCoder.encode(['address', accInfoTuple, sigMetaTuple], [
      ambireAccountAddress,
      identifierData,
      sigMetaValues
    ]))
    const secondSig = wrapEthSign(await relayer.signMessage(ethers.getBytes(identifier)))
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    const userOperation = {
        sender: ambireAccountAddress,
        nonce: ethers.toBeHex(newNonce, 1),
        initCode: '0x',
        callData: '0x',
        callGasLimit: ethers.toBeHex(100000),
        verificationGasLimit: ethers.toBeHex(500000),
        preVerificationGas: ethers.toBeHex(50000),
        maxFeePerGas: ethers.toBeHex(100000),
        maxPriorityFeePerGas: ethers.toBeHex(100000),
        paymasterAndData: '0x',
        signature: finalSig
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: validateUserOp: needs to call executeBySender');

    userOperation.callData = account.interface.encodeFunctionData('executeBySender', [txns])
    await entryPoint.handleOps([userOperation], relayer)

    // txn should have completed successfully
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(emailPrivValue)

    // expect recovery to not have been marked as complete
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.true

    // test protection against malleability
    userOperation.nonce = ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1)
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: recovery already done');
  })
  it('should revert with DKIM signature verification failed if headers have been tampered with', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [ambireAccountAddress, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader.replace('mime-version:1.0', 'mime-version:1.1'),
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    const userOperation = {
        sender: ambireAccountAddress,
        nonce: ethers.toBeHex(newNonce, 1),
        initCode: '0x',
        callData: account.interface.encodeFunctionData('executeBySender', [txns]),
        callGasLimit: ethers.toBeHex(100000),
        verificationGasLimit: ethers.toBeHex(500000),
        preVerificationGas: ethers.toBeHex(50000),
        maxFeePerGas: ethers.toBeHex(100000),
        maxPriorityFeePerGas: ethers.toBeHex(100000),
        paymasterAndData: '0x',
        signature: finalSig
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA24 signature error');
  })
})

describe('ERC4337 DKIM sigMode OnlyDKIM', function () {
  before('successfully deploys the ambire account and gives priviledges to the entry point', async function () {
    const [relayer, ,signerWithPrivs] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode1.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash },
      { addr: signerWithPrivs.address, hash: true }
    ])
    ambireAccountAddress = addr
    account = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signerWithPrivs)

    // set entry point priv
    const txn = getPriviledgeTxnWithCustomHash(ambireAccountAddress, await entryPoint.getAddress(), ENTRY_POINT_PRIV)
    await signerWithPrivs.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: account.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await account.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal('0000000000000000000000000000000000007171')
  })

  it('should successfully schedule a timelock for the specified onlyOneSigTimelock and execute it after onlyOneSigTimelock has passed', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode1.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const sigMetaValues = [
      ethers.toBeHex(1, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      emailPrivValue
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    const userOperation = {
        sender: ambireAccountAddress,
        nonce: ethers.toBeHex(newNonce, 1),
        initCode: '0x',
        callData: account.interface.encodeFunctionData('executeBySender', [txns]),
        callGasLimit: ethers.toBeHex(100000),
        verificationGasLimit: ethers.toBeHex(500000),
        preVerificationGas: ethers.toBeHex(50000),
        maxFeePerGas: ethers.toBeHex(100000),
        maxPriorityFeePerGas: ethers.toBeHex(100000),
        paymasterAndData: '0x',
        signature: finalSig
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: no txn execution is allowed when setting a timelock');

    userOperation.callData = account.interface.encodeFunctionData('executeBySender', [[]])
    await entryPoint.handleOps([userOperation], relayer)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true,
      plain: true
    })
    const identifier = ethers.keccak256(abiCoder.encode(['address', accInfoTuple, sigMetaTuple], [
        ambireAccountAddress,
        identifierData,
        sigMetaValues
    ]))
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    userOperation.nonce = ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1)
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: calls length must be 1');

    // set the correct callData
    userOperation.callData = account.interface.encodeFunctionData('executeBySender', [txns])
    await entryPoint.handleOps([userOperation], relayer)

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(emailPrivValue)

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true
    
    userOperation.nonce = ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1)
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: recovery already done');
  })
})

describe('ERC4337 DKIM sigMode OnlySecond', function () {
  it('successfully deploys the ambire account and gives priviledges to the entry point', async function () {
    const [relayer, ,signerWithPrivs] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash },
      { addr: signerWithPrivs.address, hash: true }
    ])
    ambireAccountAddress = addr
    account = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signerWithPrivs)

    // set entry point priv
    const txn = getPriviledgeTxnWithCustomHash(ambireAccountAddress, await entryPoint.getAddress(), ENTRY_POINT_PRIV)
    await signerWithPrivs.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: account.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await account.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal('0000000000000000000000000000000000007171')
  })

  it('should successfully schedule a timelock for the specified onlyOneSigTimelock and execute it after onlyOneSigTimelock has passed', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toUtf8Bytes(''),
        ethers.toUtf8Bytes(''),
      ],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      plain: true,
      acceptEmptyDKIMSig: true
    })
    const identifier = ethers.keccak256(abiCoder.encode(['address', accInfoTuple, sigMetaTuple], [
        ambireAccountAddress,
        identifierData,
        sigMetaValues
    ]))
    const secondSig = wrapEthSign(await relayer.signMessage(ethers.getBytes(identifier)))
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    const userOperation = {
        sender: ambireAccountAddress,
        nonce: ethers.toBeHex(newNonce, 1),
        initCode: '0x',
        callData: account.interface.encodeFunctionData('executeBySender', [txns]),
        callGasLimit: ethers.toBeHex(100000),
        verificationGasLimit: ethers.toBeHex(500000),
        preVerificationGas: ethers.toBeHex(50000),
        maxFeePerGas: ethers.toBeHex(100000),
        maxPriorityFeePerGas: ethers.toBeHex(100000),
        paymasterAndData: '0x',
        signature: finalSig
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: no txn execution is allowed when setting a timelock');

    userOperation.callData = account.interface.encodeFunctionData('executeBySender', [[]])
    await entryPoint.handleOps([userOperation], relayer)

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

    userOperation.callData = account.interface.encodeFunctionData('executeBySender', [txns])
    userOperation.nonce = ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1)
    await entryPoint.handleOps([userOperation], relayer)

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(emailPrivValue)

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    userOperation.nonce = ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1)
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: recovery already done');
  })

  it('should revert with second key validation failed if the signature is incorrect', async function () {
    const [relayer,,newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [relayer.address, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toUtf8Bytes(''),
        ethers.toUtf8Bytes(''),
      ],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    const userOperation = {
        sender: ambireAccountAddress,
        nonce: ethers.toBeHex(newNonce, 1),
        initCode: '0x',
        callData: account.interface.encodeFunctionData('executeBySender', [txns]),
        callGasLimit: ethers.toBeHex(100000),
        verificationGasLimit: ethers.toBeHex(500000),
        preVerificationGas: ethers.toBeHex(50000),
        maxFeePerGas: ethers.toBeHex(100000),
        maxPriorityFeePerGas: ethers.toBeHex(100000),
        paymasterAndData: '0x',
        signature: finalSig
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA24 signature error');
  })
})

describe('DKIM sigMode Both with acceptUnknownSelectors true', function () {
  it('successfully deploys the DKIMModifiable validator that helps out with settings some predefined vars', async function () {
    const [signer] = await ethers.getSigners()
    const testContractFactory = await ethers.getContractFactory("DKIMModifiable", {
      libraries: {
        RSASHA256: rsaSha256DKIMValidatorAddr,
      },
    })
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const keys = [
      [
        `unknown._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      [
        `toberemoved._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      [
        `notaddedyet._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ]
    ]
    const waitTimestamps = [0, 0, 120];
    dkimRecoveryForTesting = await testContractFactory.deploy(keys, waitTimestamps, dnsSecAddr, signer.address, signer.address)
    expect(await dkimRecoveryForTesting.getAddress()).to.not.be.null
  })
  it('successfully deploys the ambire account and gives priviledges to the entry point', async function () {
    const [relayer, ,signerWithPrivs] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const {signerKey, hash} = getSignerKey(await dkimRecoveryForTesting.getAddress(), validatorData)
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash },
      { addr: signerWithPrivs.address, hash: true }
    ])
    ambireAccountAddress = addr
    account = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signerWithPrivs)

    // set entry point priv
    const txn = getPriviledgeTxnWithCustomHash(ambireAccountAddress, await entryPoint.getAddress(), ENTRY_POINT_PRIV)
    await signerWithPrivs.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: account.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await account.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal('0000000000000000000000000000000000007171')
  })
  it('should revert with DKIM signature verification failed if a different dkimSig is passed', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const riotEmail = await readFile(path.join(emailsPath, 'riot-games.eml'), {
      encoding: 'ascii'
    })
    const riotEmailParsedContents: any = await parseEmail(riotEmail)
    const riotEmailSig = riotEmailParsedContents[0].solidity.signature

    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      riotEmailSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    const userOperation = {
        sender: ambireAccountAddress,
        nonce: ethers.toBeHex(newNonce, 1),
        initCode: '0x',
        callData: account.interface.encodeFunctionData('executeBySender', [txns]),
        callGasLimit: ethers.toBeHex(100000),
        verificationGasLimit: ethers.toBeHex(500000),
        preVerificationGas: ethers.toBeHex(50000),
        maxFeePerGas: ethers.toBeHex(100000),
        maxPriorityFeePerGas: ethers.toBeHex(100000),
        paymasterAndData: '0x',
        signature: finalSig
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA24 signature error');
  })
})

describe('DKIM sigMode OnlySecond with a timelock of 2 minutes', function () {

  let secondSigReuse: any;

  it('successfully deploys the ambire account and gives priviledges to the entry point', async function () {
    const [relayer, ,signerWithPrivs] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
      onlyOneSigTimelock: 120
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash },
      { addr: signerWithPrivs.address, hash: true }
    ])
    ambireAccountAddress = addr
    account = new ethers.BaseContract(ambireAccountAddress, AmbireAccount.abi, signerWithPrivs)

    // set entry point priv
    const txn = getPriviledgeTxnWithCustomHash(ambireAccountAddress, await entryPoint.getAddress(), ENTRY_POINT_PRIV)
    await signerWithPrivs.sendTransaction({
      to: ambireAccountAddress,
      value: 0,
      data: account.interface.encodeFunctionData('executeBySender', [[txn]])
    })
    const entryPointPriv = await account.privileges(await entryPoint.getAddress())
    expect(entryPointPriv.substring(entryPointPriv.length - 40, entryPointPriv)).to.equal('0000000000000000000000000000000000007171')
  })
  it('should successfully schedule a timelock for 2 minutes and be unable to execute the timelock if the time has not passed', async function () {
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
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)]
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toUtf8Bytes(''),
        ethers.toUtf8Bytes(''),
      ],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
      onlyOneSigTimelock: 120,
      plain: true
    })
    const identifier = ethers.keccak256(abiCoder.encode(['address', accInfoTuple, sigMetaTuple], [
        ambireAccountAddress,
        identifierData,
        sigMetaValues
    ]))
    const secondSig = wrapEthSign(await relayer.signMessage(ethers.getBytes(identifier)))
    secondSigReuse = secondSig
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    const newNonce = await entryPoint.getNonce(ambireAccountAddress, 0)
    const userOperation = {
        sender: ambireAccountAddress,
        nonce: ethers.toBeHex(newNonce, 1),
        initCode: '0x',
        callData: account.interface.encodeFunctionData('executeBySender', [txns]),
        callGasLimit: ethers.toBeHex(100000),
        verificationGasLimit: ethers.toBeHex(500000),
        preVerificationGas: ethers.toBeHex(50000),
        maxFeePerGas: ethers.toBeHex(100000),
        maxPriorityFeePerGas: ethers.toBeHex(100000),
        paymasterAndData: '0x',
        signature: finalSig
    }
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA23 reverted: no txn execution is allowed when setting a timelock');

    userOperation.callData = account.interface.encodeFunctionData('executeBySender', [[]])
    await entryPoint.handleOps([userOperation], relayer)

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
    userOperation.nonce = ethers.toBeHex(await entryPoint.getNonce(ambireAccountAddress, 0), 1)
    userOperation.callData = account.interface.encodeFunctionData('executeBySender', [txns])
    await expect(entryPoint.handleOps([userOperation], relayer))
      .to.be.revertedWithCustomError(entryPoint, 'FailedOp')
      .withArgs(0, 'AA24 signature error');
  })
})
