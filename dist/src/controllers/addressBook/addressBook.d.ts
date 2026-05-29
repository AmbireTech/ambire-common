import { IAccountsController } from '../../interfaces/account';
import { IAddressBookController } from '../../interfaces/addressBook';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { IStorageController } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
/**
 * AddressBook controller- responsible for managing contacts in the Address Book. There are two internal types of contacts in the Address Book:
 * 1. Manually added contacts (stored in storage)- can be added, renamed and removed using this controller.
 * 2. Contacts, generated on the fly from the accounts in the wallet (not stored in storage)- can be managed via other controllers and are read-only in this one.
 * Both types of contacts are combined and returned as a single array of contacts.
 */
export declare class AddressBookController extends EventEmitter implements IAddressBookController {
    #private;
    initialLoadPromise?: Promise<void>;
    constructor(storage: IStorageController, accounts: IAccountsController, selectedAccount: ISelectedAccountController, eventEmitterRegistry?: IEventEmitterRegistryController);
    get contacts(): (import("../../interfaces/addressBook").Contact | {
        name: string;
        address: string;
        isWalletAccount: boolean;
    })[];
    addContact(name: string, address: string): Promise<void>;
    renameManuallyAddedContact(address: string, newName: string): Promise<void>;
    removeManuallyAddedContact(address: string): Promise<void>;
    toJSON(): this & {
        contacts: (import("../../interfaces/addressBook").Contact | {
            name: string;
            address: string;
            isWalletAccount: boolean;
        })[];
    };
}
//# sourceMappingURL=addressBook.d.ts.map