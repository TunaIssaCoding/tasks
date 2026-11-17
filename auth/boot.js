import { VaultAccess } from './auth.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const notice = document.querySelector('#auth-notice');
let noticeTimer;
function notify(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = !message;
  if (message) noticeTimer = setTimeout(() => { notice.hidden = true; notice.textContent = ''; }, 12000);
}

try {
  // Migrate legacy plaintext task caches before any authentication or board work.
  await window.TasksApp.prepare();
  const access = new VaultAccess({
    connect: payload => window.TasksApp.start(payload),
    disconnect: () => window.TasksApp.lock(),
    notify,
  });
  await access.start();
} catch {
  document.querySelector('#unlock-error').textContent = 'Local task storage could not be secured. Keep this browser profile and its data; free storage or enable IndexedDB, then reload. The board has not connected.';
}
