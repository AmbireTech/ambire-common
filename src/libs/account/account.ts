import { ethers, Interface } from 'ethers'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { Account } from '../../interfaces/account'
import { getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'
import { PrivLevels } from '../../libs/proxyDeploy/deploy'
import { DKIM_VALIDATOR_ADDR, frequentlyUsedSelectors, getSignerKey, knownSelectors, RECOVERY_DEFAULTS } from '../../libs/dkim/recovery'
import getPublicKey from '../../libs/dkim/getPublicKey'
import lookup from '../../libs/dns/lookup'
import publicKeyToComponents from '../../libs/dkim/publicKeyToComponents'

interface DKIMRecoveryAccInfo {
  emailFrom: string
  // emailTo?: string,
  // selector: string;
  // bytes dkimPubKeyModulus;
  // bytes dkimPubKeyExponent;
  secondaryKey: string,
  acceptUnknownSelectors?: boolean,
  waitUntilAcceptAdded?: BigInt,
  waitUntilAcceptRemoved?: BigInt,
  acceptEmptyDKIMSig?: boolean,
  acceptEmptySecondSig?: boolean,
  onlyOneSigTimelock?: BigInt,
}

// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  if (account.creation === null) throw new Error('tried to get deployment params for an EOA')
  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.creation.factoryAddr,
    factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
  ]
}

export function getLegacyAccount(key: string): Account {
  return {
    addr: key,
    label: '',
    pfp: '',
    associatedKeys: [key],
    creation: null
  }
}

export async function getEmailAccount(
  recoveryInfo: DKIMRecoveryAccInfo,
  privileges: PrivLevels[]
): Promise<Account> {
  const domain: string = recoveryInfo.emailFrom.split('@')[1]
  // TODO: check if the below code runs when domain is not in knownSelectors
  const selector = knownSelectors[domain as keyof typeof knownSelectors]
  if (selector) {
    const result = await lookup(selector, domain)
    if (!result) throw new Error('DKIM not detected')
  } else {
    const promises = frequentlyUsedSelectors.map(sel => lookup(sel, domain))
    const result = await Promise.all(promises)
    console.log(result)
  }

  // get the keys
  const dkimKey = await getPublicKey({domain, selector: selector})
  const key = publicKeyToComponents(dkimKey.publicKey)
  const modulus = ethers.hexlify(key.modulus)
  const exponent = ethers.hexlify(ethers.toBeHex(key.exponent))

  // set the defaults if not provided by recoveryInfo
  const acceptUnknownSelectors = recoveryInfo.acceptUnknownSelectors ?? RECOVERY_DEFAULTS.acceptUnknownSelectors
  const waitUntilAcceptAdded = recoveryInfo.waitUntilAcceptAdded ?? RECOVERY_DEFAULTS.waitUntilAcceptAdded
  const waitUntilAcceptRemoved = recoveryInfo.waitUntilAcceptRemoved ?? RECOVERY_DEFAULTS.waitUntilAcceptRemoved
  const acceptEmptyDKIMSig = recoveryInfo.acceptEmptyDKIMSig ?? RECOVERY_DEFAULTS.acceptEmptyDKIMSig
  const acceptEmptySecondSig = recoveryInfo.acceptEmptySecondSig ?? RECOVERY_DEFAULTS.acceptEmptySecondSig
  const onlyOneSigTimelock = recoveryInfo.onlyOneSigTimelock ?? RECOVERY_DEFAULTS.onlyOneSigTimelock

  const abiCoder = new ethers.AbiCoder()
  const validatorAddr = DKIM_VALIDATOR_ADDR
  const validatorData = abiCoder.encode(
    ['tuple(string,string,string,bytes,bytes,address,bool,uint32,uint32,bool,bool,uint32)'],
    [
      [
        recoveryInfo.emailFrom,
        RECOVERY_DEFAULTS.emailTo,
        selector,
        modulus,
        exponent,
        recoveryInfo.secondaryKey,
        acceptUnknownSelectors,
        waitUntilAcceptAdded,
        waitUntilAcceptRemoved,
        acceptEmptyDKIMSig,
        acceptEmptySecondSig,
        onlyOneSigTimelock
      ]
    ]
  )
  const {signerKey, hash} = getSignerKey(validatorAddr, validatorData)
  privileges.push({ addr: signerKey, hash: hash })
  return getSmartAccount(privileges)
}

export async function getSmartAccount(privileges: PrivLevels[]): Promise<Account> {
  const bytecode = await getBytecode(privileges)
  return {
    addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
    label: '',
    pfp: '',
    associatedKeys: privileges.map(priv => priv.addr),
    creation: {
      factoryAddr: AMBIRE_ACCOUNT_FACTORY,
      bytecode,
      salt: ethers.toBeHex(0, 32)
    }
  }
}

export const isAmbireV1LinkedAccount = (factoryAddr?: string) =>
  factoryAddr === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA'
