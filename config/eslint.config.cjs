const prettier = require('eslint-plugin-prettier');

const readonly = 'readonly';
const writable = 'writable';

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.cache/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'public/vendor/fontawesome/**',
      'public/js/utils.js',
      'worker/.wrangler/**',
      '**/.wrangler/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        afterAll: readonly,
        afterEach: readonly,
        beforeAll: readonly,
        beforeEach: readonly,
        Buffer: readonly,
        caches: readonly,
        clearInterval: readonly,
        clearTimeout: readonly,
        console: readonly,
        confirm: readonly,
        describe: readonly,
        document: readonly,
        expect: readonly,
        fetch: readonly,
        FileReader: readonly,
        global: writable,
        jest: readonly,
        localStorage: readonly,
        module: writable,
        navigator: readonly,
        process: readonly,
        Quill: readonly,
        require: readonly,
        Response: readonly,
        self: readonly,
        setInterval: readonly,
        setTimeout: readonly,
        test: readonly,
        URL: readonly,
        URLSearchParams: readonly,
        window: readonly,
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      'prettier/prettier': [
        'error',
        {
          semi: true,
          trailingComma: 'es5',
          singleQuote: true,
          printWidth: 100,
          tabWidth: 2,
        },
      ],
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
];
