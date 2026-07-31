import { defineManifest } from '@crxjs/vite-plugin'
import packageData from '../package.json' with { type: 'json' }

const isDev = process.env.NODE_ENV == 'development'

export default defineManifest({
  name: `${packageData.displayName || packageData.name}${isDev ? ` ➡️ Dev` : ''}`,
  description: '__MSG_extensionDescription__',
  default_locale: 'en',
  version: packageData.version,
  manifest_version: 3,
  permissions: ['storage'],
  icons: {
    16: 'images/logo16.png',
    32: 'images/logo32.png',
    48: 'images/logo48.png',
    128: 'images/logo128.png',
  },
  action: {
    default_popup: 'popup.html',
    default_title: 'Mapbox Vector Tiles',
    default_icon: {
      16: 'images/logo16.png',
      32: 'images/logo32.png',
      48: 'images/logo48.png',
      128: 'images/logo128.png',
    },
  },
  devtools_page: 'devtools.html',
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
})
