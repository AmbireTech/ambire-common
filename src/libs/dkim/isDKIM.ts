export default function isDKIM(key: any) {
    return /^(DKIM-Signature|X-Google-DKIM-Signature)/.test(key)
}
