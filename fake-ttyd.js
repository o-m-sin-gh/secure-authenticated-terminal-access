const http=require('http'),crypto=require('crypto');
const s=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/plain'});r.end('TTYD PAGE cookie='+(q.headers.cookie||'none')+'\n')});
s.on('upgrade',(q,sock)=>{const k=crypto.createHash('sha1').update(q.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+k+'\r\n\r\n');sock.on('data',()=>{});sock.on('error',()=>{})});
s.listen(7681,'127.0.0.1');