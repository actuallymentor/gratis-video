import { BrowserRouter } from 'react-router'
import { QueryParamProvider } from 'use-query-params'
import { ReactRouter6Adapter } from 'use-query-params/adapters/react-router-6'
import { Toaster } from 'react-hot-toast'
import AppRoutes from './routes/Routes.jsx'
import { useAppBootstrap } from './hooks/use_app_bootstrap.js'
import { PwaRefreshBadge } from './components/molecules/PwaRefreshBadge.jsx'

function AppShell() {

    useAppBootstrap()

    return <>
        <AppRoutes />
        <PwaRefreshBadge />
        <Toaster
            position="top-center"
            toastOptions={ {
                duration: 2200,
                style: {
                    borderRadius: `0.5rem`,
                    color: `#123133`,
                    fontFamily: `var(--font-body)`
                }
            } }
        />
    </>
}

export default function App() {
    return <BrowserRouter>
        <QueryParamProvider adapter={ ReactRouter6Adapter }>
            <AppShell />
        </QueryParamProvider>
    </BrowserRouter>
}
