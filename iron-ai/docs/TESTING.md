# Testing

This repo uses Vitest for a lightweight, Vite-friendly test runner.

## Install

```bash
npm install
```

## Run tests

```bash
npm run test
```

## Run once (CI-style)

```bash
npm run test:run
```

## Notes

- Tests run in a Node environment with `fake-indexeddb` to exercise Dexie logic.
- Each test resets the IndexedDB database; no browser data is touched.
