const notice = document.querySelector('#auth-notice');
let noticeTimer;
function notify(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = !message;
  if (message) noticeTimer = setTimeout(() => { notice.hidden = true; notice.textContent = ''; }, 12000);
}

if (window.TasksApp.demo) {
  document.querySelector('#lock-screen').hidden = true;
  document.querySelector('#setup-screen').hidden = true;
  document.body.classList.remove('auth-blocked');
  document.querySelector('#app').inert = false;
  document.querySelector('#demo-settings').hidden = false;
  for (const id of ['#security-section', '#connection-section', '#advanced-connection']) document.querySelector(id).hidden = true;
  const settings = document.querySelector('#settings-dialog');
  document.addEventListener('click', event => {
    if (event.target.closest('[data-tasks-settings]') && !settings.open) settings.showModal();
  });
  document.querySelector('#settings-close').addEventListener('click', () => settings.close());
  await window.TasksApp.startDemo();
} else {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try {
    // Migrate legacy plaintext task caches before any authentication or board work.
    await window.TasksApp.prepare();
    const { VaultAccess } = await import('./auth.js');
    const access = new VaultAccess({
      connect: payload => window.TasksApp.start(payload),
      disconnect: () => window.TasksApp.lock(),
      notify,
    });
    await access.start();
  } catch {
    document.querySelector('#unlock-error').textContent = 'Local task storage could not be secured. Keep this browser profile and its data; free storage or enable IndexedDB, then reload. The board has not connected.';
  }
}
