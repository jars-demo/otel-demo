import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts'] },
  {
    rules: {
      // Plain <a> is deliberate: the site is a static export with full page loads between
      // sections, and every link must work without JavaScript.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]

export default config
