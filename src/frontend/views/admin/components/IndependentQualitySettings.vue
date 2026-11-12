<template>
  <div v-if="activeTab==='quality'" class="iq-panel">
    <header><b>IPQuality / NetQuality 检测配置</b><small>独立采集</small></header>
    <div v-if="busy" class="iq-nodata">读取中…</div>
    <div v-else>
      <div class="iq-facts">
        <label class="iq-pair"><span>配置范围</span><select v-model="scope"><option value="global">全部服务器</option><option value="server">指定服务器</option></select></label>
        <label v-if="scope==='server'" class="iq-pair"><span>服务器</span><select v-model="serverId"><option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
        <label class="iq-pair"><span>启用检测</span><input v-model="config.enabled" type="checkbox"></label>
        <label class="iq-pair"><span>IPQuality 间隔（小时）</span><input v-model.number="config.ip_hours" type="number" min="1" max="720"></label>
        <label class="iq-pair"><span>NetQuality 间隔（小时）</span><input v-model.number="config.net_hours" type="number" min="1" max="720"></label>
      </div>
      <div class="iq-settings-actions"><button type="button" :disabled="saving" @click="save">保存配置</button>
        <button type="button" :disabled="saving||!serverId" @click="manual('ip')">立即执行 IPQuality</button>
        <button type="button" :disabled="saving||!serverId" @click="manual('net')">立即执行 NetQuality</button>
      </div>
      <div v-if="message" class="iq-settings-message">{{ message }}</div>
      <p class="iq-settings-tip">VPS 每 15 分钟检查执行任务，完成后自动上报。只安装独立检测侧车，不替换现有 cf-probe。</p>
      <div class="iq-settings-command"><code>curl -fsSL https://monitor.nnot.de/quality/install.sh -o /tmp/cfsm-quality-install.sh &amp;&amp; sudo bash /tmp/cfsm-quality-install.sh</code></div>
    </div>
  </div>
</template>
<script setup>
import { ref, watch, computed } from 'vue'
import { http } from '../../../utils/http.js'
const props=defineProps({activeTab:{type:String,required:true},servers:{type:Array,default:()=>[]},apiIndex:{type:Number,default:0}})
const busy=ref(false),saving=ref(false),message=ref(''),settings=ref({global:{enabled:true,ip_hours:168,net_hours:168},overrides:{}})
const scope=ref('global'),serverId=ref(''),config=ref({enabled:true,ip_hours:168,net_hours:168})
const effective=computed(()=>scope.value==='global'?settings.value.global:{...settings.value.global,...(settings.value.overrides[serverId.value]||{})})
watch([scope,serverId,effective],()=>{config.value={...effective.value}},{immediate:true})
watch(()=>props.servers,items=>{if(items.length&&!items.some(s=>s.id===serverId.value))serverId.value=items[0].id},{immediate:true})
async function load(){
 if(props.activeTab!=='quality')return
 busy.value=true;message.value=''
 try{
  const r=await http.getByIndex('/api/quality/settings',props.apiIndex,{autoRedirect:false})
  if(r?.data?.global)settings.value=r.data
  else message.value=r?.error||'无法读取检测配置'
 }catch(e){message.value=e.message}finally{busy.value=false}
}
watch(()=>props.activeTab,load,{immediate:true})
watch(()=>props.apiIndex,load)
async function save(){
 if(!Number.isInteger(config.value.ip_hours)||!Number.isInteger(config.value.net_hours)||config.value.ip_hours<1||config.value.net_hours<1||config.value.ip_hours>720||config.value.net_hours>720){message.value='间隔范围：1～720 小时';return}
 saving.value=true;message.value=''
 try{
  const payload={scope:scope.value,id:serverId.value,...config.value}
  const r=await http.postByIndex('/api/quality/settings',payload,props.apiIndex,{autoRedirect:false})
  if(r?.data?.saved){message.value='已保存';await load()}else message.value=r?.error||'保存失败'
 }catch(e){message.value=e.message}finally{saving.value=false}
}
async function manual(kind){
 if(!serverId.value)return
 saving.value=true;message.value=''
 try{
  const r=await http.postByIndex('/api/quality/request',{id:serverId.value,kind},props.apiIndex,{autoRedirect:false})
  message.value=r?.data?.requested?'执行请求已发送，等待 VPS 探针轮询':r?.error||'请求失败'
 }catch(e){message.value=e.message}finally{saving.value=false}
}
</script>
