import { Dapp } from '../../interfaces/dapp';
/**
 * A temporary function used to patch apps stored in storage. As both predefined and custom apps
 * are stored in the same place and we don't have a mechanism to differentiate between them, we need to
 * remove the predefined ones from the storage.
 */
declare const patchStorageApps: (storageDapps: Dapp[]) => Dapp[];
export { patchStorageApps };
//# sourceMappingURL=helpers.d.ts.map