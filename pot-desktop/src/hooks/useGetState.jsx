import { useState, useRef, useCallback } from 'react';

export const useGetState = (initState) => {
    const [state, setReactState] = useState(initState);
    const stateRef = useRef(state);
    stateRef.current = state;
    const getState = useCallback(() => stateRef.current, []);
    const setState = useCallback((value) => {
        const next = typeof value === 'function' ? value(stateRef.current) : value;
        stateRef.current = next;
        setReactState(next);
    }, []);
    return [state, setState, getState];
};
