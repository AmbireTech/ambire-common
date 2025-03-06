import fs from 'fs'
import { ethers } from 'hardhat'
import path from 'path'
import { promisify } from 'util'

import parseEmail from '../../src/libs/dkim/parseEmail'
import { wrapEthSign, wrapExternallyValidated, wrapTypedData } from '../ambireSign'
import { abiCoder, chainId, expect } from '../config'
import {
  getDKIMValidatorData,
  getPriviledgeTxn,
  getPriviledgeTxnWithCustomHash,
  getSignerKey
} from '../helpers'
import { deployAmbireAccountHardhatNetwork } from '../implementations'

const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

let dkimRecovery: any
let ambireAccountAddress: string
let account: any
let dkimRecoveryForTesting: any
let dnsSecAddr: any
let rsaSha256DKIMValidatorAddr: any

const accInfoTuple =
  'tuple(string, string, string, bytes, bytes, address, bool, uint32, uint32, bool, bool, uint32)'
const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
const emailPrivValue = '0xfe564763e6c69427036277e09f47a1063bcc76422a8d215852ec20cbbf5753fb'

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
}

describe('DKIM Prep-up', () => {
  it('successfully deploy the DKIM Recovery', async () => {
    await deployDkim()
  })
})

describe('DKIM sigMode Both', () => {
  before('successfully deploys the ambire account', async () => {
    await deployDkim()

    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })
  it('should revert if there is transaction mendling - more txns; wrong new signer', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const dkimSig = parsedContents[0].solidity.signature
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, relayer.address, emailPrivValue),
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
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
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
      [sigMetaValues, dkimSig, secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('calls length must be 1')

    txns.pop()
    txns[0][1] = '1'
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('call value must be 0')

    txns[0][1] = '0'
    txns[0][0] = newSigner.address
    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'call "to" must be the ambire account addr'
    )

    txns[0][0] = ambireAccountAddress
    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'Transaction data is not set correctly, either selector, key or priv is incorrect'
    )
  })
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
    await account.execute(txns, finalSig)

    // txn should have completed successfully
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(emailPrivValue)

    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.true

    // test protection against malleability
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('recovery already done')
  })
  it('should revert if privileges slightly do not match', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, ethers.toBeHex(0, 1)]
    )
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('EXTERNAL_VALIDATION_NOT_SET')
  })
  it('should revert if a request with an unknown selector is sent', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        'unknown._domainkey.gmail.com',
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)

    // test protection against malleability
    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'account does not allow unknown selectors'
    )
  })
  it('should revert if the cannonized headers emailSubject and the sent emailSubject are different', async () => {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, relayer.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      relayer.address,
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
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('emailSubject not valid')
  })
})

describe('DKIM sigMode OnlyDKIM', () => {
  before('successfully deploys the ambire account', async () => {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode1.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })
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

    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'no txn execution is allowed when setting a timelock'
    )
    await account.execute([], finalSig)

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

    // execute again, expect the txn to be executed as onlyOneSigTimelock is 0
    await account.execute(txns, finalSig)

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(emailPrivValue)

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('recovery already done')
  })

  it('should revert if the sigMode is changed to Both and the same information is passed', async () => {
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
      [sigMetaValues, dkimSig, ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)

    // test protection against malleability
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('emailSubject not valid')
  })

  it('should revert if sig mode is onlySecond', async () => {
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

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('account disallows OnlySecond')
  })
  it('onlyDKIM recovery can be reverted', async () => {
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

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(emailPrivValue)

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('recovery already done')

    // Craft attack payloads
    const newSigMetaValues = [
      ethers.toBeHex(1, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(0, 32) // zero, so no privileges (privileges removed)
    ]
    const newInnerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [newSigMetaValues, dkimSig, ethers.toBeHex(0, 1)]
    )

    const newSig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, newInnerSig]
    )
    const newFinalSig = wrapExternallyValidated(newSig)

    const newtxns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, false)] // false, so no privileges (privileges removed)

    await expect(account.execute(newtxns, newFinalSig)).to.be.revertedWith('emailSubject not valid')
  })
})

describe('DKIM sigMode OnlySecond', () => {
  it('successfully deploys the ambire account', async () => {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

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
    // expect recovery to not have been marked as complete
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
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

    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'no txn execution is allowed when setting a timelock'
    )
    await account.execute([], finalSig)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    // execute again, expect the txn to be executed as onlyOneSigTimelock is 0
    const secondSig2 = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const innerSig2 = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSig2]
    )
    const sig2 = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig2]
    )
    const finalSig2 = wrapExternallyValidated(sig2)
    await account.execute(txns, finalSig2)

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(emailPrivValue)

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('recovery already done')
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

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')
  })

  it('should revert if an OnlyDKIM sig mode is passed', async () => {
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
      ethers.toBeHex(1, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig)).to.be.revertedWith('account disallows OnlyDKIM')
  })
})

describe('DKIM sigMode Both with acceptUnknownSelectors true', () => {
  it('successfully deploys the DKIMModifiable validator that helps out with settings some predefined vars', async () => {
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
  })

  it('successfully deploys the ambire account', async () => {
    const [relayer] = await ethers.getSigners()
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
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('successfully validate an unknown selector for the account but one that exists in dkimKeys', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: 120,
      plain: true
    })
    const sigMetaValues = [
      ethers.toBeHex(0, 1), // both
      [
        'unknown._domainkey.gmail.com',
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
    await account.execute(txns, finalSig)

    // txn should have completed successfully
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(emailPrivValue)

    // expect recovery to not have been marked as complete
    const recoveryAssigned = await dkimRecoveryForTesting.recoveries(identifier)
    expect(recoveryAssigned).to.be.true

    // test protection against malleability
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('recovery already done')
  })

  it('should revert if the domain in sigMeta is different than the fromEmail domain in the accInfo', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
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
        'nonexistent._domainkey.abv.bg',
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'domain in sigMeta is not authorized for this account'
    )
  })

  it('should revert if an unknown selector for the account and one that does not exist in dkimKeys is passed', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
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
        'nonexistent._domainkey.gmail.com',
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('non-existent DKIM key')
  })

  it('should revoke the key in the dkimKeys with a name of "toberemoved"', async () => {
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const dkimKey = ethers.keccak256(
      abiCoder.encode(
        ['tuple(string, bytes, bytes)'],
        [
          [
            'toberemoved._domainkey.gmail.com',
            ethers.hexlify(parsedContents[0].modulus),
            ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
          ]
        ]
      )
    )
    const onchainKey = await dkimRecoveryForTesting.dkimKeys(dkimKey)
    expect(onchainKey[0]).to.be.true

    await dkimRecoveryForTesting.removeDKIMKey(dkimKey)
    const removedKey = await dkimRecoveryForTesting.dkimKeys(dkimKey)
    expect(removedKey[0]).to.be.true
    expect(removedKey[3]).to.not.equal(0)
  })
  it('should not be able to revoke the same key again', async () => {
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const dkimKey = ethers.keccak256(
      abiCoder.encode(
        ['tuple(string, bytes, bytes)'],
        [
          [
            'toberemoved._domainkey.gmail.com',
            ethers.hexlify(parsedContents[0].modulus),
            ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
          ]
        ]
      )
    )
    const onchainKey = await dkimRecoveryForTesting.dkimKeys(dkimKey)
    expect(onchainKey[0]).to.be.true

    await expect(dkimRecoveryForTesting.removeDKIMKey(dkimKey)).to.be.revertedWith(
      'Key already revoked'
    )
  })
  it('should revert on trying to revoke the DKIM key if msg sender does not have revoke rights', async () => {
    const [, signer] = await ethers.getSigners()
    const dkimKey = ethers.keccak256(
      abiCoder.encode(
        ['tuple(string, bytes, bytes)'],
        [['', ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]]
      )
    )
    await expect(dkimRecoveryForTesting.connect(signer).removeDKIMKey(dkimKey)).to.be.revertedWith(
      'Address unauthorized to revoke'
    )
  })
  it('should revert if an unknown selector for the account is passed and the dkim key for it is already removed', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
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
        'toberemoved._domainkey.gmail.com',
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('DKIM key revoked')
  })
  it('should revert if the timestamp for the added key has not passed, yet', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
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
        'notaddedyet._domainkey.gmail.com',
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('DKIM key not added yet')
  })

  it('should revert with non-existent DKIM key if the wrong modulus / exponent is passed', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, newSigner.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        'unknown._domainkey.gmail.com',
        ethers.hexlify(parsedContents[0].modulus),
        ethers.toBeHex(65666)
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
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('non-existent DKIM key')
  })

  it('should revert with DKIM signature verification failed if headers have been tampered with', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

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
      parsedContents[0].processedHeader.replace('mime-version:1.0', 'mime-version:1.1'),
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
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')
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
    const riotEmailParsedContents = await parseEmail(riotEmail)
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
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')
  })
})

describe('DKIM sigMode Both with changed emailFrom', () => {
  it('successfully deploys the ambire account', async () => {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailFrom: 'else@gmail.com'
    })
    const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('should revert with emailFrom not valid because the email is not sent from the correct email account', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailFrom: 'else@gmail.com'
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

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
      [sigMetaValues, dkimSig, ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('emailFrom not valid')
  })
})

describe('DKIM sigMode Both with changed emailTo', () => {
  it('successfully deploys the ambire account', async () => {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailTo: 'else@gmail.com'
    })
    const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })
  it('should revert with emailTo not valid because the email is not sent to the correct email account', async () => {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailTo: 'else@gmail.com'
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const { signerKey } = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

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
      [sigMetaValues, dkimSig, ethers.toBeHex(0, 1)]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('emailTo not valid')
  })
})

describe('DKIM sigMode OnlySecond with a timelock of 2 minutes', () => {
  let secondSigReuse: any

  it('successfully deploys the ambire account', async () => {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
      onlyOneSigTimelock: 120
    })
    const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

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
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
      onlyOneSigTimelock: 120,
      plain: true
    })
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
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
    secondSigReuse = secondSig
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'no txn execution is allowed when setting a timelock'
    )
    await account.execute([], finalSig)

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
    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'SIGNATURE_VALIDATION_TIMELOCK'
    )
  })
  it('should revert if the canonized headers change', async () => {
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
      'a', // we mark the change here
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSigReuse]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'sigMeta.canonizedHeaders should be empty when SigMode is OnlySecond'
    )
  })
  it('sigMeta.key should be empty when SigMode is OnlySecond', async () => {
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
      [
        '',
        ethers.toUtf8Bytes('a'), // we mark the change here
        ethers.toUtf8Bytes('')
      ],
      '',
      newSigner.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSigReuse]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith(
      'sigMeta.key should be empty when SigMode is OnlySecond'
    )
  })

  it('it should revert with second key validation failed if you try to reuse the sig but set a new address or new privs', async () => {
    const [relayer, newSigner, hacker] = await ethers.getSigners()
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
      getPriviledgeTxnWithCustomHash(ambireAccountAddress, hacker.address, emailPrivValue)
    ]
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
      hacker.address,
      emailPrivValue
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, ethers.toBeHex(0, 1), secondSigReuse]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')

    // try to give newSigner.address false privs
    const brickTxn = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, false)]
    const brickSigMetaValues = [
      ethers.toBeHex(2, 1),
      ['', ethers.toUtf8Bytes(''), ethers.toUtf8Bytes('')],
      '',
      newSigner.address,
      ethers.toBeHex(0, 32)
    ]
    const brickInnerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [brickSigMetaValues, ethers.toBeHex(0, 1), secondSigReuse]
    )
    const brickSig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, validatorAddr, validatorData, brickInnerSig]
    )
    const finalBrickSig = wrapExternallyValidated(brickSig)
    await expect(account.execute(brickTxn, finalBrickSig)).to.be.revertedWith(
      'SIGNATURE_VALIDATION_FAIL'
    )
  })
})

describe('Setup a wrong validator address', () => {
  const emptyAddr = ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
  before('successfully deploys the ambire account with 0x validatorAddr', async () => {
    const [relayer, , eoa] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const { signerKey, hash } = getSignerKey(emptyAddr, validatorData)
    const { signerKey: eoaKey, hash: eoaHash } = getSignerKey(eoa.address, validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash },
      { addr: eoaKey, hash: eoaHash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('should return SIGNATURE_VALIDATION_FAIL on any recovery request, even if it is legit', async () => {
    const [relayer, newSigner, eoa] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const { signerKey } = getSignerKey(emptyAddr, validatorData)
    const { signerKey: eoaKey } = getSignerKey(eoa.address, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [ambireAccountAddress, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const typedData = wrapTypedData(chainId, emptyAddr, msgHash)
    const secondSig = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent))
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, dkimSig, secondSig]
    )
    const sig = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [signerKey, emptyAddr, validatorData, innerSig]
    )
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig)).to.be.reverted

    const sig2 = abiCoder.encode(
      ['address', 'address', 'bytes', 'bytes'],
      [eoaKey, eoa.address, validatorData, innerSig]
    )
    const finalSig2 = wrapExternallyValidated(sig2)
    await expect(account.execute(txns, finalSig2)).to.be.revertedWithoutReason
  })
})

describe('Front running', () => {
  before('successfully deploys the ambire account', async () => {
    await deployDkim()

    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const { signerKey, hash } = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })
  it('should revert if someone tries to front run the transaction via the dkimRecovery contract', async () => {
    const [relayer, newSigner, thirdSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const dkimSig = parsedContents[0].solidity.signature

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
    const identifierData = getDKIMValidatorData(parsedContents, relayer, {
      plain: true
    })
    const identifier = ethers.keccak256(
      abiCoder.encode(
        ['address', accInfoTuple, sigMetaTuple],
        [await thirdSigner.getAddress(), identifierData, sigMetaValues]
      )
    )
    const typedData = wrapTypedData(chainId, await dkimRecovery.getAddress(), identifier)
    const secondSig = wrapEthSign(
      await relayer.signTypedData(typedData.domain, typedData.types, typedData.value)
    )
    const innerSig = abiCoder.encode(
      [sigMetaTuple, 'bytes', 'bytes'],
      [sigMetaValues, dkimSig, secondSig]
    )

    await expect(
      dkimRecovery.connect(thirdSigner).validateSig(validatorData, innerSig, txns)
    ).to.be.revertedWith('call "to" must be the ambire account addr')
  })
})
