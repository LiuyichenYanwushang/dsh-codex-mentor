import { readFile, writeFile } from 'node:fs/promises';
// The authored, tested lazy module needs a distinct package id from Host/preset entry sources.
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
await writeFile(new URL('../gui/client.js', import.meta.url), source.replaceAll('dsh-codex-mentor', 'dsh-codex-mentor-gui'));
