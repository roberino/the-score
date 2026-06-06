import type { ForgeConfig } from '@electron-forge/shared-types'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Volta',
    executableName: 'volta',
    icon: './resources/icon',
    appBundleId: 'com.yourname.volta',
    osxSign: {},
    osxNotarize: {
      tool: 'notarytool',
      appleId: process.env.APPLE_ID ?? '',
      appleIdPassword: process.env.APPLE_PASSWORD ?? '',
      teamId: process.env.APPLE_TEAM_ID ?? ''
    }
  },
  rebuildConfig: {},
  makers: [
    {
      // Windows installer
      name: '@electron-forge/maker-squirrel',
      config: { name: 'volta' }
    },
    {
      // macOS .zip (for auto-update)
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      // macOS .dmg
      name: '@electron-forge/maker-dmg',
      config: { format: 'ULFO' }
    },
    {
      // Linux .deb
      name: '@electron-forge/maker-deb',
      config: {}
    }
  ]
}

export default config
