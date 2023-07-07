import { useCallback, useState } from 'react'

import { UseStorageProps, UseStorageReturnType } from './types'

const setInitDefault = <ValueType>(item: ValueType): ValueType => item

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
export default function useStorage<ValueType>({
  storage,
  key,
  defaultValue = null,
  isStringStorage = false,
  // @ts-ignore FIXME: Figure out why TypeScript complains
  setInit = setInitDefault
}: UseStorageProps<ValueType>): UseStorageReturnType<ValueType | null> {
  const [item, set] = useState<ValueType | null>(() => {
    // In case the item is not set in the storage, we just fall back to `defaultValue`
    // @ts-ignore FIXME: figure out how to use better type for `setInit`,
    // so that TypeScript doesn't complain
    if (!storage.getItem(key)) return setInit(defaultValue)

    // @ts-ignore FIXME: figure out how to use better type for `setInit`,
    // so that TypeScript doesn't complain
    if (isStringStorage) return setInit(storage.getItem(key))

    // Here we are going to keep the parsed item value.
    // If the parsing failed, we just fall back to `defaultValue`.
    let parsedItem

    try {
      parsedItem = JSON.parse(storage.getItem(key)!)
    } catch (e) {
      console.error(`Storage item parsing failure. Item key: ${key}`, e)

      parsedItem = defaultValue
    }

    return setInit(parsedItem)
  })

  const setItem = useCallback(
    (value: ValueType | null): void => {
      set((prevState: any) => {
        const itemValue = typeof value === 'function' ? value(prevState) : value

        if (isStringStorage && typeof itemValue !== 'string') {
          throw new Error(
            `Wrong item type. We expect a string to be passed, but got ${typeof itemValue}!`
          )
        }

        storage.setItem(key, isStringStorage ? itemValue : JSON.stringify(itemValue))

        return itemValue
      })
    },
    [storage, key, isStringStorage]
  )

  const removeItem = useCallback((): void => {
    storage.removeItem(key)
    set(null)
  }, [storage, key])

  return [item, setItem, removeItem]
}
