import { atom } from 'jotai';

export const bilingualModeAtom = atom(false);
export const bilingualDirectionAtom = atom('auto');
export const activeSentenceAtom = atom(null);
export const sourceDraftAtom = atom('');
