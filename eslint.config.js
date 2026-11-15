import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'outputs/**', 'vault/**', '**/*.generated.js', '.claude/**', 'site/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // `const { a: _a, ...rest } = obj` drops a key on purpose (rest-omit); not an unused variable.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Geen klassen (zie docs/architecture.md): factories en tagged errors.
      'no-restricted-syntax': ['error', { selector: 'ClassDeclaration', message: 'No class: use a factory function (docs/architecture.md).' },
        { selector: 'ClassExpression', message: 'No class: use a factory function (docs/architecture.md).' }],
    },
  },
  // De portaal-UI draait in de browser (gebundeld met esbuild): browser-globals in plaats van Node.
  { files: ['web/portal/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  // Het gedeelde script van de mockups draait ook in de browser.
  { files: ['docs/mockups/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser } } },
];
