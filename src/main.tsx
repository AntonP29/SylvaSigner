import React from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './styles.css'
import { SylvaSigner } from '@/components/sylva-signer'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('Missing app root')

createRoot(root).render(
  <>
    <SylvaSigner />
    <Analytics />
  </>
)
