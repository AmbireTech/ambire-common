import { Account, AccountIdentityResponse } from '../../interfaces/account';
import { AmbireLinkedAccounts } from './interfaces';
/**
 * Parses an identity response from the Ambire Relayer API and extracts identity data.
 * Returns normalized identity information with defaults for missing fields.
 */
export declare function normalizeIdentityResponse(addr: string, response?: AccountIdentityResponse | null): {
    creation: {
        factoryAddr: string;
        bytecode: string;
        salt: string;
    };
    associatedKeys: string[];
    initialPrivileges: any[];
};
/**
 * Get linked v1 or v2 smart accounts existing in the relayer itself.
 * Fetch only for passed accounts
 */
export declare function getRelayerLinkedAccounts(accounts: Account[], callRelayer: Function): Promise<{
    linkedAccounts: AmbireLinkedAccounts;
    errorMessage?: string;
}>;
//# sourceMappingURL=accountPicker.d.ts.map