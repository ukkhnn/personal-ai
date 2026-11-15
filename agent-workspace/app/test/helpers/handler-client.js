import { Readable } from 'node:stream';

// Exercise the real app handler with two independently authenticated clients,
// without opening any socket. This is not a TCP/TLS or browser test.
export function handlerFetch(server) {
  const handler=server.listeners('request')[0];
  return async (address,options={}) => {
    const url=new URL(address),headers=new Headers(options.headers);
    headers.set('host',url.host);
    const req=Readable.from(options.body===undefined?[]:[Buffer.from(options.body)]);
    Object.assign(req,{method:options.method||'GET',url:url.pathname+url.search,
      headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1',localPort:Number(url.port)}});
    const responseHeaders=new Headers();let status=200;
    let finish;
    const response=new Promise(resolve=>{finish=resolve;});
    const res={headersSent:false,setHeader(name,value){responseHeaders.set(name,value);},
      writeHead(code,values){status=code;this.headersSent=true;for(const [name,value]of Object.entries(values||{}))this.setHeader(name,value);},
      end(body){finish(new Response(body??null,{status,headers:responseHeaders}));}};
    await handler(req,res);return response;
  };
}
