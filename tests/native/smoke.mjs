// Native end-to-end smoke test: drives the packaged KOCPAD (real .exe, real
// WebView2, real disk) through tauri-driver's WebDriver endpoint.
//
// The test seeds the app profile with a workspace folder, opens the note from the
// tree, types into CodeMirror, waits for autosave and verifies the file on disk
// from Node. It is intentionally dependency-free: plain W3C WebDriver over fetch.
//
// Usage:
//   KOCPAD_APP=...\kocpad.exe KOCPAD_WORK=...\native-work node tests/native/smoke.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const app = process.env.KOCPAD_APP;
const work = process.env.KOCPAD_WORK;
const driverUrl = process.env.KOCPAD_DRIVER ?? 'http://127.0.0.1:4444';

if (!app || !work) {
  console.error('KOCPAD_APP and KOCPAD_WORK are required');
  process.exit(1);
}

const notePath = path.join(work, 'native-note.md');
const marker = `правка из нативного теста ${Date.now()}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(method, url, body) {
  const response = await fetch(`${driverUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Some endpoints (status) return plain text on older drivers.
  }
  return { status: response.status, body: parsed, text };
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { status } = await request('GET', '/status');
      if (status === 200) return;
    } catch {
      // Driver is still starting.
    }
    await sleep(1000);
  }
  throw new Error('tauri-driver did not start');
}

async function createSession() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { status, body } = await request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          'tauri:options': { application: app },
        },
      },
    });
    if (status === 200 && body?.value?.sessionId) return body.value.sessionId;
    await sleep(1000);
  }
  throw new Error('webdriver session was not created');
}

const session = async (pathSuffix, method = 'GET', body) => {
  const { status, body: payload } = await request(method, `/session/${sessionId}${pathSuffix}`, body);
  if (status >= 400) {
    throw new Error(`${method} ${pathSuffix} failed (${status}): ${JSON.stringify(payload)}`);
  }
  return payload?.value;
};

let sessionId = null;

async function findElement(selector) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const element = await session('/element', 'POST', { using: 'css selector', value: selector });
      const id = element?.['element-6066-11e4-a52e-4f735466cecf'];
      if (id) return id;
    } catch {
      // The UI is still booting.
    }
    await sleep(500);
  }
  throw new Error(`element not found: ${selector}`);
}

async function main() {
  await mkdir(work, { recursive: true });
  await writeFile(notePath, '# Нативная заметка\n\nТекст до правки.\n', 'utf8');
  await waitForDriver();
  sessionId = await createSession();

  // Point the app at the workspace and skip onboarding, then reboot the page.
  const escapedRoot = work.replace(/\\/g, '\\\\');
  await session('/execute/sync', 'POST', {
    script: `
      localStorage.setItem('kocpad.root', '${escapedRoot}');
      localStorage.setItem('kocpad.settings', JSON.stringify({ onboarded: true, schema: 2, theme: 'light' }));
      location.reload();
    `,
    args: [],
  }).catch(() => undefined); // reload can abort the response; the app still reloads
  await sleep(4000);

  const treeItem = await findElement('[role="treeitem"]');
  await session(`/element/${treeItem}/click`, 'POST', {});

  const editor = await findElement('.cm-content');
  await session(`/element/${editor}/click`, 'POST', {});
  await session(`/element/${editor}/value`, 'POST', {
    text: ` ${marker}`,
    value: [...` ${marker}`],
  });

  // Autosave is debounced (under a second by default); give it room.
  await sleep(4000);
  const disk = await readFile(notePath, 'utf8');
  if (!disk.includes(marker)) {
    throw new Error(`typed text did not reach the file on disk:\n${disk}`);
  }
  console.log(`native smoke passed: ${marker}`);
}

try {
  await main();
} finally {
  if (sessionId) {
    await request('DELETE', `/session/${sessionId}`).catch(() => undefined);
  }
}
