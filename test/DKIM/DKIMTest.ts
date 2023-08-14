import { ethers } from 'hardhat'
import { deployAmbireAccountHardhatNetwork } from '../implementations'
import { abiCoder, expect } from '../config'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import parseEmail from '../../src/libs/dkim/parseEmail'
import { wrapEthSign, wrapExternallyValidated } from '../ambireSign'
import { getPriviledgeTxn } from '../helpers'
const readFile = promisify(fs.readFile)
const emailsPath = path.join(__dirname, 'emails')

function getValidatorData(
  parsedContents: any,
  signer: any,
  options: any = {}
) {
  const emptySecondSig = options.emptySecondSig ?? false
  const acceptEmptyDKIMSig = options.acceptEmptyDKIMSig ?? false
  const onlyOneSigTimelock = options.onlyOneSigTimelock ?? 0
  const acceptUnknownSelectors = options.acceptUnknownSelectors ?? false

  return abiCoder.encode([
    'tuple(string,string,string,bytes,bytes,address,bool,uint32,uint32,bool,bool,uint32)'
    ,
  ], [[
    'borislavdevlabs@gmail.com',
    'borislav.ickov@gmail.com',
    parsedContents[0].selector,
    ethers.hexlify(parsedContents[0].modulus),
    ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
    signer.address,
    acceptUnknownSelectors,
    0,
    0,
    acceptEmptyDKIMSig,
    emptySecondSig,
    onlyOneSigTimelock,
  ]])
}

function getSignerKey(validatorAddr: any, validatorData: any) {
  const hash = ethers.keccak256(abiCoder.encode(['address', 'bytes'], [validatorAddr, validatorData]))
  const signerKey = `0x${hash.slice(hash.length - 40, hash.length)}`
  return {signerKey, hash}
}

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
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer)
    const {signerKey, hash} = getSignerKey(await dkimRecovery.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('successfully validate a DKIM signature and execute the recovery transaction', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer)
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, txns]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `${parsedContents[0].selector}._domainKey.gmail.com`,
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
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer, {
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
})

describe('DKIM sigMode OnlyDKIM', function () {

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer, {
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
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer, {
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
        `${parsedContents[0].selector}._domainKey.gmail.com`,
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
    await account.execute(txns, finalSig)

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
})

describe('DKIM sigMode OnlySecond', function () {

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer, {
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
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer, {
      acceptEmptyDKIMSig: true
    })
    const validatorAddr = await dkimRecovery.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, txns]
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
    await account.execute(txns, finalSig)

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
})

describe('DKIM sigMode Both with acceptUnknownSelectors true', function () {
  it('successfully deploys the DKIMModifiable validator that helps out with settings some predefined vars', async function () {
    const [signer] = await ethers.getSigners()
    const testContractFactory = await ethers.getContractFactory("DKIMModifiable", {
      libraries: {
        RSASHA256: rsaSha256DKIMValidatorAddr,
      },
    })
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const keys = [
      [
        `unknown._domainKey.gmail.com`,
        ethers.hexlify(parsedContents[0].modulus),
        ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
      ]
    ]
    dkimRecoveryForTesting = await testContractFactory.deploy(keys, dnsSecAddr, signer.address, signer.address)
    expect(await dkimRecoveryForTesting.getAddress()).to.not.be.null
  })

  it('successfully deploys the ambire account', async function () {
    const [relayer] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const {signerKey, hash} = getSignerKey(await dkimRecoveryForTesting.getAddress(), validatorData)
    const { ambireAccount, ambireAccountAddress: addr } = await deployAmbireAccountHardhatNetwork([
      { addr: signerKey, hash: hash }
    ])
    ambireAccountAddress = addr
    account = ambireAccount
  })

  it('successfully validate a DKIM signature and execute the recovery transaction', async function () {
    const [relayer, newSigner] = await ethers.getSigners()
    const gmail = await readFile(path.join(emailsPath, 'address-permissions.eml'), {
      encoding: 'ascii'
    })
    const parsedContents: any = await parseEmail(gmail)
    const validatorData = getValidatorData(parsedContents, relayer, {
      acceptUnknownSelectors: true
    })
    const validatorAddr = await dkimRecoveryForTesting.getAddress()
    const {signerKey} = getSignerKey(validatorAddr, validatorData)
    const dkimSig = parsedContents[0].solidity.signature

    const txns = [getPriviledgeTxn(ambireAccountAddress, newSigner.address, true)]
    const msgHash = ethers.keccak256(
      abiCoder.encode(
        ['address', 'tuple(address, uint, bytes)[]'],
        [ambireAccountAddress, txns]
      )
    )
    const msg = ethers.getBytes(msgHash)
    const secondSig = wrapEthSign(await relayer.signMessage(msg))
    const sigMetaTuple = 'tuple(uint8, tuple(string, bytes, bytes), string, address, bytes32)'
    const sigMetaValues = [
      ethers.toBeHex(0, 1),
      [
        `unknown._domainKey.gmail.com`,
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
})