import { UseStorageProps, UseStorageReturnType } from './types';
/**
 * The main role of this hook is to hide the Storage provider we are using under the hood (AsyncStorage/localStorage).
 * This will allow us to share code between mobile/web.
 *
 * @param storage - Object implementing Storage interface. For instance, localStorage.
 * @param key - Storage item key name.
 * @param defaultValue - Default value to be used, in the case the Storage item is not set. If we don't pass it - it will default to null.
 * @param isStringStorage - Flag for disabling parsing and item stringifying. If it's enabled, we will treat whatever is in the storage as a string.
 * @param setInit - In some advanced cases, we need to perform additional logic for setting the defaultValue, based on the Storage item parsed value.
 * setInit function will provide us quick access to the parsed Storage item and based on its value we can return the needed default/init value of the hook.
 */
export default function useStorage<ValueType>({ storage, key, defaultValue, isStringStorage, setInit }: UseStorageProps<ValueType>): UseStorageReturnType<ValueType | null>;
//# sourceMappingURL=useStorage.d.ts.map