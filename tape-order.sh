#!/usr/bin/env bash
# Is the Unusual Whales daily tape file ordered by trade time? Counts and times only.
set -uo pipefail
KC="kubectl --kubeconfig ${KCFG} --request-timeout=60s"
T=$($KC -n selfagentbot get secret selfagentbot-credentials -o jsonpath='{.data.UNUSUAL_WHALES_API_TOKEN}' | base64 -d | tr -d '\r\n ')
U=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Authorization: Bearer $T" "https://api.unusualwhales.com/api/option-trades/full-tape/2026-11-12")
for R in "0-120000000" ; do
  curl -s -r $R "$U" -o /tmp/part.zip
  node -e '(function(){
  const fs=require("fs"),z=require("zlib");const b=fs.readFileSync("/tmp/part.zip");
  const nlen=b.readUInt16LE(26),xlen=b.readUInt16LE(28);const data=b.slice(30+nlen+xlen);
  let out;try{out=z.inflateRawSync(data,{finishFlush:z.constants.Z_SYNC_FLUSH})}catch(e){console.log("inflate "+e.message);return}
  const lines=out.toString("utf8").split("\n");const head=lines[0].split(",");const ie=head.indexOf("executed_at"),ic=head.indexOf("created_at"),iu=head.indexOf("underlying_symbol");
  let n=0,max=0,inv1=0,inv60=0,worst=0,first=null,last=null,cmax=0,cinv=0;const per={};
  for(let i=1;i<lines.length-1;i++){const f=lines[i].split(",");const t=Date.parse(f[ie].replace(" ","T").replace(/([+-]\d\d)$/,"$1:00"));if(isNaN(t))continue;n++;if(first===null)first=t;last=t;
    if(t<max-1000)inv1++;if(t<max-60000){inv60++;worst=Math.max(worst,max-t)}if(t>max)max=t;
    const c=Date.parse(f[ic].replace(" ","T").replace(/([+-]\d\d)$/,"$1:00"));if(c<cmax-1000)cinv++;if(c>cmax)cmax=c;
    const h=new Date(t).toISOString().slice(11,16);per[h.slice(0,4)+"0"]=(per[h.slice(0,4)+"0"]||0)+1}
  console.log("uncompressed MB "+(out.length/1e6).toFixed(0)+", rows "+n+", first "+new Date(first).toISOString()+", last "+new Date(last).toISOString());
  console.log("rows more than 1s behind the running max: "+inv1+"; more than 60s behind: "+inv60+"; worst lag s "+(worst/1000).toFixed(0)+"; created_at inversions >1s: "+cinv);
  console.log("rows per 10 min (UTC): "+Object.entries(per).slice(0,40).map(([k,v])=>k+"="+v).join(" "));
  })()'
done
echo "size: $(curl -s -I "$U" | grep -i '^content-length' | tr -d '\r')"
rm -f /tmp/part.zip
