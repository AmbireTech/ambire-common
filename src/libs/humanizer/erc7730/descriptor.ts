import { Erc7730Descriptor, Erc7730Field } from './types'
import { isPlainObject } from './utils'

// The checks and the merge of ERC-7730 descriptors, shared by the wallet and by
// `scripts/updateErc7730Registry.ts`, which builds the registry the wallet ships with, so that
// both read descriptors the same way.

/** The message names no descriptor, as these errors are reported outside of the device */
function throwInvalidRegistryData(): never {
  throw new Error('Invalid ERC-7730 registry data')
}

const validateDescriptorField = (field: unknown): field is Erc7730Field => {
  if (!isPlainObject(field)) throwInvalidRegistryData()

  const descriptorField = field

  if (descriptorField.path !== undefined && typeof descriptorField.path !== 'string')
    throwInvalidRegistryData()
  if (descriptorField.label !== undefined && typeof descriptorField.label !== 'string')
    throwInvalidRegistryData()
  if (descriptorField.format !== undefined && typeof descriptorField.format !== 'string') {
    throwInvalidRegistryData()
  }

  const { encryption } = descriptorField
  if (encryption !== undefined) {
    if (!isPlainObject(encryption)) throwInvalidRegistryData()
    if (encryption.fallbackLabel !== undefined && typeof encryption.fallbackLabel !== 'string')
      throwInvalidRegistryData()
  }

  const { fields } = descriptorField
  if (fields !== undefined) {
    if (!Array.isArray(fields)) throwInvalidRegistryData()

    const nestedFields = fields
    nestedFields.forEach((nestedField) => validateDescriptorField(nestedField))
  }

  return true
}

/**
 * The file name of the `$schema` a descriptor declares, which tells its version of ERC-7730, or
 * null if it declares none. Only the file name is read, as descriptors link to the same schema
 * through relative paths and through different URLs
 */
export const getSchemaFileName = (descriptor: unknown): string | null => {
  if (!isPlainObject(descriptor) || typeof descriptor.$schema !== 'string') return null

  return descriptor.$schema.split('/').pop() || null
}

/** Checks the shape of a descriptor the wallet reads. Throws if it is invalid */
export const validateDescriptor = (payload: unknown): payload is Erc7730Descriptor => {
  if (!isPlainObject(payload)) throwInvalidRegistryData()

  const descriptor = payload
  const { includes } = descriptor

  if (
    includes !== undefined &&
    typeof includes !== 'string' &&
    (!Array.isArray(includes) ||
      includes.some((includePath: unknown) => typeof includePath !== 'string'))
  ) {
    throwInvalidRegistryData()
  }

  const { display } = descriptor
  if (display === undefined) return true
  if (!isPlainObject(display)) throwInvalidRegistryData()

  const { formats, definitions } = display
  if (definitions !== undefined && !isPlainObject(definitions)) throwInvalidRegistryData()
  if (formats === undefined) return true
  if (!isPlainObject(formats)) throwInvalidRegistryData()

  const descriptorFormats = formats

  Object.values(descriptorFormats).forEach((format: unknown) => {
    if (!isPlainObject(format)) throwInvalidRegistryData()

    const descriptorFormat = format
    if (descriptorFormat.intent !== undefined && typeof descriptorFormat.intent !== 'string') {
      throwInvalidRegistryData()
    }

    const { fields } = descriptorFormat
    if (fields === undefined) return
    if (!Array.isArray(fields)) throwInvalidRegistryData()

    const descriptorFields = fields
    descriptorFields.forEach((field) => validateDescriptorField(field))
  })

  return true
}

/** The names of the descriptors a descriptor includes, as a list */
export const getIncludes = (descriptor: { includes?: unknown }): string[] => {
  const { includes } = descriptor
  if (typeof includes === 'string') return includes ? [includes] : []

  return Array.isArray(includes)
    ? includes.filter((include): include is string => typeof include === 'string')
    : []
}

/**
 * A descriptor merged over the one it includes: objects are merged key by key, and anything else
 * (arrays included) of `override` replaces the value of `base`
 */
export const mergeDescriptors = (
  base: Erc7730Descriptor,
  override: Erc7730Descriptor
): Erc7730Descriptor => {
  const merge = (left: unknown, right: unknown): unknown => {
    if (isPlainObject(left) && isPlainObject(right)) {
      return Object.keys(right).reduce<Record<string, unknown>>(
        (acc, key) => ({
          ...acc,
          [key]: merge(acc[key], right[key])
        }),
        { ...left }
      )
    }

    return right === undefined ? left : right
  }

  return merge(base, override) as Erc7730Descriptor
}
