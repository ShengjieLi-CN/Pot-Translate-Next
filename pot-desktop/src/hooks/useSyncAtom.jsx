import { useAtom } from 'jotai';

import { useGetState } from './useGetState';

export const useSyncAtom = (atom, initialValue) => {
    const [atomValue, setAtomValue] = useAtom(atom);
    const [localValue, setLocalValue, getLocalValue] = useGetState(initialValue ?? atomValue);

    const syncAtom = () => setAtomValue(getLocalValue());

    return [localValue, setLocalValue, syncAtom];
};
