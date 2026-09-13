import { rmSync } from 'node:fs';

const generatedDirectories = ['../dist/', '../.vinext/', '../.next/'];

for (const relativePath of generatedDirectories) {
  rmSync(new URL(relativePath, import.meta.url), {
    force: true,
    recursive: true,
  });
}
