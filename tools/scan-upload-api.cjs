/**
 * 扫描 NAS LuCI 的文件写入/上传相关 action，并测试 WebDAV 头组合。
 * 只做只读探测与最小化测试，测试产物会立即清理。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const certDir = path.join(process.env.LOCALAPPDATA || '', 'minasCert');
const files = fs.readdirSync(certDir);
const certFile = files.find((f) => f.endsWith('_cert.pem'));
const cert = fs.readFileSync(path.join(certDir, certFile));
const key = fs.readFileSync(path.join(certDir, files.find((f) => f.endsWith('_private_key.pem'))));
const ca = fs.readFileSync(path.join(certDir, files.find((f) => f.startsWith('ca_chain'))));
const DID = certFile.match(/\d+_(\d+)_cert\.pem/)[1];

const URLPORT = 51831;
const WEBDAVPORT = 51832;
const TESTDIR = '/home/u2912935973/pool0/data/test';
const PROBE = '_gwscan.txt';
const PROBEPATH = `${TESTDIR}/${PROBE}`;

function request(port, method, p, headers, body) {
  return new Promise((resolve) => {
    const h = Object.assign({}, headers || {});
    if (body !== undefined) h['Content-Length'] = Buffer.byteLength(body);
    const r = https.request(
      { host: '127.0.0.1', port, path: p, method, rejectUnauthorized: false, cert, key, ca, headers: h, timeout: 8000 },
      (resp) => {
        const chunks = [];
        resp.on('data', (d) => chunks.push(d));
        resp.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: resp.statusCode, headers: resp.headers, body: buf.toString('utf8').substring(0, 200), len: buf.length });
        });
      }
    );
    r.on('error', (e) => resolve({ error: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ error: 'timeout' }); });
    if (body !== undefined) r.write(body);
    r.end();
  });
}

async function getToken() {
  const t = await request(URLPORT, 'POST', '/cgi-bin/luci/plugincenter/get_access_token', { 'Content-Type': 'application/json' }, '{}');
  return JSON.parse(t.body).data.token;
}

(async () => {
  const token = await getToken();
  const auth = { 'Cookie': 'token=' + token, 'Authorization': token };
  const jsonAuth = Object.assign({ 'Content-Type': 'application/json' }, auth);
  console.log('Token acquired:', !!token);

  // ---------- 1. WebDAV header matrix ----------
  console.log('\n=== 1. WebDAV PROPFIND header matrix (port ' + WEBDAVPORT + ') ===');
  const b64 = (s) => 'Basic ' + Buffer.from(s).toString('base64');
  const davVariants = [
    ['token header literal', { token: token }],
    ['Authorization token', { Authorization: token }],
    ['Cookie token', { Cookie: 'token=' + token }],
    ['all three', { token: token, Authorization: token, Cookie: 'token=' + token }],
    ['basic ' + DID, { Authorization: b64(DID + ':' + DID) }],
    ['X-Token', { 'X-Token': token }],
    ['UA + token hdr', { 'User-Agent': 'Mozilla/5.0', token: token }],
  ];
  for (const [name, h] of davVariants) {
    const r = await request(WEBDAVPORT, 'PROPFIND', '/', Object.assign({ Depth: '0', 'Content-Type': 'application/xml' }, h));
    const tag = r.status === 207 || r.status === 200 ? '  OK ' : '  -- ';
    console.log(tag + name.padEnd(24) + '-> ' + (r.status || r.error));
  }

  // ---------- 2. LuCI action brute force ----------
  console.log('\n=== 2. LuCI filemgr action scan ===');
  const actions = [
    'upload_file', 'upload', 'put_file', 'save_file', 'write_file', 'file_write',
    'create_file', 'new_file', 'add_file', 'file_put', 'put', 'write', 'save',
    'upload_start', 'upload_begin', 'upload_init', 'upload_create', 'upload_prepare',
    'upload_chunk', 'upload_part', 'upload_finish', 'upload_complete', 'upload_end',
    'upload_cancel', 'upload_abort', 'upload_status', 'upload_progress',
    'receive_file', 'recv', 'receive', 'receive_start',
    'transmit_start', 'transmit_create', 'start_transmit', 'transfer_start',
    'decompress', 'extract', 'unzip', 'untar', 'decompress_task',
    'rename_file', 'rename', 'move_file', 'copy_file', 'delete_file', 'del', 'trash',
    'share', 'share_file', 'create_share', 'get_share', 'set_share',
    'favorite', 'set_favorite', 'get_favorite',
    'mkdir_p', 'create_dir_recursive', 'dir_create',
    'get_dir_size', 'get_file_info', 'get_info', 'stat', 'size',
    'hash', 'checksum', 'get_hash', 'index', 'rebuild_index', 'scan',
    'task_list', 'get_task', 'task_status', 'cancel_task', 'task_cancel',
  ];
  const live = [];
  for (const a of actions) {
    const r = await request(URLPORT, 'POST', '/cgi-bin/luci/filemgr/' + a, jsonAuth, '{}');
    const s = r.status || r.error;
    if (s !== 403 && s !== 404) {
      live.push(a);
      console.log('  LIVE  filemgr/' + a.padEnd(26) + '-> ' + s + '  ' + (r.body || '').substring(0, 70));
    }
  }
  if (!live.length) console.log('  (none beyond already-known)');

  // ---------- 3. other modules ----------
  console.log('\n=== 3. Other module scan (/<module>/search) ===');
  const mods = ['transmit', 'transfer', 'upload', 'download', 'task', 'taskcenter',
    'filetransfer', 'filetask', 'nasfile', 'fileops', 'filestation', 'file',
    'share', 'recycle', 'usermanager', 'home', 'system', 'storage', 'disk'];
  const liveMods = [];
  for (const m of mods) {
    const r = await request(URLPORT, 'POST', '/cgi-bin/luci/' + m + '/search', jsonAuth, '{}');
    const s = r.status || r.error;
    if (s !== 403 && s !== 404) {
      liveMods.push(m);
      console.log('  LIVE  ' + m.padEnd(16) + '-> ' + s + '  ' + (r.body || '').substring(0, 70));
    }
  }
  if (!liveMods.length) console.log('  (no new modules)');

  // ---------- 4. get_file write probes ----------
  console.log('\n=== 4. get_file as write target ===');
  const gf = [
    ['POST json path+content', 'POST', Object.assign({ 'Content-Type': 'application/json' }, auth), JSON.stringify({ path: PROBEPATH, content: Buffer.from('scan').toString('base64') })],
    ['POST json path+text', 'POST', Object.assign({ 'Content-Type': 'application/json' }, auth), JSON.stringify({ path: PROBEPATH, data: 'scan' })],
    ['PUT json', 'PUT', Object.assign({ 'Content-Type': 'application/json' }, auth), JSON.stringify({ path: PROBEPATH, content: 'scan' })],
  ];
  for (const [name, m, h, b] of gf) {
    const r = await request(URLPORT, m, '/cgi-bin/luci/filemgr/get_file', h, b);
    console.log('  ' + name.padEnd(24) + '-> ' + (r.status || r.error) + '  ' + (r.body || '').substring(0, 70));
  }

  // ---------- 5. verify ----------
  console.log('\n=== 5. verify probe artifacts in ' + TESTDIR + ' ===');
  const s = await request(URLPORT, 'POST', '/cgi-bin/luci/filemgr/search', jsonAuth, JSON.stringify({
    type: 'all', page: { size: 500, token: '' },
    options: { option: ['path'], path: { parent: TESTDIR, recursion: false } },
    show_dotfile: false,
  }));
  const list = (JSON.parse(s.body).data.files || []).filter((f) => f.name.includes('_gw'));
  console.log('  matches:', JSON.stringify(list.map((f) => f.name)));
  for (const f of list) {
    const del = await request(URLPORT, 'POST', '/cgi-bin/luci/filemgr/remove', jsonAuth, JSON.stringify({ path: `${TESTDIR}/${f.name}` }));
    console.log('  cleaned ' + f.name + ' -> ' + (del.body || '').substring(0, 50));
  }
  console.log('\nDone.');
})();
