import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

type Contacts = Array<{
  name: string
  address: string
}>

/**
 * Address Book controller
 */

export class AddressBookController extends EventEmitter {
  // Manually added contact (stored in storage)
  #manuallyAddedContacts: Contacts = []

  // Contacts, generated on the fly from the accounts in the wallet (not stored in storage)
  #accountsInWalletContacts: Contacts = []

  #storage: Storage

  constructor(storage: Storage) {
    super()

    this.#storage = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#load()
  }

  set accountsInWalletContacts(accountsInWalletContacts: Contacts) {
    this.#accountsInWalletContacts = accountsInWalletContacts
  }

  get contacts() {
    return [...this.#accountsInWalletContacts, ...this.#manuallyAddedContacts]
  }

  async #load() {
    try {
      this.#manuallyAddedContacts = await this.#storage.get('contacts', [])
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading the Address Book. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('Address Book: failed to load contacts from the Address Book')
      })
    }
  }

  #handleContactsUpdate() {
    this.emitUpdate()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('contacts', this.#manuallyAddedContacts)
  }

  #getManuallyAddedContactFromName(name: string) {
    return this.#manuallyAddedContacts.find((contact) => contact.name === name)
  }

  #getIsUnique(key: 'name' | 'address', value: string) {
    return !this.contacts.some((contact) => contact[key] === value)
  }

  addContact(name: string, address: string) {
    if (!this.#getIsUnique('name', name)) {
      this.emitError({
        message: 'Contact with this name already exists in the Address Book',
        level: 'minor',
        error: new Error('Address Book: contact with this name already exists in the Address Book')
      })
      return
    }

    if (!this.#getIsUnique('address', address)) {
      this.emitError({
        message: 'Contact with this address already exists in the Address Book',
        level: 'minor',
        error: new Error(
          'Address Book: contact with this address already exists in the Address Book'
        )
      })
      return
    }

    this.#manuallyAddedContacts.push({ name, address })

    this.#handleContactsUpdate()
  }

  renameManuallyAddedContact(oldName: string, newName: string) {
    if (!this.#getManuallyAddedContactFromName(oldName)) {
      this.emitError({
        message: "Can't rename contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't rename contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    if (this.#getManuallyAddedContactFromName(newName)) {
      this.emitError({
        message: 'Contact with this name already exists in the Address Book',
        level: 'minor',
        error: new Error('Address Book: contact with this name already exists in the Address Book')
      })
      return
    }

    this.#manuallyAddedContacts = this.#manuallyAddedContacts.map((contact) => {
      if (contact.name === oldName) {
        return { name: newName, address: contact.address }
      }
      return contact
    })

    this.#handleContactsUpdate()
  }

  removeManuallyAddedContact(name: string) {
    if (!this.#getManuallyAddedContactFromName(name)) {
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
      (contact) => contact.name !== name
    )

    this.#handleContactsUpdate()
  }

  toJSON() {
    return {
      ...this,
      contacts: this.contacts
    }
  }
}
