/* Prueba rápida de un servidor:  node probar-server.js 34.0.56.25:14003 */
const { create } = require('./servers');
const { DatabaseSync } = require('node:sqlite');
const s = create(new DatabaseSync(':memory:'));
const r = s.save([{ name: 'Prueba', address: process.argv[2] || '' }]);
if (r.error) { console.log(r.error); process.exit(1); }
s.list().then((x) => { console.log(JSON.stringify(x.servers, null, 2)); process.exit(0); });
