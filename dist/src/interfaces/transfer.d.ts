import { Contacts } from '../controllers/addressBook/addressBook';
import { HumanizerMeta } from '../libs/humanizer/interfaces';
import { TokenResult } from '../libs/portfolio';
import { Account } from './account';
import { AddressStateOptional } from './domains';
import { Network } from './network';
export interface TransferUpdate {
    selectedAccountData?: Account;
    humanizerInfo?: HumanizerMeta;
    networks?: Network[];
    contacts?: Contacts;
    selectedToken?: TokenResult;
    amount?: string;
    addressState?: AddressStateOptional;
    isSWWarningAgreed?: boolean;
    isRecipientAddressUnknownAgreed?: boolean;
    isTopUp?: boolean;
    amountFieldMode?: 'token' | 'fiat';
}
//# sourceMappingURL=transfer.d.ts.map