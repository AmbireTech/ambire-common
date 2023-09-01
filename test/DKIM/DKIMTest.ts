import { ethers } from 'hardhat'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { abiCoder, expect } from '../config'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import { wrapEthSign, wrapExternallyValidated } from '../ambireSign'
import { getDKIMValidatorData, getPriviledgeTxn, getSignerKey } from '../helpers'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

let dkimRecovery: any
let ambireAccountAddress: string
let account: any
let dkimRecoveryForTesting: any
let dnsSecAddr: any
let rsaSha256DKIMValidatorAddr: any

describe('DKIM Prep-up', function () {
  it('successfully deploy the DKIM Recovery', async function () {
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

    const contractFactory = await ethers.getContractFactory("DKIMRecoverySigValidator", {
      libraries: {
        RSASHA256: rsaSha256DKIMValidatorAddr,
      },
    })
    dnsSecAddr = await dnsSec.getAddress()
    dkimRecovery = await contractFactory.deploy(dnsSecAddr, signer.address, signer.address)
    expect(await dkimRecovery.getAddress()).to.not.be.null
  })
})

describe('DKIM sigMode Both', function () {
  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [ambireAccountAddress, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await account.execute(txns, finalSig)

    // txn should have completed successfully
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(1, 32))

    // expect recovery to not have been marked as complete
    const identifier = ethers.keccak256(abiCoder.encode(['address', 'bytes', sigMetaTuple], [
      ambireAccountAddress,
      validatorData,
      sigMetaValues
    ]))
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.true

    // test protection against malleability
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('recovery already done')
  })
  it('should revert if priviledges slightly do not match', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, ethers.toBeHex(0, 1)])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
        .to.be.revertedWith('EXTERNAL_VALIDATION_NOT_SET')
  })
  it('should revert if a request with an unknown selector is sent', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `unknown._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    // test protection against malleability
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('account does not allow unknown selectors')
  })
  it('should revert if there is transaction mendling - more txns; wrong new signer', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [
      getPriviledgeTxn(ambireAccountAddress, relayer.address, true),
      getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)
    ]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `unknown._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('calls length must be 1')

    txns.pop()
    txns[0][1] = 1
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('call value must be 0')

    txns[0][1] = 0
    txns[0][0] = newSigner.address
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('call "to" must be the ambire account addr')

    txns[0][0] = ambireAccountAddress
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('Transaction data is not set correctly, either selector, key or priv is incorrect')
  })
  it('should revert if the cannonized headers emailSubject and the sent emailSubject are different', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, relayer.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      relayer.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('emailSubject not valid')
  })
})

describe('DKIM sigMode OnlyDKIM', function () {

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode1.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emptySecondSig: true
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(1, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('no txn execution is allowed when setting a timelock')
    await account.execute([], finalSig)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const identifier = ethers.keccak256(abiCoder.encode(['address', 'bytes', sigMetaTuple], [
        ambireAccountAddress,
        validatorData,
        sigMetaValues
    ]))
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
    expect(hasPrivAfterTimelock).to.equal(ethers.toBeHex(1, 32))

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('recovery already done')
  })

  it('should revert if the sigMode is changed to Both and the same information is passed', async function () {
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [ambireAccountAddress, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    // test protection against malleability
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('emailSubject not valid')
  })

  it('should revert if sig mode is onlySecond', async function () {
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toBeHex(0, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('account disallows OnlySecond')
  })
})

describe('DKIM sigMode OnlySecond', function () {
  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [ambireAccountAddress, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toBeHex(0, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('no txn execution is allowed when setting a timelock')
    await account.execute([], finalSig)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const identifier = ethers.keccak256(abiCoder.encode(['address', 'bytes', sigMetaTuple], [
        ambireAccountAddress,
        validatorData,
        sigMetaValues
    ]))
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    // execute again, expect the txn to be executed as onlyOneSigTimelock is 0
    const secondSig2 = wrapEthSign(await relayer.signMessage(ethers.getBytes(msgHash)))
    const innerSig2 = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSig2
    ])
    const sig2 = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig2])
    const finalSig2 = wrapExternallyValidated(sig2)
    await account.execute(txns, finalSig2)

    // expect the txn to have been executed
    const hasPrivAfterTimelock = await account.privileges(newSigner.address)
    expect(hasPrivAfterTimelock).to.equal(ethers.toBeHex(1, 32))

    // expect recovery to have been marked as complete
    const recoveryComplete = await dkimRecovery.recoveries(identifier)
    expect(recoveryComplete).to.be.true

    // expect the timelock to have been marked as executed
    const timelockDone = await dkimRecovery.timelocks(identifier)
    expect(timelockDone[0]).to.be.true

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('recovery already done')
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [relayer.address, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toBeHex(0, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')
  })

  it('should revert if an OnlyDKIM sig mode is passed', async function () {
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(1, 1),
      [
        '',
        ethers.toBeHex(0, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('account disallows OnlyDKIM')
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

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const {signerKey, hash} = getSignerKey(await dkimRecoveryForTesting.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('successfully validate an unknown selector for the account but one that exists in dkimKeys', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [ambireAccountAddress, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1), // both
      [
        `unknown._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await account.execute(txns, finalSig)

    // txn should have completed successfully
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(1, 32))

    // expect recovery to not have been marked as complete
    const identifier = ethers.keccak256(abiCoder.encode(['address', 'bytes', sigMetaTuple], [
      ambireAccountAddress,
      validatorData,
      sigMetaValues
    ]))
    const recoveryAssigned = await dkimRecoveryForTesting.recoveries(identifier)
    expect(recoveryAssigned).to.be.true

    // test protection against malleability
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('recovery already done')
  })

  it('should revert if the domain in sigMeta is different than the fromEmail domain in the accInfo', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `nonexistent._domainkey.abv.bg`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('domain in sigMeta is not authorized for this account')
  })

  it('should revert if an unknown selector for the account and one that does not exist in dkimKeys is passed', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `nonexistent._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('non-existant DKIM key')
  })

  it('should revoke the key in the dkimKeys with a name of "toberemoved"', async function () {
    // const [signer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const dkimKey = ethers.keccak256(abiCoder.encode(['tuple(string, bytes, bytes)'], [
      [
        `toberemoved._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ]
    ]))
    const onchainKey = await dkimRecoveryForTesting.dkimKeys(dkimKey);
    expect(onchainKey[0]).to.be.true

    await dkimRecoveryForTesting.removeDKIMKey(dkimKey)
    const removedKey = await dkimRecoveryForTesting.dkimKeys(dkimKey);
    expect(removedKey[0]).to.be.true
    expect(removedKey[3]).to.not.equal(0)
  })

  it('should revert on trying to revoke the DKIM key if msg sender does not have revoke rights', async function () {
    const [,signer] = await ethers.getSigners()
    const dkimKey = ethers.keccak256(abiCoder.encode(['tuple(string, bytes, bytes)'], [
      [
        '',
        ethers.toBeHex(0, 1),
        ethers.toBeHex(0, 1),
      ]
    ]))
    await expect(dkimRecoveryForTesting.connect(signer).removeDKIMKey(dkimKey))
      .to.be.revertedWith('Address unauthorized to revoke')
  })

  it('should revert if an unknown selector for the account is passed and the dkim key for it is already removed', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `toberemoved._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('DKIM key revoked')
  })

  it('should revert if the timestamp for the added key has not passed, yet', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `notaddedyet._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('DKIM key not added yet')
  })

  it('should revert with non-existant DKIM key if the wrong modulus / exponent is passed', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `unknown._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.toBeHex(65666)
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('non-existant DKIM key')
  })

  it('should revert with DKIM signature verification failed if headers have been tampered with', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader.replace('mime-version:1.0', 'mime-version:1.1'),
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      riotEmailSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')
  })
})

describe('DKIM sigMode Both with changed emailFrom', function () {
  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailFrom: 'else@gmail.com'
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('should revert with emailFrom not valid because the email is not sent from the correct email account', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailFrom: 'else@gmail.com'
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('emailFrom not valid')
  })
})

describe('DKIM sigMode Both with changed emailTo', function () {
  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailTo: 'else@gmail.com'
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('should revert with emailFrom not valid because the email is not sent from the correct email account', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode0.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      emailTo: 'else@gmail.com'
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainkey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ],
      parsedContents[0].processedHeader,
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      dkimSig,
      ethers.toBeHex(0, 1)
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('emailTo not valid')
  })
})

describe('DKIM sigMode OnlySecond with a timelock of 2 minutes', function () {

  let secondSigReuse: any;

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'sigMode2.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getDKIMValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true,
      onlyOneSigTimelock: 120
    })
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'address', 'bytes32'],
        [ambireAccountAddress, newSigner.address, ethers.toBeHex(1, 32)]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    secondSigReuse = secondSig

    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toBeHex(0, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSig
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)

    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('no txn execution is allowed when setting a timelock')
    await account.execute([], finalSig)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const identifier = ethers.keccak256(abiCoder.encode(['address', 'bytes', sigMetaTuple], [
        ambireAccountAddress,
        validatorData,
        sigMetaValues
    ]))
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    // 2 minutes timelock
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('timelock: not ready yet')
  })

  it('??? is this okay??? it changes the SignatureMeta RSA public key and reuses the signature to set the same timelock', async function () {
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

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]

    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toBeHex(1, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      newSigner.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSigReuse
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('no txn execution is allowed when setting a timelock')
    await account.execute([], finalSig)

    // expect the txn to NOT have been executed
    const hasPriv = await account.privileges(newSigner.address)
    expect(hasPriv).to.equal(ethers.toBeHex(0, 32))

    // expect recovery to not have been marked as complete
    const identifier = ethers.keccak256(abiCoder.encode(['address', 'bytes', sigMetaTuple], [
        ambireAccountAddress,
        validatorData,
        sigMetaValues
    ]))
    const recoveryAssigned = await dkimRecovery.recoveries(identifier)
    expect(recoveryAssigned).to.be.false

    // expect a timelock to have been scheduled
    const timelock = await dkimRecovery.timelocks(identifier)
    expect(timelock[0]).to.be.false
    expect(timelock[1]).to.not.equal(0)

    // 2 minutes timelock
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('timelock: not ready yet')
  })

  it('it should revert with second key validation failed if you try to reuse the sig but set a new address or new privs', async function () {
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
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxn(ambireAccountAddress, hacker.address, true)]
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toBeHex(1, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      hacker.address,
      ethers.toBeHex(1, 32)
    ]
    const innerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      sigMetaValues,
      ethers.toBeHex(0, 1),
      secondSigReuse
    ])
    const sig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, innerSig])
    const finalSig = wrapExternallyValidated(sig)
    await expect(account.execute(txns, finalSig))
      .to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')

    // try to give newSigner.address false privs
    const brickTxn = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, false)]
    const brickSigMetaValues = [
      ethers.toBeHex(2, 1),
      [
        '',
        ethers.toBeHex(1, 1),
        ethers.toBeHex(0, 1),
      ],
      '',
      newSigner.address,
      ethers.toBeHex(0, 32)
    ]
    const brickInnerSig = abiCoder.encode([sigMetaTuple, 'bytes', 'bytes'], [
      brickSigMetaValues,
      ethers.toBeHex(0, 1),
      secondSigReuse
    ])
    const brickSig = abiCoder.encode(['address', 'address', 'bytes', 'bytes'], [signerKey, validatorAddr, validatorData, brickInnerSig])
    const finalBrickSig = wrapExternallyValidated(brickSig)
    await expect(account.execute(brickTxn, finalBrickSig))
      .to.be.revertedWith('SIGNATURE_VALIDATION_FAIL')
  })
})