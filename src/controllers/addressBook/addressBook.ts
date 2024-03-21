import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

interface Contacts {
  [key: string]: string
}

/**
 * Address Book controller
 */

export class AddressBookController extends EventEmitter {
  contacts: Contacts = {}

  #storage: Storage

  constructor(storage: Storage) {
    super()

    this.#storage = storage
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#load()
  }

  async #load() {
    try {
      this.contacts = await this.#storage.get('contacts', [])
    } catch (e) {
      this.emitError({
        message:
          'Something went wrong when loading the Address Book. Please try again or contact support if the problem persists.',
        level: 'major',
        error: new Error('Address Book: failed to load contacts from the Address Book')
      })
    }
  }

  #saveContactsInStorage() {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('contacts', this.contacts)
  }

  addContact(name: string, address: string) {
    this.contacts[name] = address
    this.#saveContactsInStorage()
  }

  renameContact(oldName: string, newName: string) {
    if (!this.contacts[oldName]) return

    this.contacts[newName] = this.contacts[oldName]
    delete this.contacts[oldName]
    this.#saveContactsInStorage()
  }

  removeContact(name: string) {
    if (!this.contacts[name]) {
      this.emitError({
        message: "Can't remove contact that doesn't exist in the Address Book",
        level: 'minor',
        error: new Error(
          "Address Book: can't remove contact that doesn't exist in the Address Book"
        )
      })
      return
    }

    delete this.contacts[name]
    this.#saveContactsInStorage()
  }
}
