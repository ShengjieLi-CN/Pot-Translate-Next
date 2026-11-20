import { useMemo } from 'react';
import { useConfig } from './useConfig';
import { DEFAULT_PADDLE_CONFIG } from '../utils/paddle_ocr.mjs';
import { DEFAULT_OCR_PROVIDER, DEFAULT_RAPID_CONFIG } from '../utils/ocr_provider.mjs';
export function useOcrConfig() {
    const [provider] = useConfig('ocr_provider', DEFAULT_OCR_PROVIDER);
    const [rapid] = useConfig('rapid_ocr', DEFAULT_RAPID_CONFIG);
    const [paddle] = useConfig('paddle_ocr', DEFAULT_PADDLE_CONFIG);
    const config = provider === 'rapidocr' ? rapid : paddle;
    return useMemo(() => (provider === null || config === null ? null : { provider, config }), [provider, config]);
}
