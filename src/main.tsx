import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = createRoot(document.getElementById('root')!)
const app = <App />

root.render(import.meta.env.DEV ? app : <StrictMode>{app}</StrictMode>)
