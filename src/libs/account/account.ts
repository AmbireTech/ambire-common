import { AbiCoder, hexlify, Interface, toBeHex, toUtf8Bytes, ZeroAddress } from 'ethers'

import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET } from '../../consts/derivation'
import { SPOOF_SIGTYPE } from '../../consts/signatures'
import {
  Account,
  AccountId,
  AccountOnPage,
  AccountPreferences,
  ImportStatus
} from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { DKIM_VALIDATOR_ADDR, getSignerKey, RECOVERY_DEFAULTS } from '../dkim/recovery'
import { KeyIterator } from '../keyIterator/keyIterator'
import { getBytecode } from '../proxyDeploy/bytecode'
import { PrivLevels } from '../proxyDeploy/deploy'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'

/**
 * The minimum requirements are emailFrom and secondaryKey.
 * - emailFrom is the email from the email vault
 * - secondaryKey is the recoveryKey set in the email vault
 * - acceptUnknownSelectors: sets whether recovery can be done by DNSSEC keys
 * - waitUntilAcceptAdded: how much time to wait before the user accepts
 * a DNSSEC key
 * - waitUntilAcceptRemoved: how much time to wait before the user accepts
 * a removal of a DNSSEC key
 * - acceptEmptyDKIMSig: can recovery be performed without DKIM
 * - acceptEmptySecondSig: can recovery be performed without secondaryKey
 * - onlyOneSigTimelock: in case of 1/2 multisig, how much time to wait
 * before the recovery transaction can be executed
 */
interface DKIMRecoveryAccInfo {
  emailFrom: string
  secondaryKey: string
  waitUntilAcceptAdded?: BigInt
  waitUntilAcceptRemoved?: BigInt
  acceptEmptyDKIMSig?: boolean
  acceptEmptySecondSig?: boolean
  onlyOneSigTimelock?: BigInt
}

// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  // for EOAs, we do not throw an error anymore as we need fake
  // values for the simulation
  if (account.creation === null) return [ZeroAddress, '0x']

  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.creation.factoryAddr,
    factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
  ]
}

export function getBasicAccount(addr: string): Account {
  return {
    addr,
    associatedKeys: [addr],
    initialPrivileges: [],
    creation: null,
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: addr
    }
  }
}

export async function getSmartAccount(privileges: PrivLevels[]): Promise<Account> {
  const bytecode = await getBytecode(privileges)
  const addr = getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode)

  return {
    addr,
    initialPrivileges: privileges.map((priv) => [priv.addr, priv.hash]),
    associatedKeys: privileges.map((priv) => priv.addr),
    creation: {
      factoryAddr: AMBIRE_ACCOUNT_FACTORY,
      bytecode,
      salt: toBeHex(0, 32)
    },
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: addr
    }
  }
}

export function getSpoof(account: Account) {
  const abiCoder = new AbiCoder()
  return abiCoder.encode(['address'], [account.associatedKeys[0]]) + SPOOF_SIGTYPE
}

/**
 * Create a DKIM recoverable email smart account
 *
 * @param recoveryInfo DKIMRecoveryAccInfo
 * @param associatedKey the key that has privileges
 * @returns Promise<Account>
 */
export async function getEmailAccount(
  recoveryInfo: DKIMRecoveryAccInfo,
  associatedKey: string
): Promise<Account> {
  // const domain: string = recoveryInfo.emailFrom.split('@')[1]

  // TODO: make getEmailAccount work with cloudflare

  // try to take the dkimKey from the list of knownSelectors
  // if we cannot, we query a list of frequentlyUsedSelectors to try
  // to find the dkim key
  // let selector = knownSelectors[domain as keyof typeof knownSelectors] ?? ''
  // let dkimKey = selector ? await getPublicKeyIfAny({domain, selector: selector}) : ''
  // if (!dkimKey) {
  //   const promises = frequentlyUsedSelectors.map(sel => getPublicKeyIfAny({domain, selector: sel}))
  //   const results = await Promise.all(promises)
  //   for (let i = 0; i < results.length; i++) {
  //     if (results[i]) {
  //       dkimKey = results[i]
  //       selector = frequentlyUsedSelectors[i]
  //       break
  //     }
  //   }
  // }

  // if there's no dkimKey, standard DKIM recovery is not possible
  // we leave the defaults empty and the user will have to rely on
  // keys added through DNSSEC
  const selector = hexlify(toUtf8Bytes(''))
  const modulus = hexlify(toUtf8Bytes(''))
  const exponent = hexlify(toUtf8Bytes(''))
  // if (dkimKey) {
  //   const key = publicKeyToComponents(dkimKey.publicKey)
  //   modulus = hexlify(key.modulus)
  //   exponent = hexlify(toBeHex(key.exponent))
  // }

  // acceptUnknownSelectors should be always true
  // and should not be overriden by the FE at this point
  const acceptUnknownSelectors = RECOVERY_DEFAULTS.acceptUnknownSelectors
  const waitUntilAcceptAdded =
    recoveryInfo.waitUntilAcceptAdded ?? RECOVERY_DEFAULTS.waitUntilAcceptAdded
  const waitUntilAcceptRemoved =
    recoveryInfo.waitUntilAcceptRemoved ?? RECOVERY_DEFAULTS.waitUntilAcceptRemoved
  const acceptEmptyDKIMSig = recoveryInfo.acceptEmptyDKIMSig ?? RECOVERY_DEFAULTS.acceptEmptyDKIMSig
  const acceptEmptySecondSig =
    recoveryInfo.acceptEmptySecondSig ?? RECOVERY_DEFAULTS.acceptEmptySecondSig
  const onlyOneSigTimelock = recoveryInfo.onlyOneSigTimelock ?? RECOVERY_DEFAULTS.onlyOneSigTimelock

  const abiCoder = new AbiCoder()
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
  const { hash } = getSignerKey(validatorAddr, validatorData)
  const privileges = [{ addr: associatedKey, hash }]
  return getSmartAccount(privileges)
}

export const isAmbireV1LinkedAccount = (factoryAddr?: string) =>
  factoryAddr === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA'

export const isSmartAccount = (account: Account) => !!account && !!account.creation

/**
 * Checks if a (basic) EOA account is a derived one,
 * that is meant to be used as a smart account key only.
 */
export const isDerivedForSmartAccountKeyOnly = (index?: number) =>
  typeof index === 'number' && index >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET

export const getDefaultSelectedAccount = (accounts: Account[]) => {
  if (accounts.length === 0) return null

  const smartAccounts = accounts.filter((acc) => acc.creation)
  if (smartAccounts.length) return smartAccounts[0]

  return accounts[0]
}

export const getAccountImportStatus = ({
  account,
  alreadyImportedAccounts,
  keys,
  accountsOnPage = [],
  keyIteratorType
}: {
  account: Account
  alreadyImportedAccounts: Account[]
  keys: Key[]
  accountsOnPage?: Omit<AccountOnPage, 'importStatus'>[]
  keyIteratorType?: KeyIterator['type']
}): ImportStatus => {
  const isAlreadyImported = alreadyImportedAccounts.some(({ addr }) => addr === account.addr)
  if (!isAlreadyImported) return ImportStatus.NotImported

  // Check if the account has been imported with at least one of the keys
  // that the account was originally associated with, when it was imported.
  const storedAssociatedKeys =
    alreadyImportedAccounts.find((x) => x.addr === account.addr)?.associatedKeys || []
  const importedKeysForThisAcc = keys.filter((key) => storedAssociatedKeys.includes(key.addr))
  // Could be imported as a view only account (and therefore, without a key)
  if (!importedKeysForThisAcc.length) return ImportStatus.ImportedWithoutKey

  // Merge the `associatedKeys` from the account instances found on the page,
  // with the `associatedKeys` of the account from the extension storage. This
  // ensures up-to-date keys, considering the account existing associatedKeys
  // could be outdated  (associated keys of the smart accounts can change) or
  // incomplete initial data (during the initial import, not all associatedKeys
  // could have been fetched (for privacy).
  const mergedAssociatedKeys = Array.from(
    new Set([
      ...accountsOnPage
        .filter((x) => x.account.addr === account.addr)
        .flatMap((x) => x.account.associatedKeys),
      ...storedAssociatedKeys
    ])
  )

  // Same key in this context means not only the same key address, but the
  // same type too. Because user can opt in to import same key address with
  // many different hardware wallets (Trezor, Ledger, GridPlus, etc.) or
  // the same address with seed (private key).
  const associatedKeysAlreadyImported = importedKeysForThisAcc.filter(
    (key) =>
      mergedAssociatedKeys.includes(key.addr) &&
      // if key type is not provided, skip this part of the check on purpose
      (keyIteratorType ? key.type === keyIteratorType : true)
  )
  if (associatedKeysAlreadyImported.length) {
    const associatedKeysNotImportedYet = mergedAssociatedKeys.filter((keyAddr) =>
      associatedKeysAlreadyImported.some((x) => x.addr !== keyAddr)
    )

    const notImportedYetKeysExistInPage = accountsOnPage.some((x) =>
      associatedKeysNotImportedYet.includes(x.account.addr)
    )

    if (notImportedYetKeysExistInPage) return ImportStatus.ImportedWithSomeOfTheKeys

    // Could happen when user imports a smart account with one associated key.
    // Then imports an Basic account. Then makes the Basic account a second key
    // for the smart account. In this case, both associated keys of the smart
    // account are imported, but the smart account's `associatedKeys` are incomplete.
    const associatedKeysFoundOnPageAreDifferent = accountsOnPage
      .filter((x) => x.account.addr === account.addr)
      .some((x) => {
        const incomingAssociatedKeysSet = new Set(x.account.associatedKeys)
        const storedAssociatedKeysSet = new Set(storedAssociatedKeys)

        return ![...incomingAssociatedKeysSet].every((k) => storedAssociatedKeysSet.has(k))
      })

    return associatedKeysFoundOnPageAreDifferent
      ? ImportStatus.ImportedWithSomeOfTheKeys
      : ImportStatus.ImportedWithTheSameKeys
  }

  // Since there are `importedKeysForThisAcc`, as a fallback -
  // for all other scenarios this account has been imported with different keys.
  return ImportStatus.ImportedWithDifferentKeys
}

export const getDefaultAccountPreferences = (
  accountAddr: string,
  prevAccounts: Account[],
  i: number
): AccountPreferences => {
  const existingAcc = prevAccounts.find(({ addr }) => addr === accountAddr)
  const number = prevAccounts.length + (i + 1)

  return {
    label: existingAcc ? DEFAULT_ACCOUNT_LABEL : `Account ${number}`,
    pfp: accountAddr // default pfp - a jazz icon generated from the addr
  }
}

export function migrateAccountPreferencesToAccounts(
  accountPreferences: {
    [key: AccountId]: AccountPreferences
  },
  accounts: Account[]
) {
  return accounts.map((a) => {
    return {
      ...a,
      preferences: accountPreferences[a.addr]
    }
  })
}
