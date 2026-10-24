/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Per-file transpile, so the tests run without a freshly generated Prisma
  // client. Type errors are `tsc`'s job (pnpm build), not jest's.
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: {
          module: 'commonjs',
          target: 'es2022',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
