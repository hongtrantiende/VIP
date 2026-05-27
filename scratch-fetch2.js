const http = require('http');
const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/novels/8074b517-613c-429c-aacd-175b8b675ae9/read/1',
  method: 'GET',
}, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => console.log('STATUS:', res.statusCode));
});
req.on('error', e => console.error(e));
req.end();
