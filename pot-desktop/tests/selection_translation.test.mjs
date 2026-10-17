import test from 'node:test';
import assert from 'node:assert/strict';
import {
    selectionBlocks,
    selectionResult,
    selectionServiceConfig,
    selectionTextStyle,
} from '../src/utils/selection_translation.mjs';

test('selected PDF paragraphs join visual lines and restore hyphenation', () => {
    const blocks = selectionBlocks([
        { text: 'The geome-\ntrical RNA structure\nis predicted.\n\nA second\nparagraph.' },
    ]);
    assert.deepEqual(
        blocks.map((b) => b.text),
        ['The geometrical RNA structure is predicted.', 'A second paragraph.']
    );
});

test('selected headings keep source bold and size without sentence splitting', () => {
    const blocks = selectionBlocks([
        { text: 'A novel prediction method\n', style: { bold: true, fontSize: 18 } },
        { text: 'First sentence. Second\nsentence.\n\nThird paragraph.', style: { fontSize: 11, italic: true } },
    ]);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].kind, 'heading');
    assert.equal(blocks[0].style.bold, true);
    assert.equal(blocks[1].text, 'First sentence. Second sentence.');
    assert.equal(blocks[1].style.italic, true);
});

test('inline font changes do not create new paragraphs', () => {
    const blocks = selectionBlocks([
        { text: 'An ', style: {} },
        { text: 'important', style: { bold: true } },
        { text: ' RNA result.\nMore text.', style: {} },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, 'An important RNA result. More text.');
});

test('lists retain item boundaries and merge wrapped continuation lines', () => {
    assert.deepEqual(
        selectionBlocks([{ text: '1. First item\ncontinued.\n2. Second item.' }]).map((b) => b.text),
        ['1. First item continued.', '2. Second item.']
    );
});

test('provider line breaks never add paragraphs, raw HTML remains inert text', () => {
    assert.equal(selectionResult('第一句。\n\n第二句。\r\n第三句。'), '第一句。 第二句。 第三句。');
    assert.equal(selectionResult('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
    assert.throws(() => selectionResult({ text: 'dictionary' }), /未返回文本/);
});

test('style conversion handles points and bounds without CSS injection', () => {
    assert.deepEqual(selectionTextStyle({ fontSize: 12, bold: true, italic: true }), {
        fontFamily: undefined,
        fontSize: '16px',
        fontWeight: 700,
        fontStyle: 'italic',
    });
    assert.equal(selectionTextStyle({ fontSize: Infinity }).fontSize, undefined);
    assert.match(selectionTextStyle({ fontFamily: 'A"; color:red;' }).fontFamily, /^"A\\"; color:red;", serif$/);
});

test('translation prompts isolate untrusted document and keep saved config intact', () => {
    const original = { model: 'custom', promptList: [{ role: 'user', content: 'old' }] };
    const scoped = selectionServiceConfig('openai', original);
    assert.match(scoped.promptList[0].content, /untrusted data/);
    assert.match(scoped.promptList[0].content, /extra line breaks/);
    assert.equal(original.promptList[0].content, 'old');
    assert.equal(scoped.model, 'custom');
});

test('local AI plugins receive a translation-only prompt without changing saved settings', () => {
    const saved = { model: 'custom', systemPrompt: 'Show the original and translation.' };
    const config = selectionServiceConfig('plugin.local.ai.siliconflow', saved);
    assert.match(config.systemPrompt, /without a preface.*source text/);
    assert.match(config.systemPrompt, /\{from\}.*\{to\}/);
    assert.equal(config.model, 'custom');
    assert.equal(saved.systemPrompt, 'Show the original and translation.');
});
