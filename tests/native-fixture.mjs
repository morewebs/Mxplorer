// Run manually with node tests/native-fixture.mjs, then open http://localhost:17329 in Mxplorer.
import http from 'node:http';
http.createServer((req,res)=>{
  if(req.url==='/download'){res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="Mxplorer-smoke.txt"'});res.end('Mxplorer native download verification.\n');return;}
  if(req.url==='/redirect'){res.writeHead(302,{Location:'/second'});res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end(`<!doctype html><title>${req.url==='/second'?'Second page':'Mxplorer native check'}</title><style>body{font:17px Segoe UI;background:#f4f4f4;color:#222;max-width:700px;margin:60px auto}a{display:block;margin:20px 0}input{font:inherit;padding:10px;width:400px}</style><h1>${req.url==='/second'?'Second page':'Mxplorer native check'}</h1><p>Use these links to verify native navigation and downloads.</p><input aria-label="Focus test" placeholder="Type here after dismissing a menu"><a href="/second">Next page</a><a href="/redirect">Redirect to second page</a><a href="/download">Download test file</a><a href="https://example.com" target="_blank">Open external website in new tab</a><a href="#section">Same-page navigation</a><section id="section">Native find target: Mxplorer</section>`);
}).listen(17329,'127.0.0.1',()=>console.log('Native fixture: http://127.0.0.1:17329'));
