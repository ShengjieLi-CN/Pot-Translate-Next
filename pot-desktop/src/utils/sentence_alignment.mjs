// Keep source offsets: translated sentences may be split or merged by a provider.
export function splitSentences(text) {
    const parts = [];
    const segmenter =
        typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
    // Newlines are explicit boundaries, including when punctuation is absent.
    for (const line of text.matchAll(/[^\r\n]+/g)) {
        const segments = segmenter
            ? Array.from(segmenter.segment(line[0]), ({ segment, index }) => ({ segment, index }))
            : Array.from(line[0].matchAll(/[^.!?。！？]*[.!?。！？]+[”’"']*\s*|[^.!?。！？]+$/g), (match) => ({
                  segment: match[0],
                  index: match.index,
              }));
        for (const { segment, index } of segments) {
            const value = segment.trim();
            if (!value) continue;
            const start = line.index + index + segment.indexOf(value);
            parts.push({ text: value, start, end: start + value.length });
        }
    }
    return parts;
}

export function bilingualLanguages(text, direction) {
    const from = direction === 'auto' ? (/[\u3400-\u9fff\uf900-\ufaff]/u.test(text) ? 'zh_cn' : 'en') : direction;
    return { from, to: from === 'en' ? 'zh_cn' : 'en' };
}

export function joinTranslations(parts) {
    return parts.map((part) => `${part.separatorBefore ?? ''}${part.translation}${part.separatorAfter ?? ''}`).join('');
}

// Sequential requests avoid a burst of API calls. Check cancellation before and
// after every await, including streaming updates from the current sentence.
export async function translateSentences(text, translate, { isCurrent, onProgress, textOnlyError }) {
    const sentences = splitSentences(text);
    const parts = sentences.map((part, index) => {
        const gap = text.slice(index === 0 ? 0 : sentences[index - 1].end, part.start);
        return {
            ...part,
            // Keep hard breaks and blank lines from the source, rather than
            // turning each sentence into its own paragraph.
            separatorBefore: index === 0 ? gap : gap || ' ',
            separatorAfter: index === sentences.length - 1 ? text.slice(part.end) : '',
            translation: '',
        };
    });
    for (const [index, part] of parts.entries()) {
        if (!isCurrent()) return '';
        const publish = (value) => {
            if (!isCurrent() || typeof value !== 'string') return;
            // A source sentence contains no hard breaks; provider-added wraps
            // must not introduce extra paragraphs within that sentence.
            parts[index] = { ...part, translation: value.replace(/\s*[\r\n]+\s*/g, ' ') };
            onProgress(parts.slice());
        };
        const result = await translate(part.text, publish);
        if (!isCurrent()) return '';
        // Dictionary providers retain their existing rich result for one word.
        if (typeof result !== 'string') {
            if (parts.length === 1) return result;
            throw new Error(textOnlyError);
        }
        publish(result.trim());
    }
    return joinTranslations(parts);
}
