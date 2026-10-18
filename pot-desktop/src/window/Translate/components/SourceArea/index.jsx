import { Button, Card, CardBody, CardFooter, ButtonGroup, Chip, Tooltip, Spacer } from '@nextui-org/react';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { HiOutlineVolumeUp } from 'react-icons/hi';
import { appWindow } from '@tauri-apps/api/window';
import toast, { Toaster } from 'react-hot-toast';
import { listen } from '@tauri-apps/api/event';
import { MdContentCopy } from 'react-icons/md';
import { MdSmartButton } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import { HiTranslate } from 'react-icons/hi';
import { LuDelete } from 'react-icons/lu';
import { invoke } from '@tauri-apps/api';
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { activeSentenceAtom, bilingualModeAtom, bilingualDirectionAtom, sourceDraftAtom } from '../../alignment';
import { splitSentences, bilingualLanguages } from '../../../../utils/sentence_alignment.mjs';
import { getServiceName, getServiceSouceType, ServiceSourceType } from '../../../../utils/service_instance';
import { useConfig, useSyncAtom, useVoice, useToastStyle } from '../../../../hooks';
import { invoke_plugin } from '../../../../utils/invoke_plugin';
import * as recognizeServices from '../../../../services/recognize';
import * as builtinTtsServices from '../../../../services/tts';
import detect from '../../../../utils/lang_detect';
import { store } from '../../../../utils/store';
import { info } from 'tauri-plugin-log-api';
import { debug } from 'tauri-plugin-log-api';

export const sourceTextAtom = atom('');
export const detectLanguageAtom = atom('');

let unlisten = null;
let timer = null;

export default function SourceArea(props) {
    const { pluginList, serviceInstanceConfigMap, embedded = false, canTranslate = true, children } = props;
    const [appFontSize] = useConfig('app_font_size', 16);
    const savedDraft = useAtomValue(sourceDraftAtom);
    const [sourceText, setSourceText, syncSourceText] = useSyncAtom(sourceTextAtom, embedded ? savedDraft : undefined);
    const bilingualMode = useAtomValue(bilingualModeAtom);
    const bilingualDirection = useAtomValue(bilingualDirectionAtom);
    const [activeSentence, setActiveSentence] = useAtom(activeSentenceAtom);
    const setBilingualMode = useSetAtom(bilingualModeAtom);
    const setSourceDraft = useSetAtom(sourceDraftAtom);
    const sourceTextChangeTimer = useRef(null);
    const sourceRevision = useRef(0);
    const submitTextRef = useRef(null);
    const isComposing = useRef(false);
    const [composing, setComposing] = useState(false);
    const sourceBodyRef = useRef(null);
    const highlightRef = useRef(null);
    const sourceSentences = useMemo(() => splitSentences(sourceText), [sourceText]);
    const highlight =
        (embedded || bilingualMode) && activeSentence?.sourceText === sourceText.trim()
            ? sourceSentences[activeSentence.index]
            : null;
    const [detectLanguage, setDetectLanguage] = useAtom(detectLanguageAtom);
    const [incrementalTranslate] = useConfig('incremental_translate', false);
    const [dynamicTranslate] = useConfig('dynamic_translate', false);
    const [deleteNewline] = useConfig('translate_delete_newline', false);
    const [recognizeLanguage] = useConfig('recognize_language', 'auto');
    const [recognizeServiceList] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [ttsServiceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [hideWindow] = useConfig('translate_hide_window', false);
    const [hideSource] = useConfig('hide_source', false);
    const [ttsPluginInfo, setTtsPluginInfo] = useState();
    const [windowType, setWindowType] = useState('[SELECTION_TRANSLATE]');
    const toastStyle = useToastStyle();
    const { t } = useTranslation();
    const textAreaRef = useRef();
    const speak = useVoice();

    const handleNewText = async (text) => {
        sourceRevision.current++;
        clearTimeout(sourceTextChangeTimer.current);
        text = text.trim();
        if (hideWindow) {
            appWindow.hide();
        } else {
            appWindow.show();
            appWindow.setFocus();
        }
        // 清空检测语言
        setDetectLanguage('');
        if (text === '[INPUT_TRANSLATE]') {
            setBilingualMode(true);
            setWindowType('[INPUT_TRANSLATE]');
            appWindow.show();
            appWindow.setFocus();
            setSourceText('');
            syncSourceText();
            requestAnimationFrame(() => textAreaRef.current?.focus());
        } else if (text === '[IMAGE_TRANSLATE]') {
            setWindowType('[IMAGE_TRANSLATE]');
            const base64 = await invoke('get_base64');
            const serviceInstanceKey = recognizeServiceList[0];
            if (getServiceSouceType(serviceInstanceKey) === ServiceSourceType.PLUGIN) {
                if (recognizeLanguage in pluginList['recognize'][getServiceName(serviceInstanceKey)].language) {
                    const pluginConfig = serviceInstanceConfigMap[serviceInstanceKey];

                    let [func, utils] = await invoke_plugin('recognize', getServiceName(serviceInstanceKey));
                    func(
                        base64,
                        pluginList['recognize'][getServiceName(serviceInstanceKey)].language[recognizeLanguage],
                        {
                            config: pluginConfig,
                            utils,
                        }
                    ).then(
                        (v) => {
                            let newText = v.trim();
                            if (deleteNewline) {
                                newText = v.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                            } else {
                                newText = v.trim();
                            }
                            if (incrementalTranslate) {
                                setSourceText((old) => {
                                    return old + ' ' + newText;
                                });
                            } else {
                                setSourceText(newText);
                            }
                            detect_language(newText).then(() => {
                                syncSourceText();
                            });
                        },
                        (e) => {
                            setSourceText(e.toString());
                        }
                    );
                } else {
                    setSourceText('Language not supported');
                }
            } else {
                if (recognizeLanguage in recognizeServices[getServiceName(serviceInstanceKey)].Language) {
                    const instanceConfig = serviceInstanceConfigMap[serviceInstanceKey];
                    recognizeServices[getServiceName(serviceInstanceKey)]
                        .recognize(
                            base64,
                            recognizeServices[getServiceName(serviceInstanceKey)].Language[recognizeLanguage],
                            {
                                config: instanceConfig,
                            }
                        )
                        .then(
                            (v) => {
                                let newText = v.trim();
                                if (deleteNewline) {
                                    newText = v.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                                } else {
                                    newText = v.trim();
                                }
                                if (incrementalTranslate) {
                                    setSourceText((old) => {
                                        return old + ' ' + newText;
                                    });
                                } else {
                                    setSourceText(newText);
                                }
                                detect_language(newText).then(() => {
                                    syncSourceText();
                                });
                            },
                            (e) => {
                                setSourceText(e.toString());
                            }
                        );
                } else {
                    setSourceText('Language not supported');
                }
            }
        } else {
            setWindowType('[SELECTION_TRANSLATE]');
            let newText = text.trim();
            if (deleteNewline) {
                newText = text.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
            } else {
                newText = text.trim();
            }
            if (incrementalTranslate) {
                setSourceText((old) => {
                    return old + ' ' + newText;
                });
            } else {
                setSourceText(newText);
            }
            detect_language(newText).then(() => {
                syncSourceText();
            });
        }
    };

    const submitText = async () => {
        clearTimeout(sourceTextChangeTimer.current);
        if (!sourceText.trim() || !canTranslate) return;
        const revision = sourceRevision.current;
        try {
            const language = bilingualMode
                ? bilingualLanguages(sourceText, bilingualDirection).from
                : await detect(sourceText);
            if (revision !== sourceRevision.current) return;
            setDetectLanguage(language);
            syncSourceText();
        } catch (error) {
            if (revision === sourceRevision.current) toast.error(String(error), { style: toastStyle });
        }
    };
    submitTextRef.current = submitText;

    // The main input page always translates its latest draft, including restored
    // drafts and programmatic edits. Popup translation keeps its existing setting.
    useEffect(() => {
        if (!embedded) return;
        clearTimeout(sourceTextChangeTimer.current);
        if (!sourceText.trim()) {
            syncSourceText();
            return;
        }
        if (!canTranslate || composing) return;
        sourceTextChangeTimer.current = setTimeout(() => submitTextRef.current(), 600);
        return () => clearTimeout(sourceTextChangeTimer.current);
    }, [sourceText, embedded, canTranslate, composing]);

    const keyDown = (event) => {
        if (isComposing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitText();
        }
        if (event.key === 'Escape') {
            if (!embedded) appWindow.close();
        }
    };

    const handleSpeak = async () => {
        const instanceKey = ttsServiceList[0];
        let detected = detectLanguage;
        if (detected === '') {
            detected = await detect(sourceText);
            setDetectLanguage(detected);
        }
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            if (!(detected in ttsPluginInfo.language)) {
                throw new Error('Language not supported');
            }
            const pluginConfig = serviceInstanceConfigMap[instanceKey];
            let [func, utils] = await invoke_plugin('tts', getServiceName(instanceKey));
            let data = await func(sourceText, ttsPluginInfo.language[detected], {
                config: pluginConfig,
                utils,
            });
            speak(data);
        } else {
            if (!(detected in builtinTtsServices[getServiceName(instanceKey)].Language)) {
                throw new Error('Language not supported');
            }
            const instanceConfig = serviceInstanceConfigMap[instanceKey];
            let data = await builtinTtsServices[getServiceName(instanceKey)].tts(
                sourceText,
                builtinTtsServices[getServiceName(instanceKey)].Language[detected],
                {
                    config: instanceConfig,
                }
            );
            speak(data);
        }
    };

    useEffect(() => {
        if (embedded) return;
        if (hideWindow !== null) {
            if (unlisten) {
                unlisten.then((f) => {
                    f();
                });
            }
            unlisten = listen('new_text', (event) => {
                appWindow.setFocus();
                handleNewText(event.payload);
            });
            const currentListener = unlisten;
            return () => currentListener.then((unlisten) => unlisten());
        }
    }, [hideWindow, embedded]);

    useEffect(() => {
        if (ttsServiceList?.length && getServiceSouceType(ttsServiceList[0]) === ServiceSourceType.PLUGIN) {
            readTextFile(`plugins/tts/${getServiceName(ttsServiceList[0])}/info.json`, {
                dir: BaseDirectory.AppConfig,
            }).then((infoStr) => {
                setTtsPluginInfo(JSON.parse(infoStr));
            });
        }
    }, [ttsServiceList]);

    useEffect(() => {
        if (embedded) return;
        if (
            deleteNewline !== null &&
            incrementalTranslate !== null &&
            recognizeLanguage !== null &&
            recognizeServiceList !== null &&
            hideWindow !== null
        ) {
            invoke('get_text').then((v) => {
                handleNewText(v);
            });
        }
    }, [deleteNewline, incrementalTranslate, recognizeLanguage, recognizeServiceList, hideWindow, embedded]);

    useEffect(() => {
        setSourceDraft(sourceText);
        setActiveSentence(null);
        textAreaRef.current.style.height = '50px';
        textAreaRef.current.style.height = textAreaRef.current.scrollHeight + 'px';
    }, [sourceText]);

    useEffect(() => {
        const element = textAreaRef.current;
        let width = 0;
        const observer = new ResizeObserver(() => {
            if (!element || element.clientWidth === width) return;
            width = element.clientWidth;
            element.style.height = '50px';
            element.style.height = element.scrollHeight + 'px';
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const detect_language = async (text) => {
        setDetectLanguage(bilingualMode ? bilingualLanguages(text, bilingualDirection).from : await detect(text));
    };

    useEffect(
        () => () => {
            sourceRevision.current++;
            clearTimeout(sourceTextChangeTimer.current);
        },
        []
    );

    useEffect(() => {
        if (!highlightRef.current || !sourceBodyRef.current) return;
        const mark = highlightRef.current.getBoundingClientRect();
        const body = sourceBodyRef.current.getBoundingClientRect();
        if (mark.top < body.top) sourceBodyRef.current.scrollTop += mark.top - body.top - 4;
        else if (mark.bottom > body.bottom) sourceBodyRef.current.scrollTop += mark.bottom - body.bottom + 4;
    }, [activeSentence]);

    const changeSourceText = async (text) => {
        sourceRevision.current++;
        clearTimeout(sourceTextChangeTimer.current);
        setActiveSentence(null);
        setDetectLanguage('');
        await setSourceText(text);
        if (!embedded && dynamicTranslate && canTranslate && !isComposing.current) {
            // Read the latest draft when the debounce fires.
            sourceTextChangeTimer.current = setTimeout(() => submitTextRef.current(), 1000);
        }
    };

    const transformVarName = function (str) {
        let str2 = str;

        // snake_case to SNAKE_CASE
        if (/_[a-z]/.test(str2)) {
            str2 = str2
                .split('_')
                .map((it) => it.toLocaleUpperCase())
                .join('_');
        }
        if (str2 !== str) {
            return str2;
        }

        // SNAKE_CASE to kebab-case
        if (/^[A-Z]+(_[A-Z]+)*$/.test(str2)) {
            str2 = str2
                .split('_')
                .map((it) => it.toLocaleLowerCase())
                .join('-');
        }
        if (str2 !== str) {
            return str2;
        }

        // kebab-case to dot.notation
        if (/-/.test(str2)) {
            str2 = str2
                .split('-')
                .map((it) => it.toLocaleLowerCase())
                .join('.');
        }
        if (str2 !== str) {
            return str2;
        }

        // dot.notation to space separated
        if (/\.[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/(\.)([a-z])/g, (_, _2, it) => ' ' + it);
        }
        if (str2 !== str) {
            return str2;
        }

        // space separated to Title Case
        if (/\s[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([a-z])/g, (_, it) => ' ' + it.toLocaleUpperCase());
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // Title Case to CamelCase
        if (/\s[A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([A-Z])/g, (_, it) => it);
            str2 = str2.substring(0, 1).toLocaleLowerCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // CamelCase to PascalCase
        if (/^[a-z]+[A-Z]+/.test(str2)) {
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // PascalCase to snake_case
        if (/[^\s][A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/[A-Z]/g, (it, offset) => {
                return (offset == 0 ? '' : '_') + it.toLocaleLowerCase();
            });
        }

        return str2;
    };
    useEffect(() => {
        textAreaRef.current.addEventListener('keydown', async (event) => {
            if (event.altKey && event.shiftKey && event.code === 'KeyU') {
                const originText = textAreaRef.current.value;
                const selectionStart = textAreaRef.current.selectionStart;
                const selectionEnd = textAreaRef.current.selectionEnd;
                const selectionText = originText.substring(selectionStart, selectionEnd);

                const convertedText = transformVarName(selectionText);
                const targetText =
                    originText.substring(0, selectionStart) + convertedText + originText.substring(selectionEnd);

                await changeSourceText(targetText);
                textAreaRef.current.selectionStart = selectionStart;
                textAreaRef.current.selectionEnd = selectionStart + convertedText.length;
            }
        });
    }, [textAreaRef]);

    return (
        <div
            className={hideSource && !embedded && !bilingualMode && windowType !== '[INPUT_TRANSLATE]' ? 'hidden' : ''}
        >
            <Card
                shadow='none'
                className='bg-content1 rounded-[10px] mt-[1px] pb-0'
            >
                <Toaster />
                <CardBody
                    ref={sourceBodyRef}
                    className={`bg-content1 p-[12px] pb-0 overflow-y-auto ${embedded ? 'input-translation-source' : 'max-h-[40vh]'}`}
                >
                    <div
                        className='sentence-source'
                        style={{ fontSize: `${appFontSize}px` }}
                    >
                        <div
                            className='sentence-source-backdrop'
                            aria-hidden='true'
                        >
                            {highlight ? (
                                <>
                                    {sourceText.slice(0, highlight.start)}
                                    <mark
                                        ref={highlightRef}
                                        className='sentence-highlight'
                                    >
                                        {sourceText.slice(highlight.start, highlight.end)}
                                    </mark>
                                    {sourceText.slice(highlight.end)}
                                </>
                            ) : (
                                sourceText
                            )}
                            {'\n'}
                        </div>
                        <textarea
                            autoFocus
                            ref={textAreaRef}
                            className='sentence-source-input'
                            aria-label={t('bilingual.source')}
                            placeholder={
                                embedded
                                    ? t('config.input.placeholder')
                                    : bilingualMode
                                      ? t('bilingual.placeholder')
                                      : undefined
                            }
                            spellCheck={false}
                            value={sourceText}
                            onKeyDown={keyDown}
                            onCompositionStart={() => {
                                isComposing.current = true;
                                setComposing(true);
                                sourceRevision.current++;
                                clearTimeout(sourceTextChangeTimer.current);
                            }}
                            onCompositionEnd={(event) => {
                                isComposing.current = false;
                                setComposing(false);
                                changeSourceText(event.currentTarget.value);
                            }}
                            onFocus={() => setActiveSentence(null)}
                            onChange={(e) => {
                                const v = e.target.value;
                                changeSourceText(v);
                            }}
                        />
                    </div>
                </CardBody>

                <CardFooter className='bg-content1 rounded-none rounded-b-[10px] flex justify-between px-[12px] p-[5px]'>
                    <div className='flex justify-start'>
                        <ButtonGroup className='mr-[5px]'>
                            <Tooltip content={t('translate.speak')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        handleSpeak().catch((e) => {
                                            toast.error(e.toString(), { style: toastStyle });
                                        });
                                    }}
                                >
                                    <HiOutlineVolumeUp className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.copy')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        writeText(sourceText);
                                    }}
                                >
                                    <MdContentCopy className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.delete_newline')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        const newText = sourceText.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                                        setSourceText(newText);
                                        detect_language(newText).then(() => {
                                            syncSourceText();
                                        });
                                    }}
                                >
                                    <MdSmartButton className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('common.clear')}>
                                <Button
                                    variant='light'
                                    size='sm'
                                    isIconOnly
                                    isDisabled={sourceText === ''}
                                    aria-label={t('common.clear')}
                                    onPress={() => {
                                        sourceRevision.current++;
                                        clearTimeout(sourceTextChangeTimer.current);
                                        setActiveSentence(null);
                                        setSourceText('');
                                        setDetectLanguage('');
                                        syncSourceText();
                                    }}
                                >
                                    <LuDelete className='text-[16px]' />
                                </Button>
                            </Tooltip>
                        </ButtonGroup>
                        {detectLanguage !== '' && (
                            <Chip
                                size='sm'
                                color='secondary'
                                variant='dot'
                                className='my-auto'
                            >
                                {t(`languages.${detectLanguage}`)}
                            </Chip>
                        )}
                    </div>
                    <Tooltip content={t('translate.translate')}>
                        <Button
                            size='sm'
                            aria-label={t('translate.translate')}
                            color='primary'
                            variant='light'
                            isIconOnly={!embedded}
                            isDisabled={!canTranslate || !sourceText.trim()}
                            className='text-[14px] font-bold'
                            startContent={<HiTranslate className='text-[16px]' />}
                            onPress={submitText}
                        >
                            {embedded && t('translate.translate')}
                        </Button>
                    </Tooltip>
                </CardFooter>
                {children && <div className='px-[12px] pb-[12px]'>{children}</div>}
            </Card>
            <Spacer y={2} />
        </div>
    );
}
