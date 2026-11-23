import { useMemo } from 'react';
import { useConfig } from './useConfig';
import { DEFAULT_OCR_PROVIDER, DEFAULT_RAPID_CONFIG } from '../utils/ocr_provider.mjs';
export function useOcrConfig() {
    const [rapid] = useConfig('rapid_ocr', DEFAULT_RAPID_CONFIG);
    return useMemo(() => (rapid === null ? null : { provider: DEFAULT_OCR_PROVIDER, config: rapid }), [rapid]);
}
