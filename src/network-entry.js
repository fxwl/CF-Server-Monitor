// Additive wrapper: upstream CPU/memory/network monitoring and DO behavior remain unchanged.
import upstream, {MetricsBroadcaster as UpstreamMetricsBroadcaster} from './index.js';
import {loadSiteSettings} from './utils/settings.js';
import {checkAuth} from './middleware/auth.js';
import {handleNetworkAPI,maintain} from './netdiag/service.js';
export class MetricsBroadcaster extends UpstreamMetricsBroadcaster {}
const deps={loadSettings:loadSiteSettings,checkAuth};
const DOWNLOADS=new Set(['install.sh','collector.py','manifest.json']);
const WEB_ASSETS=new Set(['app.js','app.css','nav.css','home.js','home.css']);
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
    if(path.startsWith('/api/netdiag/'))return handleNetworkAPI(request,env,ctx,deps);
    if(request.method==='GET'){
      if(path==='/netdiag'||path==='/netdiag/'||path==='/netdiag/index.html')return asset(request,env,'index.html');
      if(path.startsWith('/netdiag/download/')){const file=path.slice('/netdiag/download/'.length);return DOWNLOADS.has(file)?asset(request,env,file):new Response('Not found',{status:404});}
      if(path.startsWith('/netdiag/assets/')){const file=path.slice('/netdiag/assets/'.length);return WEB_ASSETS.has(file)?asset(request,env,file):new Response('Not found',{status:404});}
    }
    const response=await upstream.fetch(request,env,ctx);
    if(request.method==='GET'&&response.status===200&&response.headers.get('Content-Type')?.includes('text/html')&&['/','/admin','/admin/','/theme'].includes(path)){
      const homepage=path==='/';
      return new HTMLRewriter()
        .on('head',{element(e){
          if(homepage){
            e.append('<link rel="stylesheet" href="/netdiag/assets/home.css">',{html:true});
          }else{
            e.append('<link rel="stylesheet" href="/netdiag/assets/nav.css">',{html:true});
          }
        }})
        .on('body',{element(e){
          if(homepage){
            // AnotherLuminaPlus is a React app. Mount inside the existing node cards
            // after hydration, not as a separate banner or duplicate dashboard.
            e.append('<script type="module" src="/netdiag/assets/home.js"></script>',{html:true});
          }else{
            e.append('<a id="cfsm-netdiag-link" href="/netdiag">IP &#19982;&#32447;&#36335;</a>',{html:true});
          }
        }})
        .transform(response);
    }
    return response;
  },
  async scheduled(controller,env,ctx){
    await upstream.scheduled(controller,env,ctx);
    if(controller.cron==='0 * * * *')ctx.waitUntil(maintain(env,deps).catch(()=>console.warn(JSON.stringify({module:'netdiag',event:'maintenance_failed'}))));
  }
};
