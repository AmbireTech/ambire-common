import { Account } from '../../interfaces/account';
import { Storage } from '../../interfaces/storage';
import { AccountsController } from '../accounts/accounts';
import EventEmitter from '../eventEmitter/eventEmitter';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
export type Contact = {
    name: string;
    address: Account['addr'];
    isWalletAccount?: boolean;
    createdAt?: number;
    updatedAt?: number;
};
export type Contacts = Array<Contact>;
/**
 * AddressBook controller- responsible for managing contacts in the Address Book. There are two internal types of contacts in the Address Book:
 * 1. Manually added contacts (stored in storage)- can be added, renamed and removed using this controller.
 * 2. Contacts, generated on the fly from the accounts in the wallet (not stored in storage)- can be managed via other controllers and are read-only in this one.
 * Both types of contacts are combined and returned as a single array of contacts.
 */
export declare class AddressBookController extends EventEmitter {
    #private;
    constructor(storage: Storage, accounts: AccountsController, selectedAccount: SelectedAccountController);
    get contacts(): (Contact | {
        name: string;
        address: string;
        isWalletAccount: boolean;
    })[];
    addContact(name: string, address: string): Promise<void>;
    renameManuallyAddedContact(address: string, newName: string): Promise<void>;
    removeManuallyAddedContact(address: string): Promise<void>;
    toJSON(): this & {
        contacts: (Contact | {
            name: string;
            address: string;
            isWalletAccount: boolean;
        })[];
    };
}
//# sourceMappingURL=addressBook.d.ts.map