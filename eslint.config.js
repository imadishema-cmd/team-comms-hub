import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores:['node_modules/**','.netlify/**'] },
  js.configs.recommended,
  {
    files:['**/*.js','**/*.mjs'],
    languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node}},
    rules:{'no-unused-vars':['warn',{argsIgnorePattern:'^_'}],'no-undef':'error','no-constant-binary-expression':'error'}
  }
];
