import { useCallback } from 'react';
import { createSpeechPlayer } from '../utils/speech.mjs';
const player = createSpeechPlayer();

export const useVoice = () =>
    useCallback((data) => {
        if (player.active) {
            player.stop();
            return Promise.resolve();
        }
        return player.play(data);
    }, []);
