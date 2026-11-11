// Preserve the merged upstream ICMP/time-guard implementation and Durable Object.
import upstream,{MetricsBroadcaster as UpstreamMetricsBroadcaster} from './index.js';
import {loadSiteSettings} from './utils/settings.js';
import {checkAuth} from './middleware/auth.js';
import {handleNetworkAPI} from './netdiag/service.js';
import {handleStableApi} from './netdiag/stable-service.js';
export class MetricsBroadcaster extends UpstreamMetricsBroadcaster {}
const deps={loadSettings:loadSiteSettings,checkAuth};
const DOWNLOADS=new Set(['install.sh','collector.py','manifest.json']);
const WEB_ASSETS=new Set(['app.js','app.css','nav.css','home.js','home.css','nq-ui.js']);
const NQ_FILES=new Set(['install.sh','NodeQuality.sh','runner.py','manifest.json','AGPL-3.0-LICENSE','vendor/ip.sh','vendor/net.sh','vendor/hardware.sh']);
async function asset(request,env,file){
  if(!env.ASSETS)return new Response('Asset binding missing',{status:503});
  const response=await env.ASSETS.fetch(new Request(new URL(file==='index.html'?'/netdiag/':'/netdiag/'+file,request.url),{method:'GET'}));
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  if(file.endsWith('.sh')||file.endsWith('.py'))headers.set('Content-Type','text/plain; charset=utf-8');
  if(file==='index.html')headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  return new Response(response.body,{status:response.status,headers});
}
export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/netdiag/'))return await handleStableApi(request,env,ctx,deps)||handleNetworkAPI(request,env,ctx,deps);
    if(request.method==='GET'){
      if(path==='/netdiag'||path==='/netdiag/'||path==='/netdiag/index.html')return asset(request,env,'index.html');
      if(path.startsWith('/netdiag/releases/1.2.0/')){const file=path.slice('/netdiag/releases/1.2.0/'.length);return DOWNLOADS.has(file)?asset(request,env,'stable/'+file):new Response('Not found',{status:404});}
      if(path.startsWith('/netdiag/nq/')){const file=path.slice('/netdiag/nq/'.length);return NQ_FILES.has(file)?asset(request,env,'nq/'+file):new Response('Not found',{status:404});}
      if(path.startsWith('/netdiag/download/')){const file=path.slice('/netdiag/download/'.length);return DOWNLOADS.has(file)?asset(request,env,file):new Response('Not found',{status:404});}
      if(path.startsWith('/netdiag/assets/')){const file=path.slice('/netdiag/assets/'.length);return WEB_ASSETS.has(file)?asset(request,env,file):new Response('Not found',{status:404});}
    }
    const response=await upstream.fetch(request,env,ctx);
    if(request.method==='GET'&&response.status===200&&response.headers.get('Content-Type')?.includes('text/html')){
      const homepage=path==='/';
      const detailPage=/^\/(server|instance)\//.test(path);
      if(homepage||detailPage){
        const transformed=new HTMLRewriter().on('head',{element(e){e.append('<link rel="stylesheet" href="/netdiag/assets/home.css">',{html:true});}})
          .on('body',{element(e){e.append('<script type="module" src="/netdiag/assets/home.js"></script>',{html:true});}}).transform(response);
        const headers=new Headers(transformed.headers);headers.set('Cache-Control','private, no-store');
        return new Response(transformed.body,{status:transformed.status,headers});
      }
    }
    return response;
  },
  async scheduled(controller,env,ctx){
    // Keep the original resource and ICMP sampling. The old hourly external
    // risk-lookups were failing; complete NQ now runs locally once per week.
    await upstream.scheduled(controller,env,ctx);
  }
};
