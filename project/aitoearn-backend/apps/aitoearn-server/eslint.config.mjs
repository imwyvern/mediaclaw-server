import baseConfig from '../../eslint.config.mjs'

export default baseConfig.append(
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
    ],
    rules: {
      'jsdoc/check-param-names': 'off',
      'ts/no-explicit-any': 'off',
    },
  },
  {
    files: [
      '**/core/mediaclaw/**/*.service.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
)
