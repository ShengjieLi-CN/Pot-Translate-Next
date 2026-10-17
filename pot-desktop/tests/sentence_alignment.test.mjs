import test from 'node:test';
import assert from 'node:assert/strict';
import {
    splitSentences,
    bilingualLanguages,
    joinTranslations,
    translateSentences,
} from '../src/utils/sentence_alignment.mjs';

const options = (overrides = {}) => ({
    isCurrent: () => true,
    onProgress: () => {},
    textOnlyError: 'Use text translation',
    ...overrides,
});

test('reference paragraph produces two complete source sentences', () => {
    const text =
        "My name is Shengjie Li, a final-year undergraduate in Computer Science and Software Technology at Xi'an Jiaotong-Liverpool University (XJTLU), China. I am writing to ask whether I could join your Bioinformatics and Computational Genomics Lab as an intern or volunteer.";
    const parts = splitSentences(text);
    assert.equal(parts.length, 2);
    assert.ok(parts[0].text.endsWith('China.'));
    assert.ok(parts[1].text.endsWith('volunteer.'));
});

test('offsets preserve whitespace, paragraphs, Chinese punctuation and emoji', () => {
    const text = '  你好！世界。\r\n\r\n  Hello 😀! Another sentence?\nNo punctuation  ';
    const parts = splitSentences(text);
    assert.equal(parts.length, 5);
    for (const part of parts) assert.equal(text.slice(part.start, part.end), part.text);
    assert.equal(parts.at(-1).text, 'No punctuation');
});

test('decimal values are not split into separate sentences', () => {
    assert.equal(splitSentences('The value is 3.14. Next sentence.').length, 2);
});

test('blank input has no sentences or requests', async () => {
    assert.deepEqual(splitSentences(' \n\t'), []);
    assert.equal(await translateSentences('', () => assert.fail('unexpected request'), options()), '');
});

test('fallback supports English, Chinese and final unpunctuated text', () => {
    const segmenter = Intl.Segmenter;
    try {
        Intl.Segmenter = undefined;
        assert.deepEqual(
            splitSentences('Hello! 你好。Last line').map((part) => part.text),
            ['Hello!', '你好。', 'Last line']
        );
        assert.equal(splitSentences('...')[0].text, '...');
    } finally {
        Intl.Segmenter = segmenter;
    }
});

test('automatic and explicit bilingual directions', () => {
    assert.deepEqual(bilingualLanguages('Hello', 'auto'), { from: 'en', to: 'zh_cn' });
    assert.deepEqual(bilingualLanguages('你好 XJTLU', 'auto'), { from: 'zh_cn', to: 'en' });
    assert.deepEqual(bilingualLanguages('中文引用', 'en'), { from: 'en', to: 'zh_cn' });
    assert.deepEqual(bilingualLanguages('Hello', 'zh_cn'), { from: 'zh_cn', to: 'en' });
});

test('alignment follows requests even when a provider splits one translation into two sentences', async () => {
    const calls = [];
    const progress = [];
    const result = await translateSentences(
        'Hello. Next.',
        async (text) => {
            calls.push(text);
            return text === 'Hello.' ? '你好。这是第一句。' : '下一句。';
        },
        options({ onProgress: (parts) => progress.push(parts) })
    );
    assert.deepEqual(calls, ['Hello.', 'Next.']);
    assert.equal(result, '你好。这是第一句。 下一句。');
    assert.equal(progress.at(-1)[0].text, 'Hello.');
    assert.equal(progress.at(-1)[0].translation, '你好。这是第一句。');
    assert.equal(progress[0][1].translation, '');
});

test('streaming updates only replace the current sentence', async () => {
    const progress = [];
    await translateSentences(
        'One. Two.',
        async (text, publish) => {
            publish('partial');
            return text === 'One.' ? '一。' : '二。';
        },
        options({ onProgress: (parts) => progress.push(parts) })
    );
    assert.equal(progress[2][0].translation, '一。');
    assert.equal(progress[2][1].translation, 'partial');
    assert.equal(joinTranslations(progress.at(-1)), '一。 二。');
});

test('sentences in a source paragraph stay in one translated paragraph', async () => {
    const result = await translateSentences(
        'RNA structure is complex. Data is scarce. Prediction is difficult.',
        async (text) =>
            ({
                'RNA structure is complex.': 'RNA结构复杂。',
                'Data is scarce.': '数据稀缺。',
                'Prediction is difficult.': '预测困难。',
            })[text],
        options()
    );
    assert.equal(result, 'RNA结构复杂。 数据稀缺。 预测困难。');
    assert.equal(result.includes('\n'), false);
});

test('source paragraph breaks, blank lines and indentation survive streaming and final results', async () => {
    const source = '  One. Two.\r\n\r\n\tThree.\nFour.  ';
    const translated = { 'One.': '一。', 'Two.': '二。', 'Three.': '三。', 'Four.': '四。' };
    const progress = [];
    const result = await translateSentences(
        source,
        async (text, publish) => {
            publish(translated[text]);
            return translated[text];
        },
        options({ onProgress: (parts) => progress.push(parts) })
    );
    assert.equal(result, '  一。 二。\r\n\r\n\t三。\n四。  ');
    assert.equal(joinTranslations(progress.at(-1)), result);
    for (const parts of progress) {
        for (const part of parts) assert.equal(source.slice(part.start, part.end), part.text);
    }
});

test('Chinese sentences without source spaces remain in one readable English paragraph', async () => {
    const result = await translateSentences(
        '你好！世界。',
        async (text) => (text === '你好！' ? 'Hello!' : 'World.'),
        options()
    );
    assert.equal(result, 'Hello! World.');
});

test('provider-added line wrapping does not create extra paragraphs', async () => {
    const progress = [];
    const result = await translateSentences(
        'First.\n\nSecond.',
        async (_, publish) => {
            publish('第一行\n第二行');
            return '  第一句。\r\n\r\n第二句。  ';
        },
        options({ onProgress: (parts) => progress.push(parts) })
    );
    assert.equal(result, '第一句。 第二句。\n\n第一句。 第二句。');
    assert.equal(progress[0][0].translation, '第一行 第二行');
});

test('superseded requests cannot publish streaming or final values, or start the next request', async () => {
    let current = true;
    let calls = 0;
    const progress = [];
    const result = await translateSentences(
        'One. Two.',
        async (_, publish) => {
            calls++;
            current = false;
            publish('stale stream');
            return 'stale final';
        },
        options({ isCurrent: () => current, onProgress: (parts) => progress.push(parts) })
    );
    assert.equal(calls, 1);
    assert.equal(result, '');
    assert.deepEqual(progress, []);
});

test('already cancelled translation makes no requests', async () => {
    await translateSentences('One.', () => assert.fail('unexpected request'), options({ isCurrent: () => false }));
});

test('provider failure is surfaced and stops subsequent requests', async () => {
    const calls = [];
    await assert.rejects(
        translateSentences(
            'One. Two. Three.',
            async (text) => {
                calls.push(text);
                if (text === 'Two.') throw new Error('Rate limited');
                return '一。';
            },
            options()
        ),
        /Rate limited/
    );
    assert.deepEqual(calls, ['One.', 'Two.']);
});

test('single-word dictionaries keep rich results; multi-sentence dictionaries explain incompatibility', async () => {
    const dictionary = { explanations: [{ explains: ['你好'] }] };
    assert.equal(await translateSentences('Hello', async () => dictionary, options()), dictionary);
    await assert.rejects(
        translateSentences('One. Two.', async () => dictionary, options()),
        /Use text translation/
    );
});
