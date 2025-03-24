import { getAddress } from 'ethers'

import { Account } from '../../interfaces/account'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'

export type Contact = {
  name: string
  address: Account['addr']
  isWalletAccount?: boolean
  createdAt?: number
  updatedAt?: number
}

export type Contacts = Array<Contact>

/**
 * AddressBook controller- responsible for managing contacts in the Address Book. There are two internal types of contacts in the Address Book:
 * 1. Manually added contacts (stored in storage)- can be added, renamed and removed using this controller.
 * 2. Contacts, generated on the fly from the accounts in the wallet (not stored in storage)- can be managed via other controllers and are read-only in this one.
 * Both types of contacts are combined and returned as a single array of contacts.
 */

export class AddressBookController extends EventEmitter {
  // Manually added contact (stored in storage)
  #manuallyAddedContacts: Contacts = []

  #storage: StorageController

  #initialLoadPromise: Promise<void>

  #accounts: AccountsController

  #selectedAccount: SelectedAccountController

  constructor(
    storage: StorageController,
    accounts: AccountsController,
    selectedAccount: SelectedAccountController
  ) {
    super()

    this.#storage = storage
    this.#accounts = accounts
    this.#selectedAccount = selectedAccount

    this.#initialLoadPromise = this.#load()
  }

  // Contacts, generated on the fly from the accounts in the wallet (not stored in storage)
  get #walletAccountsSourcedContacts() {
    return this.#accounts.accounts.map((account) => ({
      name: account.preferences.label,
      address: account.addr,
      isWalletAccount: true
    }))
  }

  get contacts() {
    if (!this.#selectedAccount.account) return []

    return [...this.#manuallyAddedContacts, ...this.#walletAccountsSourcedContacts].filter(
      ({ address }) => address !== this.#selectedAccount.account!.addr
    )
  }

  async #load() {
    await this.#accounts.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    try {
      this.#manuallyAddedContacts = await this.#storage.get('contacts', [])
      this.emitUpdate()
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading the Address Book. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('Address Book: failed to load contacts from the Address Book')
      })
    }
  }

  #handleManuallyAddedContactsChange() {
    this.emitUpdate()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('contacts', this.#manuallyAddedContacts)
  }

  #findManuallyAddedContactWithAddress(address: string) {
    return this.#manuallyAddedContacts.find(
      (contact) => contact.address.toLowerCase() === address.toLowerCase()
    )
  }

  #findContactWithAddress(address: string) {
    return !this.contacts.some((contact) => contact.address.toLowerCase() === address.toLowerCase())
  }

  #getChecksummedAddress(address: string) {
    try {
      return getAddress(address)
    } catch {
      this.emitError({
        message: 'Invalid address',
        level: 'minor',
        error: new Error('Address Book: invalid address')
      })
      return ''
    }
  }

  async addContact(name: string, address: string) {
    await this.#initialLoadPromise
    const checksummedAddress = this.#getChecksummedAddress(address)
    const trimmedName = name.trim()

    if (!this.#findContactWithAddress(checksummedAddress)) {
      this.emitError({
        message: 'Contact with this address already exists in the Address Book',
        level: 'minor',
        error: new Error(
          'Address Book: contact with this address already exists in the Address Book'
        )
      })
      return
    }

    this.#manuallyAddedContacts.push({
      name: trimmedName,
      address: checksummedAddress,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    this.#handleManuallyAddedContactsChange()
  }

  async renameManuallyAddedContact(address: string, newName: string) {
    await this.#initialLoadPromise
    const checksummedAddress = this.#getChecksummedAddress(address)
    const trimmedNewName = newName.trim()

    if (!this.#findManuallyAddedContactWithAddress(checksummedAddress)) {
      this.emitError({
        message: "Can't rename contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't rename contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    this.#manuallyAddedContacts = this.#manuallyAddedContacts.map((contact) => {
      if (contact.address.toLowerCase() === address.toLowerCase()) {
        return { ...contact, name: trimmedNewName, updatedAt: Date.now() }
      }

      return contact
    })

    this.#handleManuallyAddedContactsChange()
  }

  async removeManuallyAddedContact(address: string) {
    await this.#initialLoadPromise
    const checksummedAddress = this.#getChecksummedAddress(address)

    if (!this.#findManuallyAddedContactWithAddress(checksummedAddress)) {
      this.emitError({
        message: "Can't remove contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't remove contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    this.#manuallyAddedContacts = this.#manuallyAddedContacts.filter(
      (contact) => contact.address.toLowerCase() !== address.toLowerCase()
    )

    this.#handleManuallyAddedContactsChange()
  }

  toJSON() {
    return {
      ...this,
      contacts: this.contacts
    }
  }
}
