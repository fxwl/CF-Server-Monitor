<template>
  <div v-if="quality" class="iq-compact">
    <div class="iq-section-title">IP 质量 <small>{{ stamp(quality.created_at) }}</small></div>
    <div class="iq-compact-grid">
      <div v-for="r in providers" :key="r.name" class="iq-compact-cell">
        <b>{{ r.name }}</b>
        <span>{{ fmt(r.usage) }} / {{ fmt(r.company) }}</span>
        <strong>{{ fmt(r.score) }}</strong>
      </div>
    </div>
    <div class="iq-compact-grid iq-compact-media">
      <div v-for="m in services" :key="m.key" class="iq-compact-cell">
        <b>{{ m.name }}</b>
        <span :class="mediaClass(m.status)">{{ fmt(m.status) }}</span>
        <span>{{ fmt(m.region) }}<template v-if="m.type"> · {{ m.type }}</template></span>
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
const props=defineProps({quality:{type:Object,default:null}})
const fmt=x=>x===undefined||x===null||x===''||x==='null'?'—':String(x)
const stamp=x=>x?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
const names=['IPinfo','ipregistry','ipapi','AbuseIPDB','IP2LOCATION','SCAMALYTICS','DBIP','IPQS']
const providers=computed(()=>names.map(name=>({name,usage:props.quality?.usage?.[name],company:props.quality?.company?.[name],score:props.quality?.scores?.[name]})).filter(x=>[x.usage,x.company,x.score].some(v=>v!==null&&v!==undefined)))
const mediaNames={DisneyPlus:'Disney+',Youtube:'YouTube',AmazonPrimeVideo:'Prime Video'}
const services=computed(()=>Object.entries(props.quality?.media||{}).map(([key,v])=>({key,name:mediaNames[key]||key,status:v?.Status,region:v?.Region,type:v?.Type})))
const mediaClass=x=>String(x).includes('解锁')?'iq-pass':String(x).includes('屏蔽')||String(x).includes('失败')?'iq-fail':''
</script>
