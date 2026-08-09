import { renderToString } from 'react-dom/server'

import { SylvaSigner, type SylvaRoute } from '@/components/sylva-signer'

export function render(route: SylvaRoute = 'app') {
  return renderToString(<SylvaSigner initialRoute={route} />)
}
