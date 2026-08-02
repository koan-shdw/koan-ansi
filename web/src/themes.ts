// KOAN.design theme library on the shared var contract (bible ch. 01).
// Values from vi-dancer lib/themes.ts, renamed per the contract migration map
// (--amber→--accent, --amber-dim→--accent-dim, --gold→--accent-soft).
// DECK is this tool's shipped default (green terminal — the scene look).

export type ThemeMap = Record<string, string>

export const THEME_VARS = [
  '--bg0', '--bg', '--bg2', '--panel', '--panel2', '--field', '--header',
  '--line', '--line2',
  '--txt-hi', '--txt', '--body', '--muted', '--dim',
  '--accent', '--accent-dim', '--accent-soft', '--on-accent',
  '--ok', '--warn', '--bad', '--focus',
] as const

export const PRESET_THEMES: Record<string, ThemeMap> = {
  DECK: {
    '--bg0': '#050807', '--bg': '#070a08', '--bg2': '#0c120e',
    '--panel': '#101713', '--panel2': '#16201a', '--field': '#08100b',
    '--header': '#020403',
    '--line': '#1e3327', '--line2': '#2c4a38',
    '--txt-hi': '#e6ffe9', '--txt': '#d8f5dd', '--body': '#b8dfc2',
    '--muted': '#7aa989', '--dim': '#4e7360',
    '--accent': '#00ff9f', '--accent-dim': '#0a7a52', '--accent-soft': '#7dffc7',
    '--on-accent': '#001a10',
    '--ok': '#52e07a', '--warn': '#ffcf57', '--bad': '#ff5f56', '--focus': '#00ff9f',
  },
  WINTERMUTE: {
    '--bg0': '#0a0d12', '--bg': '#0d1017', '--bg2': '#131722',
    '--panel': '#1a1f2c', '--panel2': '#222836', '--field': '#0e1219',
    '--header': '#05070b',
    '--line': '#2a3040', '--line2': '#3a4256',
    '--txt-hi': '#eef2fa', '--txt': '#e2e8f4', '--body': '#c6cfe0',
    '--muted': '#8e99b0', '--dim': '#626c82',
    '--accent': '#4fa8ff', '--accent-dim': '#2c5f96', '--accent-soft': '#9cc8ff',
    '--on-accent': '#00101f',
    '--ok': '#4fd08c', '--warn': '#f0c674', '--bad': '#ff6b7a', '--focus': '#4fa8ff',
  },
  FUCKUP: {
    '--bg0': '#14100c', '--bg': '#171310', '--bg2': '#201a14',
    '--panel': '#281f17', '--panel2': '#32271c', '--field': '#171210',
    '--header': '#0d0a07',
    '--line': '#40342a', '--line2': '#55443a',
    '--txt-hi': '#f5ecd9', '--txt': '#eee3cf', '--body': '#d9c9ae',
    '--muted': '#a8977d', '--dim': '#776855',
    '--accent': '#e0762e', '--accent-dim': '#8a4a1e', '--accent-soft': '#e8b04b',
    '--on-accent': '#1a0d04',
    '--ok': '#7a9a3d', '--warn': '#e8b04b', '--bad': '#c3402f', '--focus': '#e0762e',
  },
}

export const DEFAULT_THEME = 'DECK'

export function applyTheme(name: string): void {
  const map = PRESET_THEMES[name] ?? PRESET_THEMES[DEFAULT_THEME]
  const root = document.documentElement
  for (const v of THEME_VARS) {
    const val = map[v]
    if (val) root.style.setProperty(v, val)
    else root.style.removeProperty(v)
  }
}
