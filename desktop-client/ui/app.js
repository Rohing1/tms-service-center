const $ = (id) => document.getElementById(id);
const invoke = window.__TAURI__?.core.invoke;
let busy = false;
let servers = [];
function message(text) { $('message').textContent = text; }
function render(settings) {
  servers = settings.servers;
  $('server-count').textContent = `${servers.length} 个`;
  $('servers').replaceChildren();
  if (!servers.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = '还没有保存的服务器，首次连接后会显示在这里。'; $('servers').append(empty);
  }
  for (const server of servers) {
    const row = document.createElement('div'); row.className = 'server';
    const open = document.createElement('button'); open.className = 'server-open'; open.type = 'button';
    const title = document.createElement('strong'); title.textContent = server.name;
    const address = document.createElement('small'); address.textContent = server.address;
    open.append(title, address); open.addEventListener('click', () => {
      if (busy) return;
      $('name').value = server.name; $('address').value = server.address; updateNotice(); connect();
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'server-remove'; remove.textContent = '移除';
    remove.setAttribute('aria-label', `移除 ${server.name}`);
    remove.addEventListener('click', async () => {
      if (busy || !window.confirm(`移除「${server.name}」的地址记录？服务器上的数据不会删除。`)) return;
      try { render(await invoke('remove_server', { address: server.address })); message(''); } catch (error) { message(String(error)); }
    });
    row.append(open, remove); $('servers').append(row);
  }
}
function updateNotice() { $('http-notice').hidden = !$('address').value.trim().startsWith('http://'); }
async function connect() {
  if (busy || !$('connect-form').reportValidity()) return;
  if (!invoke) { message('请在 TMS 桌面应用中连接服务器。'); return; }
  busy = true; $('connect').disabled = true; $('connect').firstElementChild.textContent = '正在检查连接…'; message('');
  const data = { name: $('name').value.trim(), address: $('address').value.trim() };
  try {
    // Save before opening so the server is still available after a temporary network failure.
    render(await invoke('save_server', data));
    await invoke('connect_server', data);
  } catch (error) { message(String(error)); }
  finally { busy = false; $('connect').disabled = false; $('connect').firstElementChild.textContent = '连接并打开面板'; }
}
$('connect-form').addEventListener('submit', (event) => { event.preventDefault(); connect(); });
$('address').addEventListener('input', updateNotice);
if (invoke) {
  invoke('get_settings').then((settings) => {
    render(settings);
    if (settings.servers[0]) { $('name').value = settings.servers[0].name; $('address').value = settings.servers[0].address; updateNotice(); }
  }).catch((error) => message(String(error)));
}
