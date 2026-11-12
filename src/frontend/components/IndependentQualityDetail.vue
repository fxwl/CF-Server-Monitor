<template>
  <div v-if="part==='top' && ip" class="iq-top">
    <section class="iq-panel">
      <header><b>IP 基础属性</b><small>{{ date(ip.created_at) }}</small></header>
      <div class="iq-facts">
        <div v-for="[name,val] in ipFacts" :key="name" class="iq-pair"><span>{{ name }}</span><strong>{{ val }}</strong></div>
      </div>
    </section>
    <section class="iq-panel">
      <header><b>风险因子</b><small>{{ factorSources.length }} 个来源</small></header>
      <div class="iq-scroll"><table class="iq-table iq-factor">
        <thead><tr><th>机构</th><th>代理</th><th>Tor</th><th>VPN</th><th>服务器</th><th>滥用</th><th>机器人</th></tr></thead>
        <tbody><tr v-for="name in factorSources" :key="name">
          <th>{{ displayProvider(name) }}</th>
          <td v-for="key in factorNames" :key="key" :data-label="factorLabel[key]" :class="riskFactor(key,name)===true?'iq-fail':riskFactor(key,name)===false?'iq-pass':''">{{ yesNo(riskFactor(key,name)) }}</td>
        </tr></tbody>
      </table></div>
    </section>
  </div>
  <div v-else-if="part==='bottom' && (ip || net)" class="iq-bottom">
    <section v-if="ip" class="iq-panel">
      <header><b>IP 风险评分历史</b><small>{{ date(ip.created_at) }}</small></header>
      <div class="iq-trend-layout">
        <div class="iq-plot">
          <div class="iq-plot-top">{{ displayProvider(selected) }}</div>
          <svg viewBox="0 0 500 150" preserveAspectRatio="none" role="img" aria-label="单机构风险评分历史趋势">
            <path v-for="y in [0,50,100]" :key="y" :d="'M0 '+(140-y*1.3)+' H500'" stroke="var(--border-color)" stroke-width="1" fill="none"/>
            <polyline v-if="plotPoints.length>1" :points="plotPoints.map(p=>p.x+','+p.y).join(' ')" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linejoin="round"/>
            <circle v-for="(p,i) in plotPoints" :key="i" :cx="p.x" :cy="p.y" r="3.5" fill="var(--accent-blue)"/>
          </svg>
          <span v-if="!plotPoints.length" class="iq-nodata">—</span>
        </div>
        <div class="iq-latest">
          <b>最新一次评分</b>
          <button v-for="[name,val] in scores" :key="name" type="button" :class="{active:selected===name}" @click="selected=name">
            <span>{{ displayProvider(name) }}</span><strong>{{ value(val) }}</strong>
          </button>
        </div>
      </div>
    </section>
    <section v-if="ip" class="iq-panel">
      <header><b>IPQuality</b><small>{{ date(ip.created_at) }}</small></header>
      <div class="iq-scroll"><table class="iq-table iq-provider-table"><thead><tr><th>检测机构</th><th>用途</th><th>公司</th><th>风险评分</th></tr></thead>
        <tbody><tr v-for="row in ipProviders" :key="row.name"><td>{{ displayProvider(row.name) }}</td><td>{{ value(row.usage) }}</td><td>{{ value(row.company) }}</td><td>{{ value(row.score) }}</td></tr></tbody>
      </table></div>
      <p v-if="isChinaSource" class="iq-network-note">当前节点为中国大陆出口；海外 IP 数据源、流媒体和 AI 服务可能因跨境网络不可达而缺项或显示失败，不等同于服务本身不支持。数据保留上游检测原值。</p>
      <h3>全部流媒体 / AI 解锁</h3>
      <div class="iq-fluid">
        <div v-for="[name,m] in media" :key="name" class="iq-chip">
          <b>{{ mediaName(name) }}</b><span :class="mediaClass(m?.Status)">{{ value(m?.Status) }}</span>
          <span>{{ value(m?.Region) }}<template v-if="m?.Type"> · {{ value(m.Type) }}</template></span>
        </div>
      </div>
      <h3>邮件服务 / DNS 黑名单检测</h3>
      <div class="iq-fluid">
        <div v-for="[name,v] in mailItems" :key="name" class="iq-chip"><b>{{ name }}</b><span :class="v===true?'iq-pass':v===false?'iq-fail':''">{{ yesNo(v) }}</span></div>
      </div>
      <div v-if="mailDns" class="iq-fluid">
        <div v-for="[k,v] in Object.entries(mailDns)" :key="k" class="iq-chip"><b>{{ dnsName(k) }}</b><strong>{{ value(v) }}</strong></div>
      </div>
    </section>
    <section v-if="net" class="iq-panel">
      <header><b>NetQuality</b><small>{{ date(net.created_at) }}</small></header>
      <div class="iq-net-pair">
        <div class="iq-inner"><h3>BGP 信息</h3><div class="iq-facts"><div v-for="[k,v] in bgp" :key="k" class="iq-pair"><span>{{ bgpName(k) }}</span><strong>{{ value(v) }}</strong></div></div></div>
        <div class="iq-inner"><h3>本地网络</h3><div class="iq-facts"><div v-for="[k,v] in local" :key="k" class="iq-pair"><span>{{ localName(k) }}</span><strong>{{ value(v) }}</strong></div></div></div>
      </div>
      <h3>运营商连接</h3>
      <div class="iq-fluid">
        <div v-for="(c,i) in connections" :key="i" class="iq-chip iq-connection">
          <b>AS{{ c.ASN || '—' }}</b><span>{{ value(c.Org) }}</span><small>{{ c.IsTarget?'本机':c.IsUpstream?'上游':c.IsTier1?'Tier 1':'互联' }}</small>
        </div>
      </div>
      <h3>回程路由</h3>
      <div class="iq-routes">
        <details v-for="(r,i) in routeCards" :key="i" class="iq-route">
          <summary><span>{{ r.city }} · {{ r.carrier }}</span><span>{{ r.text?'查看逐跳':'—' }}</span></summary>
          <pre v-if="r.text">{{ r.text }}</pre>
        </details>
      </div>
      <div v-if="net.route_text && !routeCards.some(r=>r.text)" class="iq-route-raw"><pre>{{ net.route_text }}</pre></div>
      <template v-if="provinceLatency.length">
        <h3>省级三网延迟</h3>
        <div class="iq-fluid"><div v-for="(p,i) in provinceLatency" :key="i" class="iq-chip"><b>{{ p.province }} · {{ p.carrier }}</b><strong>{{ p.ms }} ms</strong></div></div>
      </template>
      <template v-if="speedTests.length">
        <h3>国内测速</h3>
        <div class="iq-fluid"><div v-for="(p,i) in speedTests" :key="i" class="iq-chip"><b>{{ p.key }}</b><span>{{ p.value }}</span></div></div>
      </template>
      <template v-if="transfers.length">
        <h3>国际互联</h3>
        <div class="iq-fluid"><div v-for="(p,i) in transfers" :key="i" class="iq-chip"><b>{{ p.key }}</b><span>{{ p.value }}</span></div></div>
      </template>
    </section>
  </div>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
const props=defineProps({part:{type:String,required:true},data:{type:Object,default:null}})
const ip=computed(()=>props.data?.ip||null)
const net=computed(()=>props.data?.net||null)
const isChinaSource=computed(()=>ip.value?.source_country==='CN'||net.value?.source_country==='CN')
const ir=computed(()=>ip.value?.report||{})
const nr=computed(()=>net.value?.report||{})
const value=x=>x===null||x===undefined||x===''||x==='null'?'—':String(x)
const yesNo=x=>x===true?'是':x===false?'否':'—'
const date=x=>x?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const displayProvider=x=>({SCAMALYTICS:'Scamalytics',DBIP:'DB-IP',IPQS:'IPQS'}[x]||x)
const factorNames=['Proxy','Tor','VPN','Server','Abuser','Robot']
const factorLabel={Proxy:'代理',Tor:'Tor',VPN:'VPN',Server:'服务器',Abuser:'滥用',Robot:'机器人'}
const factorSources=computed(()=>[...new Set(Object.values(ir.value.Factor||{}).flatMap(x=>Object.keys(x||{})))])
const riskFactor=(key,name)=>ir.value.Factor?.[key]?.[name]
const ipFacts=computed(()=>{
 const v=ir.value.Info||{},city=v.City||{},r=v.Region||{},rr=v.RegisteredRegion||{}
 return [['出口 IP',ir.value.Head?.IP],['ASN',v.ASN],['机构',v.Organization],['国家/地区',r.Name],['城市',city.Name],['注册地',rr.Name],['IP 类型',v.Type],['时区',v.TimeZone]].map(([k,x])=>[k,value(x)])
})
const scores=computed(()=>Object.entries(ir.value.Score||{}))
const selected=ref('')
watch(scores,list=>{if(!list.some(([name])=>name===selected.value))selected.value=list[0]?.[0]||''},{immediate:true})
const history=computed(()=>[...(props.data?.history||[])].reverse())
const numScore=v=>{
 if(v===null||v===undefined||v==='null'||v==='')return null
 const n=Number.parseFloat(String(v).replace(',','.').replace('%',''))
 return Number.isFinite(n)&&n>=0&&n<=100?n:null
}
const plotPoints=computed(()=>{
 const p=history.value.map(x=>({at:x.at,n:numScore(x.scores?.[selected.value])})).filter(x=>x.n!==null)
 if(!p.length)return []
 const lo=p[0].at,hi=p[p.length-1].at
 return p.map((v,i)=>({x:hi===lo?250:10+(v.at-lo)/(hi-lo)*480,y:140-v.n*1.3}))
})
const ipProviders=computed(()=>{
 const u=ir.value.Type?.Usage||{},c=ir.value.Type?.Company||{},s=ir.value.Score||{}
 return [...new Set([...Object.keys(u),...Object.keys(c),...Object.keys(s)])].map(name=>({name,usage:u[name],company:c[name],score:s[name]}))
})
const media=computed(()=>Object.entries(ir.value.Media||{}))
const mediaName=x=>({DisneyPlus:'Disney+',Youtube:'YouTube',AmazonPrimeVideo:'Prime Video'}[x]||x)
const mediaClass=x=>String(x).includes('解锁')?'iq-pass':String(x).includes('屏蔽')||String(x).includes('失败')?'iq-fail':''
const mailItems=computed(()=>Object.entries(ir.value.Mail||{}).filter(([name])=>name!=='DNSBlacklist'))
const mailDns=computed(()=>ir.value.Mail?.DNSBlacklist||null)
const dnsName=x=>({Total:'检测总数',Clean:'正常',Marked:'标记',Blacklisted:'黑名单'}[x]||x)
const bgp=computed(()=>Object.entries(nr.value.BGP||{}))
const local=computed(()=>Object.entries(nr.value.Local||{}))
const bgpName=x=>({ASN:'ASN',Organization:'机构',Prefix:'前缀长度',RIR:'注册机构',RegDate:'注册时间',ModDate:'修改时间',Country:'国家',SubRegion:'区域',Region:'大洲',IPinTotal:'IP 总数',IPActive:'活跃 IP',NeighborinTotal:'邻居总数',NeighborActive:'活跃邻居',IXCount:'IX 数量',UpstreamsCount:'上游数量',PeersCount:'对等数量',Address:'地址',GeoFeed:'GeoFeed'}[x]||x)
const localName=x=>({NAT:'NAT 类型',NATDescribe:'NAT 说明',Mapping:'映射',Filter:'过滤',Port:'端口',Hairpin:'回环',TCPCongestionControl:'TCP 拥塞控制',QueueDiscipline:'队列调度',TCPReceiveBuffer:'TCP 接收缓冲区',TCPSendBuffer:'TCP 发送缓冲区'}[x]||x)
const connections=computed(()=>Array.isArray(nr.value.Connectivity)?nr.value.Connectivity:[])
const provinceLatency=computed(()=>(Array.isArray(nr.value.Delay)?nr.value.Delay:[]).flatMap(r=>['CT','CU','CM'].map(carrier=>({province:r.Name||r.Code||'—',carrier,ms:r[carrier]?.Average}))).filter(r=>r.ms!==undefined&&r.ms!==null&&r.ms!==''&&r.ms!=='null'&&Number.isFinite(Number(r.ms))))
const relevantEntries=source=>(Array.isArray(source)?source:[]).flatMap((row,index)=>Object.entries(row&&typeof row==='object'?row:{}).filter(([,v])=>v!==null&&v!==''&&v!=='null').map(([key,v])=>({key:(index+1)+' · '+key,value:typeof v==='object'?JSON.stringify(v):String(v)})))
const speedTests=computed(()=>relevantEntries(nr.value.Speedtest))
const transfers=computed(()=>relevantEntries(nr.value.Transfer))
const routeCards=computed(()=>{
 const provided=Array.isArray(net.value?.routes)?net.value.routes:[]
 if(provided.length)return provided
 return ['北京','上海','广东'].flatMap(city=>['电信','联通','移动'].map(carrier=>({city,carrier,text:null})))
})
</script>

<style scoped>
.iq-network-note{font-size:12px;line-height:1.6;color:var(--text-secondary,#888);margin:8px 0 12px}
</style>
