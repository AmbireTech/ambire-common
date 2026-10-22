import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation';
export declare const getHdPathFromTemplate: (hdPathTemplate: HD_PATH_TEMPLATE_TYPE, index: number) => string;
export declare const getParentHdPathFromTemplate: (hdPathTemplate: HD_PATH_TEMPLATE_TYPE) => string;
export declare const getHdPathWithoutRoot: (hdPath: string) => string;
export declare const getHDPathIndices: (hdPathTemplate: HD_PATH_TEMPLATE_TYPE, insertIdx?: number) => any[];
/**
 * The part of an HD path template that is relative to `originPath` - the path an
 * extended public key was exported from. Returns null when the template does not
 * branch off the origin (e.g. a hardened account index), meaning that extended
 * public key cannot derive it.
 */
export declare const getHdPathTemplateRelativeToOrigin: (originPath: string, hdPathTemplate: HD_PATH_TEMPLATE_TYPE) => string;
/**
 * Which of the offered derivation paths an extended public key exported from
 * `originPath` can browse. Wallets that hand over a single extended public key
 * (QR, NFC) are limited to these.
 */
export declare const getDerivableHdPathTemplates: (originPath: string) => HD_PATH_TEMPLATE_TYPE[];
//# sourceMappingURL=hdPath.d.ts.map