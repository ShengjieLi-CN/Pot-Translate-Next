import { Navigate } from 'react-router-dom';

import Translate from '../pages/Translate';
import Recognize from '../pages/Recognize';
import General from '../pages/General';
import Service from '../pages/Service';
import History from '../pages/History';
import Hotkey from '../pages/Hotkey';
import Backup from '../pages/Backup';
import About from '../pages/About';
import InputTranslate from '../pages/InputTranslate';
import ScreenshotTranslate from '../pages/ScreenshotTranslate';
import LiveInterpretation from '../pages/LiveInterpretation';
import SelectionTranslate from '../pages/SelectionTranslate';

const routes = [
    { path: '/selection', element: <SelectionTranslate /> },
    { path: '/live', element: <LiveInterpretation /> },
    { path: '/screenshot', element: <ScreenshotTranslate /> },
    {
        path: '/input',
        element: <InputTranslate />,
    },
    {
        path: '/general',
        element: <General />,
    },
    {
        path: '/translate',
        element: <Translate />,
    },
    {
        path: '/recognize',
        element: <Recognize />,
    },
    {
        path: '/hotkey',
        element: <Hotkey />,
    },
    {
        path: '/service',
        element: <Service />,
    },
    {
        path: '/history',
        element: <History />,
    },
    {
        path: '/backup',
        element: <Backup />,
    },
    {
        path: '/about',
        element: <About />,
    },
    {
        path: '/',
        element: (
            <Navigate
                to='/input'
                replace
            />
        ),
    },
];

export default routes;
