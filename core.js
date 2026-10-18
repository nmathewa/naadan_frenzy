// Naadan Frenzy game engine: the farm's rules, with no drawing, sound or screen code.
// The same file runs in the browser (solo play, and drawing a multiplayer game) and on the
// multiplayer server. Sounds, messages and effects come out as events through hooks.event(e, toPlayer).
(function(root){
'use strict';
const W=420,H=640;
// ---------- world layout ----------
const FX=24, FY=134, CELL=31, COLS=12, ROWS=11, FW=COLS*CELL, FH=ROWS*CELL; // field 24..396, 134..475
const WS_BY=118, WS_KEYS=['bakery','oilmill','chips'];
// workshop row: 3 buildings (Region 1) or 4 narrower ones (Region 2)
const slotGeom=n=>n>3?{xs:[56,159,262,365],w:80}:{xs:[72,210,348],w:104};
const WH={x:72,by:594,w:118}, WELL={x:210,by:590}, PARK={x:352,y:592}, JETTY=151;
const TREE_SLOTS=[{x:FX+28,y:FY+72},{x:FX+FW-28,y:FY+72},{x:FX+28,y:FY+FH-12},{x:FX+FW-28,y:FY+FH-12},{x:FX+28,y:FY+200},{x:FX+FW-28,y:FY+200}];

// ---------- content ----------
const ITEMS={
  egg:{name:'Egg',price:15},
  duckegg:{name:'Duck egg',price:30},
  puffs:{name:'Egg puffs',price:50},
  coconut:{name:'Coconut',price:20},
  oil:{name:'Coconut oil',price:80},
  banana:{name:'Banana',price:20},
  chips:{name:'Banana chips',price:200},
  jackal:{name:'Caged jackal',price:100},
  boarcage:{name:'Caged wild boar',price:220},
  live_hen:{name:'Live hen',price:60},
  live_duck:{name:'Live duck',price:110},
  live_piglet:{name:'Young pig',price:70},
  live_pig:{name:'Grown pig',price:160},
  live_calf:{name:'Buffalo calf',price:110},
  live_buffalo:{name:'Grown buffalo',price:240},
  jackfruit:{name:'Jackfruit',price:40},
  jackchips:{name:'Jackfruit chips',price:260},
  tapioca:{name:'Tapioca',price:25},
  pork:{name:'Pork',price:110},
  beef:{name:'Beef',price:150},
  porkfry:{name:'Pork fry',price:320},
  kappabeef:{name:'Kappa & beef',price:450},
};
const MASS=new Set(['coconut oil','tapioca','pork','beef','pork fry','kappa & beef']); // no plural 's'
const BUY={
  hen:{name:'Hen',cost:100,kind:'animal'},
  duck:{name:'Duck',cost:250,kind:'animal'},
  palm:{name:'Coconut palm',short:'Palm',cost:300,kind:'tree'},
  banana:{name:'Banana plant',short:'Banana',cost:200,kind:'tree'},
  pig:{name:'Piglet',cost:150,kind:'animal'},
  buffalo:{name:'Buffalo calf',short:'Buffalo',cost:300,kind:'animal'},
  jack:{name:'Jackfruit tree',short:'Jackfruit',cost:350,kind:'tree'},
  kappa:{name:'Tapioca',cost:120,kind:'tree'},
  cracker:{name:'Firecracker',short:'Cracker',cost:200,kind:'action'},
};
const ANIM={
  hen:{name:'hen',hunger:26,prod:9,speed:24,starve:14,out:'egg'},
  duck:{name:'duck',hunger:22,prod:12,speed:21,starve:14,out:'duckegg'},
  // pigs and buffalo grow while fed; a grown one is sent to the meat shop
  pig:{name:'pig',hunger:24,grow:18,speed:18,starve:16,meat:'pork'},
  buffalo:{name:'buffalo',hunger:30,grow:26,speed:14,starve:18,meat:'beef'},
};
const ANIM_TYPES=['hen','duck','pig','buffalo'];
const TREE={palm:{out:'coconut',period:15},banana:{out:'banana',period:13},jack:{out:'jackfruit',period:20},kappa:{out:'tapioca',period:11}};
const TREE_TYPES=['palm','banana','jack','kappa'];
const WS={
  bakery:{name:'Bakery',sign:'BAKERY',cost:300,in:{egg:1},out:'puffs',time:6,wall:'#f4ecd8',pillar:'#3d6f8e'},
  oilmill:{name:'Oil mill',sign:'OIL MILL',cost:500,in:{coconut:1},out:'oil',time:8,wall:'#d08a5e',pillar:'#5b3a1f'},
  chips:{name:'Chips shop',sign:'CHIPS SHOP',cost:700,recipes:[{in:{banana:1,oil:1},out:'chips'},{in:{jackfruit:1,oil:1},out:'jackchips'}],time:9,wall:'#efdfa4',pillar:'#2f6b3a'},
  meat:{name:'Meat shop',sign:'MEAT SHOP',cost:600,animal:true,recipes:[],icon:'pork',time:7,wall:'#f3e1da',pillar:'#8a2f2a'},
  kada:{name:'Thattukada',sign:'THATTUKADA',cost:800,recipes:[{in:{tapioca:1,beef:1},out:'kappabeef'},{in:{pork:1,oil:1},out:'porkfry'}],time:10,wall:'#e8d2a0',pillar:'#2f5f8a'},
};
for(const k in WS){const d=WS[k]; if(!d.recipes) d.recipes=[{in:d.in,out:d.out}]; d.icon=d.icon||d.recipes[0].out;}
const UPG={
  well:{name:'Deeper well',cap:[5,8,11,14],refill:[3,2.4,1.8,1.2],desc:l=>`${UPG.well.cap[l]} buckets of water, refills in ${UPG.well.refill[l]}s`},
  store:{name:'Bigger storehouse',cap:[12,18,24,30],desc:l=>`Stores ${UPG.store.cap[l]} items`},
  auto:{name:'Bigger auto-rickshaw',cap:[6,10,14,20],trip:[12,10,8,6],names:['Auto-rickshaw','Auto with roof rack','Auto with trailer','Festival auto'],horns:['bulb horn','electric horn','two-tone horn','musical horn'],desc:l=>`${UPG.auto.names[l]}: carries ${UPG.auto.cap[l]}, round trip ${UPG.auto.trip[l]}s, ${UPG.auto.horns[l]}`},
  ws:{name:'Skilled workers',mult:[1,.85,.72,.6],desc:l=>l?`Workshops work ${Math.round((1-UPG.ws.mult[l])*100)}% faster`:'Workshops work at normal speed'},
};
const UPG_COST=[15,30,50];
const LEVELS=[
  {name:'First Light',start:150,animals:{hen:2},buy:['hen'],goals:{egg:8},gold:50,silver:90,
   tip:'Tap the bare soil to water it and grow grass. Hens eat the grass and lay eggs. Tap each egg to carry it to the storehouse before it spoils.'},
  {name:'Market Day',start:150,animals:{hen:2},buy:['hen'],goals:{egg:12,money:350},gold:100,silver:170,
   tip:'Tap the storehouse or the goods auto, load your eggs and send the auto to the market. The rupees come in when it reaches the market.'},
  {name:'Egg Puffs',start:400,animals:{hen:3},buy:['hen'],ws:['bakery'],goals:{puffs:5,money:500},gold:100,silver:170,
   tip:'Build the bakery, then tap it to bake an egg from the storehouse into egg puffs. Tap again while it bakes to queue more.'},
  {name:'Duck Season',start:450,animals:{hen:2},buy:['hen','duck'],ws:['bakery'],built:['bakery'],goals:{duckegg:6,puffs:5},gold:90,silver:150,jackal:{first:28,every:42},
   tip:'Kuttanad ducks lay duck eggs that sell for more. Watch for the jackal: tap it again and again to trap it, then tap the cage to keep it and sell it.'},
  {name:'Coconut Oil',start:800,animals:{hen:2,duck:1},buy:['hen','duck','palm'],ws:['bakery','oilmill'],built:['bakery'],goals:{oil:5,money:900},gold:130,silver:240,jackal:{first:40,every:50},
   tip:'Coconut palms drop coconuts without any grass. Build the oil mill to press coconuts into coconut oil.'},
  {name:'Monkey Business',start:600,animals:{hen:3,duck:1},trees:['palm'],buy:['hen','duck','palm'],ws:['bakery','oilmill'],built:['bakery','oilmill'],goals:{duckegg:10,oil:6,money:1400},gold:130,silver:260,jackal:{first:45,every:55},monkey:{first:20,every:34},
   tip:'Monkeys grab anything left lying on the ground. Tap a monkey a few times to chase it off, and it drops what it stole.'},
  {name:'Banana Chips',start:900,animals:{hen:2,duck:1},trees:['palm','palm'],buy:['hen','duck','palm','banana'],ws:['bakery','oilmill','chips'],built:['bakery','oilmill'],goals:{chips:4,money:2000},gold:165,silver:300,jackal:{first:40,every:50},monkey:{first:30,every:38},
   tip:'Plant banana trees. The chips shop fries a banana in coconut oil to make banana chips, the best seller at the market.'},
  {name:'Onam Rush',rush:true,start:1200,animals:{hen:2,duck:2},trees:['palm','banana'],buy:['hen','duck','palm','banana'],ws:['bakery','oilmill','chips'],built:['bakery','oilmill','chips'],goals:{chips:6,puffs:8,duckegg:10,money:3000},gold:210,silver:400,jackal:{first:30,every:40},monkey:{first:25,every:30},
   tip:'The whole village is shopping for the Onam feast. Keep every workshop busy and the auto on the road.'},
  // Region 2: Idukki high range. Four workshops in the top row.
  {region:2,name:'Jackfruit Season',start:900,animals:{hen:2},trees:['palm','jack'],buy:['hen','duck','palm','jack'],slots:['oilmill','chips','meat','kada'],ws:['oilmill','chips'],built:['oilmill'],goals:{jackchips:4,money:1200},gold:220,silver:360,jackal:{first:40,every:50},
   tip:'Jackfruit grows right on the trunk. Tap a tree to water it: a watered tree grows and fruits twice as fast for 20 seconds. The chips shop fries jackfruit in coconut oil.'},
  {region:2,name:'Kappa Fields',start:600,animals:{hen:2,duck:1},trees:['kappa','palm'],buy:['hen','duck','kappa','palm'],slots:['oilmill','chips','meat','kada'],ws:['oilmill','chips'],built:['oilmill','chips'],goals:{tapioca:12,money:1200},gold:200,silver:330,monkey:{first:30,every:40},
   tip:'Tapioca, the Kerala staple, grows fast. Water the plants to double the harvest, and keep the monkeys off it.'},
  {region:2,name:'Pig Farm',start:800,animals:{pig:2,hen:2},trees:['palm'],buy:['hen','pig','palm'],slots:['oilmill','chips','meat','kada'],ws:['oilmill','meat'],built:['oilmill'],goals:{pork:6,money:1400},gold:230,silver:380,jackal:{first:40,every:50},
   tip:'Piglets eat grass and grow up. When a pig shows a green tick, tap it to send it to the meat shop, which makes 3 portions of pork. Jackals leave pigs alone.'},
  {region:2,name:'Buffalo Country',start:1100,animals:{buffalo:1,pig:1,hen:1},trees:['kappa','palm'],buy:['hen','pig','buffalo','kappa'],slots:['oilmill','chips','meat','kada'],ws:['oilmill','meat','kada'],built:['oilmill','meat'],goals:{beef:6,kappabeef:4},gold:230,silver:380,monkey:{first:30,every:40},
   tip:'Buffalo calves grow slowly but give beef. Build the thattukada: it cooks tapioca with beef into kappa and beef, the best dish in Kerala.'},
  {region:2,name:'Thattukada Night',start:1200,animals:{pig:2,buffalo:1,hen:2},trees:['kappa','palm','palm'],buy:['hen','pig','buffalo','palm','kappa'],slots:['oilmill','chips','meat','kada'],ws:['oilmill','meat','kada'],built:['oilmill','meat','kada'],goals:{kappabeef:5,porkfry:5,money:2500},gold:330,silver:520,jackal:{first:35,every:45},monkey:{first:30,every:36},
   tip:'The thattukada also fries pork in coconut oil. Keep both dishes cooking for the night crowd.'},
  {region:2,name:'Highrange Feast',rush:true,start:1500,animals:{hen:2,duck:1,pig:2,buffalo:1},trees:['palm','palm','jack','kappa'],buy:['hen','pig','buffalo','palm','jack','kappa'],slots:['oilmill','chips','meat','kada'],ws:['oilmill','chips','meat','kada'],built:['oilmill','chips','meat','kada'],goals:{jackchips:5,kappabeef:5,porkfry:5,money:3500},gold:420,silver:660,jackal:{first:30,every:40},monkey:{first:25,every:30},
   tip:'The whole high range is coming to the feast. Run every kitchen at once.'},
  {region:2,name:'Ottakomban’s Night',night:true,rush:true,start:1500,animals:{hen:2,pig:2,buffalo:1},trees:['palm','palm','jack','kappa'],buy:['hen','pig','buffalo','palm','cracker'],slots:['oilmill','chips','meat','kada'],ws:['oilmill','chips','meat','kada'],built:['oilmill','chips','meat','kada'],goals:{kappabeef:5,porkfry:5,jackchips:4,money:3000},gold:420,silver:660,elephant:{first:25,every:45},jackal:{first:45,every:60},
   tip:'Ottakomban, the one-tusked wild elephant, raids the farm and smashes whatever it reaches. Tap it to drive it off. Tap at the same moment as your friend or Kuttan for team hits worth triple, or throw a firecracker.'},
];
const REGIONS={1:'Region 1 · Kuttanad backwaters',2:'Region 2 · Idukki high range'};
const regionOf=i=>LEVELS[i].region||1;

const rnd=(a,b)=>a+Math.random()*(b-a);
const dist=(a,b,c,d)=>Math.hypot(a-c,b-d);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const timeLimit=L=>Math.round(L.silver*(L.hard?1.5:2));
const EVENTS={
  hartal:{name:'Hartal',note:'market closed',dur:35,msg:'Hartal! The market is closed for a while, so the auto can’t go.'},
  monsoon:{name:'Monsoon',note:'free grass, goods spoil fast',dur:30,msg:'Monsoon! Grass grows by itself, but goods spoil twice as fast.'},
  powercut:{name:'Power cut',note:'workshops stopped',dur:18,msg:'Power cut! The workshops stop until it comes back.'},
  procession:{name:'Temple procession',note:'road blocked',dur:25,msg:'A temple procession is blocking the road. The auto has to wait.'},
  coconut:{name:'Coconut falling',note:'',dur:3,msg:'Look out! A coconut is falling.'},
};
const EVENT_KEYS=Object.keys(EVENTS);
const PEN={x:210,y:300,w:128,h:78};
const DUSK=5, DAWN=3, PHASES=['day','dusk','night','dawn'];
function liveItem(k,grown){return{hen:'live_hen',duck:'live_duck',pig:grown?'live_pig':'live_piglet',buffalo:grown?'live_buffalo':'live_calf'}[k];}
const LIVE_BACK={live_hen:['hen',0],live_duck:['duck',0],live_piglet:['pig',0],live_pig:['pig',1],live_calf:['buffalo',0],live_buffalo:['buffalo',1]};
const medalFor=(L,t)=>{t=Math.floor(t); return t<=L.gold?3:t<=L.silver?2:1;};
function plural(w,n){return n>1&&!w.endsWith('s')&&!MASS.has(w)?w+'s':w;}
const r1=v=>Math.round(v*10)/10;
const BOT_SKILL={relaxed:{name:'Relaxed',delay:1.3,speed:420},helpful:{name:'Helpful',delay:.8,speed:620},expert:{name:'Expert',delay:.4,speed:900}};
const AUTO_UP_COST=[0,400,900,1600], STORE_UP_COST=[0,300,700,1200];

// One engine per game: G holds the whole farm state; CUR is the player whose input is being handled.
function createEngine(hooks){
  hooks=hooks||{};
let G=null, UID=0, CUR=null;
const emit=(e,to)=>{if(hooks.event) hooks.event(e,to===undefined?null:to);};
// messages caused by a player's own action go only to that player (Kuttan's go to everyone)
const actorOnly=()=>CUR&&CUR.pid!=='kuttan'?CUR.pid:null;
function asPlayer(p,fn){const prev=CUR; CUR=p; try{return fn();}finally{CUR=prev;}}
function toast(msg){emit({toast:msg},actorOnly());}
function sfx(n){emit({s:n},n==='err'?actorOnly():null);}
function setMusic(m){emit({music:m},null);}
function fx(k,x,y,extra){emit({fx:[k,x,y,extra||null]},null);}
function floatText(text,x,y,color){emit({fl:[text,x,y,color||null]},null);}
const UP=()=>(G&&G.up)||{well:0,store:0,auto:0,ws:0};
const wellCap=()=>UPG.well.cap[UP().well], wellRefill=()=>UPG.well.refill[UP().well];
// the auto-rickshaw and storehouse can also be upgraded for one level from the market panel
const autoLvl=()=>Math.min(3,UP().auto+((G&&G.autoBoost)||0));
const storeLvl=()=>Math.min(3,UP().store+((G&&G.storeBoost)||0));
const storeCap=()=>UPG.store.cap[storeLvl()], autoCap=()=>UPG.auto.cap[autoLvl()];
const autoTrip=()=>UPG.auto.trip[autoLvl()], wsMult=()=>UPG.ws.mult[UP().ws];
function randField(m){m=m||14; return{x:FX+m+Math.random()*(FW-2*m),y:FY+m+Math.random()*(FH-2*m)}}
function cellCenter(i){return[FX+(i%COLS)*CELL+CELL/2,FY+((i/COLS)|0)*CELL+CELL/2]}

// Co-op challenge: playing with a friend or with Kuttan makes every level much harder
function hardLevel(L,li){
  const H=Object.assign({},L,{hard:true,goals:{}});
  for(const k in L.goals) H.goals[k]=k==='money'?Math.round(L.goals.money*1.8/50)*50:Math.ceil(L.goals[k]*1.8);
  H.gold=Math.round(L.gold*1.2); H.silver=Math.round(L.silver*1.25);
  H.jackal={first:Math.round((L.jackal?L.jackal.first:35)*.6),every:Math.round((L.jackal?L.jackal.every:40)*.5)};
  if(L.elephant) H.elephant={first:L.elephant.first,every:Math.round(L.elephant.every*.75)};
  if(L.monkey||li>=2) H.monkey={first:Math.round((L.monkey?L.monkey.first:30)*.6),every:Math.round((L.monkey?L.monkey.every:36)*.5)};
  return H;
}
function newGame(li,opts){
  opts=opts||{}; UID=0;
  const L=opts.hard?hardLevel(LEVELS[li],li):LEVELS[li];
  G={li,L,money:L.start,t:0,state:'intro',grass:new Float32Array(COLS*ROWS),gT:new Float32Array(COLS*ROWS),
    animals:[],trees:[],products:[],jackals:[],monkeys:[],elephants:[],cages:[],boats:[],fx:[],floats:[],nextE:L.elephant?L.elephant.first:Infinity,
    store:{},collected:{},ws:[],autoBoost:0,storeBoost:0,water:0,wellT:0,truck:{state:'home',t:0,cargo:{},sold:false},
    nextJ:L.jackal?L.jackal.first:Infinity,ev:null,evOn:li>=2&&L.events!==false,nextEv:(L.hard?30:50)*rnd(.9,1.3),nextM:L.monkey?L.monkey.first:Infinity,wonT:0};
  G.up=Object.assign({well:0,store:0,auto:0,ws:0},opts.up||{}); G.clock=0;
  G.hard=!!L.hard;
  G.boars=[]; G.tool='net'; G.shovel=false;
  G.water=wellCap();
  G.dn=(opts.nights!==false&&li>=2&&!L.night)?{phase:'day',t:0,next:L.hard?55:70,pen:100}:null;
  G.slots=L.slots||WS_KEYS; const sg=slotGeom(G.slots.length); G.wsX=sg.xs; G.wsW=sg.w;
  G.ws=G.slots.map(k=>L.ws&&L.ws.includes(k)?{type:k,built:!!(L.built&&L.built.includes(k)),busy:false,t:0,dur:1,queue:0,jobs:[],cur:null}:null);
  for(const k in (L.animals||{})) for(let i=0;i<L.animals[k];i++){const p=randField(30); addAnimal(k,p.x,p.y,false);}
  (L.trees||[]).forEach(k=>addTree(k,true));
  for(let n=0;n<2;n++){const c=2+Math.floor(Math.random()*8), r=2+Math.floor(Math.random()*7);
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const i=(r+dr)*COLS+c+dc; G.grass[i]=G.gT[i]=(dr===0||dc===0)?1:.65;}}
  G.bot=opts.bot?{on:true,skill:BOT_SKILL[opts.bot.skill]?opts.bot.skill:'helpful',x:WH.x+40,y:520,target:null,cool:1.5,intent:''}:null;
  return G;
}
function addAnimal(type,x,y,enter){
  const p=randField();
  G.animals.push({id:++UID,type,x,y,tx:enter?x:p.x,ty:enter?FY+FH-36:p.y,dir:Math.random()<.5?-1:1,food:.8+Math.random()*.2,prod:Math.random()*.5,
    starve:0,think:0,eating:false,cell:-1,wait:0,enter:!!enter,walk:Math.random()*5,mv:false,dead:false});
}
function addTree(k,instant){
  const used=G.trees.map(t=>t.slot); const slot=TREE_SLOTS.findIndex((_,i)=>!used.includes(i)); if(slot<0) return false;
  const s=TREE_SLOTS[slot];
  G.trees.push({type:k,slot,x:s.x,y:s.y,g:instant?1:0,t:Math.random()*TREE[k].period*.5,wet:0});
  if(!instant) fx('dust',s.x,s.y);
  return true;
}
const storeUsed=()=>Object.values(G.store).reduce((a,b)=>a+b,0);
const cargoUsed=()=>Object.values(G.truck.cargo).reduce((a,b)=>a+b,0);
const cargoValue=()=>Object.entries(G.truck.cargo).reduce((a,[k,n])=>a+n*ITEMS[k].price,0);

function dropProduct(type,x,y,life){
  if(G.hard) life*=.7;
  G.products.push({id:++UID,type,x:clamp(x,FX+8,FX+FW-8),y:clamp(y,FY+8,FY+FH-6),life,max:life,age:0});
}
function collect(p){
  if(storeUsed()>=storeCap()){toast('The storehouse is full. Load the auto and send goods to the market.'); sfx('err'); return;}
  G.products.splice(G.products.indexOf(p),1);
  G.store[p.type]=(G.store[p.type]||0)+1;
  G.collected[p.type]=(G.collected[p.type]||0)+1;
  fx('fly',p.x,p.y,{item:p.type,tx:WH.x,ty:WH.by-40});
  sfx('pop');
}

// ---------- update ----------
function update(dt){
  if(!G||G.state!=='play') return;
  G.clock+=dt;
  if(!isNight()) G.t+=dt;
  updNight(dt);
  if(G.bot&&G.bot.on) botTick(dt);
  for(let i=0;i<G.grass.length;i++) if(G.grass[i]<G.gT[i]) G.grass[i]=Math.min(G.gT[i],G.grass[i]+dt*2.2);
  if(G.wellT>0){G.wellT-=dt; if(G.wellT<=0){G.wellT=0; G.water=wellCap(); sfx('splash');}}
  G.animals.forEach(a=>updAnimal(a,dt));
  G.animals=G.animals.filter(a=>!a.dead);
  G.trees.forEach(tr=>{
    if(isNight()) return;
    const rate=tr.wet>0?2:1; tr.wet=Math.max(0,(tr.wet||0)-dt);
    if(tr.g<1){tr.g=Math.min(1,tr.g+dt/5*rate); return;}
    tr.t+=dt*rate; const per=TREE[tr.type].period;
    if(tr.t>=per){tr.t=0; dropProduct(TREE[tr.type].out,tr.x+rnd(-16,16),tr.y+rnd(4,12),18); sfx('thud');}
  });
  const spoil=evOn('monsoon')?2:1; G.products.forEach(p=>{p.age+=dt; p.life-=dt*spoil;});
  const np=G.products.length; G.products=G.products.filter(p=>p.life>0); if(G.products.length<np) sfx('spoil');
  G.ws.forEach((w,i)=>{
    if(w&&w.broken>0) w.broken=Math.max(0,w.broken-dt);
    if(!w||!w.busy||evOn('powercut')||w.broken>0) return; w.t+=dt;
    if(w.t>=w.dur){const j=w.cur||{out:WS[w.type].icon,n:1}; for(let k=0;k<j.n;k++) dropProduct(j.out,G.wsX[i]+rnd(-22,22),FY+6+k*5,25);
      fx('puff',G.wsX[i],WS_BY-10); sfx('ding');
      if(w.jobs.length){w.cur=w.jobs.shift(); w.t=0;} else{w.busy=false; w.cur=null;} w.queue=w.jobs.length;}
  });
  const T=G.truck;
  if(T.state==='going'){
    if(!evOn('procession')) T.t+=dt; const p=T.t/autoTrip();
    if(p>=.5&&!T.sold){T.sold=true; const v=cargoValue(); G.money+=v; T.cargo={}; toast(`Sold at the market for ₹${v.toLocaleString('en-IN')}.`); sfx('cash'); floatText('+₹'+v.toLocaleString('en-IN'),W/2,60,'#ffe39a');}
    if(p>=1){T.state='home'; T.t=0; T.sold=false; T.pt=0; sfx('arrive');}
  }
  G.boats.forEach(b=>{b.t+=dt; if(!b.spawned&&b.t/b.dur>=.4){b.spawned=true; addAnimal(b.cargo,JETTY,598,true); fx('dust',JETTY,598); sfx('splash');}});
  G.boats=G.boats.filter(b=>b.t<b.dur);
  // predators
  updEvents(dt);
  if(G.L.elephant){G.nextE-=dt; if(G.nextE<=0){G.nextE=G.L.elephant.every*rnd(.85,1.15); spawnElephant();}}
  G.elephants.forEach(e=>{if(e.stun>0) e.stun-=dt; else updElephant(e,dt);}); G.elephants=G.elephants.filter(e=>!e.gone);
  if(G.L.jackal&&!nightish()){G.nextJ-=dt; if(G.nextJ<=0){G.nextJ=G.L.jackal.every*rnd(.8,1.2); if(G.animals.some(a=>!a.enter&&!ANIM[a.type].meat)) spawnJackal();}}
  if(G.L.monkey&&!nightish()){G.nextM-=dt; if(G.nextM<=0){G.nextM=G.L.monkey.every*rnd(.8,1.2); spawnMonkey();}}
  G.jackals.forEach(j=>updJackal(j,dt)); G.jackals=G.jackals.filter(j=>!j.gone);
  G.boars.forEach(b=>updBoar(b,dt)); G.boars=G.boars.filter(b=>!b.gone);
  G.monkeys.forEach(m=>updMonkey(m,dt)); G.monkeys=G.monkeys.filter(m=>!m.gone);
  G.cages.forEach(c=>{c.t-=dt; if(c.t<=0){c.gone=true; if(c.kind==='boar'){G.boars.push({id:++UID,x:c.x,y:c.y,dir:1,taps:0,stun:0,state:'flee',t:0,walk:0,mv:false,gone:false}); toast('The wild boar broke out of its cage.'); return;} const j=makeJackal(c.x,c.y); j.state='flee'; G.jackals.push(j); toast('The jackal broke out of its cage.');}});
  G.cages=G.cages.filter(c=>!c.gone);
  if(!G.animals.length&&!G.boats.length&&!G.jackals.some(j=>j.carry)&&!G.ws.some(w=>w&&w.busy)&&!G.trees.length&&!G.products.length&&!G.cages.length&&!storeUsed()&&!cargoUsed()&&G.truck.state==='home'){
    const cheapest=Math.min(...G.L.buy.map(k=>BUY[k].cost));
    if(G.money<cheapest){
      if(G.lastLoss==='jackal') failLevel('A jackal ran off with your last bird and there’s no money for another. Tap jackals fast to make them let go.','eaten');
      else failLevel('No animals left and no money to buy more. Keep grass growing so your animals don’t starve.');
      return;}
  }
  if(goalsMet()){G.state='won'; G.wonT=0; emit({music:null},null); sfx('win'); return;}
  if(G.t>=timeLimit(G.L)) failLevel('Time’s up. Finish the goals before the countdown reaches zero.');
}
function moveTo(o,tx,ty,sp,dt){
  const dx=tx-o.x, dy=ty-o.y, d=Math.hypot(dx,dy);
  if(d<2){o.mv=false; return true;}
  const s=Math.min(d,sp*dt); o.x+=dx/d*s; o.y+=dy/d*s;
  if(Math.abs(dx)>.5) o.dir=dx>0?1:-1;
  o.mv=true; o.walk+=dt; return false;
}
function nearestGrass(x,y){
  let b=-1,bd=1e9;
  for(let i=0;i<G.grass.length;i++){if(G.grass[i]<.15) continue; const c=cellCenter(i), d=(c[0]-x)**2+(c[1]-y)**2; if(d<bd){bd=d;b=i;}}
  return b;
}
function updAnimal(a,dt){
  const st=ANIM[a.type]; a.mv=false;
  if(nightish()){penAnimal(a,dt); return;}
  a.food-=dt/st.hunger*(G.hard?1.3:1);
  if(a.food<=0){a.food=0; a.starve+=dt; if(!a.warned){a.warned=true; sfx('hungry');}
    if(a.starve>=st.starve){a.dead=true; G.lastLoss='starve'; fx('puff',a.x,a.y-6); toast(`A ${st.name} starved. Keep grass growing in the field.`); return;}}
  else{a.starve=0; if(a.food>.3) a.warned=false;}
  if(a.stun>0){a.stun-=dt; a.mv=false; return;}
  if(a.food>0&&st.out){a.prod+=dt/st.prod; if(a.prod>=1){a.prod=0; dropProduct(st.out,a.x-a.dir*6,a.y+4,15); sfx(a.type==='hen'?'cluck':'quack');}}
  if(a.food>0&&st.meat&&!a.ready){a.prod+=dt/st.grow; if(a.prod>=1){a.prod=1; a.ready=true; sfx('grow');
    if(!G.meatTold){G.meatTold=true; toast(`Your ${st.name} is grown. Tap it to send it to the meat shop.`);}}}
  if(a.enter){if(moveTo(a,a.tx,a.ty,st.speed*1.4,dt)) a.enter=false; return;}
  if(a.eating){
    const i=a.cell;
    if(G.grass[i]>.02&&a.food<1){G.grass[i]=Math.max(0,G.grass[i]-dt*.8); G.gT[i]=G.grass[i]; a.food=Math.min(1,a.food+dt*.55); a.walk+=dt*.3;}
    else a.eating=false;
    return;
  }
  a.think-=dt;
  if(a.food<.55){
    if(a.think<=0){a.think=.5; const c=nearestGrass(a.x,a.y); a.cell=c; if(c>=0){const p=cellCenter(c); a.tx=p[0]+rnd(-6,6); a.ty=p[1]+rnd(-6,6);}}
    if(a.cell>=0){if(moveTo(a,a.tx,a.ty,st.speed*1.25,dt)){a.eating=G.grass[a.cell]>.02; if(!a.eating) a.think=0;} return;}
  }
  if(a.wait>0){a.wait-=dt; return;}
  if(moveTo(a,a.tx,a.ty,st.speed,dt)){a.wait=rnd(.5,2.5); const p=randField(); a.tx=p.x; a.ty=p.y;}
}
function makeJackal(x,y){return{id:++UID,x,y,dir:1,taps:0,need:G.hard?8:5,stun:0,state:'hunt',target:null,carry:null,t:0,think:0,walk:0,mv:false,gone:false};}
function spawnJackal(quiet){
  const side=Math.random()<.5?-1:1, y=FY+40+Math.random()*(FH-80);
  const j=makeJackal(side<0?-24:W+24,y); j.dir=-side; G.jackals.push(j);
  if(!quiet) toast('A jackal is sneaking in. Tap it to trap it!');
}
function spawnMonkey(){
  const side=Math.random()<.5?-1:1, y=FY+30+Math.random()*(FH-60);
  G.monkeys.push({id:++UID,x:side<0?-20:W+20,y,dir:-side,taps:0,need:G.hard?5:3,stun:0,state:'seek',item:null,target:null,t:0,think:0,walk:0,mv:false,gone:false});
}
function fleeTo(o,sp,dt){const tx=o.x<W/2?-50:W+50; moveTo(o,tx,o.y,sp,dt); if(o.x<-40||o.x>W+40) o.gone=true;}
function updJackal(j,dt){
  j.mv=false; if(j.stun>0){j.stun-=dt; return;}
  j.t+=dt;
  if(j.state==='hunt'){
    j.think-=dt;
    if(j.think<=0||!j.target||j.target.dead){j.think=.5; let b=null,bd=1e9; for(const a of G.animals){if((a.enter&&!nightish())||a.dead||ANIM[a.type].meat||a.inPen) continue; const d=dist(a.x,a.y,j.x,j.y); if(d<bd){bd=d;b=a;}} j.target=b;}
    if(nightish()&&!j.target){ // everyone is in the pen: break in
      if(!G.animals.some(a=>a.inPen&&!ANIM[a.type].meat)){if(j.t>10) j.state='flee'; return;}
      const ex=clamp(j.x,PEN.x-PEN.w/2,PEN.x+PEN.w/2), ey=clamp(j.y,PEN.y-PEN.h/2,PEN.y+PEN.h/2);
      if(moveTo(j,ex,ey,G.hard?34:26,dt)&&isNight()){
        j.walk+=dt*.6; G.dn.pen=Math.max(0,G.dn.pen-dt*(G.hard?14:10));
        if(G.dn.pen<=0){const vs=G.animals.filter(a=>a.inPen&&!ANIM[a.type].meat&&!a.dead), v=vs[Math.floor(Math.random()*vs.length)];
          if(v){v.dead=true; j.carry=v.type; j.state='flee'; sfx('attack'); toast(`The pen broke! A jackal dragged out a ${ANIM[v.type].name}. Tap it fast!`);}}
      }
      return;
    }
    if(!j.target||j.t>(nightish()?40:24)){j.state='flee'; return;}
    moveTo(j,j.target.x,j.target.y,G.hard?34:26,dt);
    if(dist(j.x,j.y,j.target.x,j.target.y)<9){j.target.dead=true; j.carry=j.target.type; j.state='flee'; sfx('attack');
      toast(`The jackal grabbed a ${ANIM[j.carry].name}. Tap it fast to make it let go!`);}
  }else{fleeTo(j,j.carry?34:42,dt); if(j.gone&&j.carry){G.lastLoss='jackal'; if(G.nightStats&&nightish()&&!j.counted) G.nightStats.lost.push(j.carry);}}
}
function updMonkey(m,dt){
  m.mv=false; if(m.stun>0){m.stun-=dt; return;}
  m.t+=dt;
  if(m.state==='seek'){
    m.think-=dt;
    if(m.think<=0||!m.target||!G.products.includes(m.target)){m.think=.4; let b=null,bd=1e9; for(const p of G.products){const d=dist(p.x,p.y,m.x,m.y); if(d<bd){bd=d;b=p;}} m.target=b;}
    if(!m.target){if(m.t>14) m.state='leave'; else moveTo(m,W/2,FY+FH/2,30,dt); return;}
    moveTo(m,m.target.x,m.target.y,G.hard?52:42,dt);
    if(dist(m.x,m.y,m.target.x,m.target.y)<8){G.products.splice(G.products.indexOf(m.target),1); m.item=m.target.type; m.target=null; m.state='leave'; sfx('attack');}
  }else fleeTo(m,m.state==='scared'?85:50,dt);
}
function failLevel(reason,sound){G.state='failed'; G.failReason=reason; G.wonT=0; emit({music:null},null); sfx(sound||'fail');}
function goalsMet(){
  for(const [k,n] of Object.entries(G.L.goals)){if(k==='money'){if(G.money<n) return false;} else if((G.collected[k]||0)<n) return false;}
  return true;
}

const evOn=k=>!!(G&&G.ev&&G.ev.type===k);
function startEvent(k){
  G.ev={type:k,t:0,dur:EVENTS[k].dur};
  if(k==='coconut'){const p=randField(40); G.ev.x=p.x; G.ev.y=p.y;}
  toast(EVENTS[k].msg); sfx('ev_'+k);
}
function updEvents(dt){
  if(!G.evOn) return;
  if(G.ev){
    const e=G.ev; e.t+=dt;
    if(e.type==='monsoon'){e.acc=(e.acc||0)+dt; if(e.acc>.5){e.acc=0; for(let n=0;n<3;n++){const i=Math.floor(Math.random()*G.grass.length); G.gT[i]=Math.max(G.gT[i],.85);}}}
    if(e.type==='coconut'&&!e.hit&&e.t>=.8){e.hit=true; fx('dust',e.x,e.y); sfx('thud');
      G.animals.forEach(a=>{if(dist(a.x,a.y,e.x,e.y)<46) a.stun=3;}); dropProduct('coconut',e.x,e.y,15);}
    if(e.t>=e.dur){G.ev=null; G.nextEv=(G.hard?40:65)*rnd(.8,1.25);}
    return;
  }
  G.nextEv-=dt;
  if(nightish()) return;
  if(G.nextEv<=0){const pool=EVENT_KEYS.filter(k=>k!==G.lastEv&&k!=='powercut'); const k=pool[Math.floor(Math.random()*pool.length)]; G.lastEv=k; startEvent(k);}
}
function spawnElephant(){
  const side=Math.random()<.5?-1:1;
  G.elephants.push({id:++UID,x:side<0?-50:W+50,y:FY+60+Math.random()*(FH-120),dir:-side,pts:0,need:G.hard?16:12,state:'raid',t:0,walk:0,hits:{},target:null,flat:[]});
  toast('Ottakomban is raiding the farm! Tap it together to drive it off.'); sfx('elephant');
}
function elephantTarget(e){
  const trees=G.trees.filter(tr=>tr.g>.5&&!e.flat.includes(tr));
  if(trees.length&&Math.random()<.7){const tr=trees[Math.floor(Math.random()*trees.length)]; return{x:tr.x,y:tr.y,tree:tr};}
  const ws=G.ws.map((w,i)=>w&&w.built?i:-1).filter(i=>i>=0);
  if(ws.length){const i=ws[Math.floor(Math.random()*ws.length)]; return{x:G.wsX[i],y:FY+18,ws:i};}
  const p=randField(40); return{x:p.x,y:p.y};
}
function updElephant(e,dt){
  e.t+=dt; e.mv=true; e.walk+=dt;
  if(e.state==='flee'){fleeTo(e,70,dt); return;}
  if(e.t>32){e.state='flee'; return;}
  if(!e.target) e.target=elephantTarget(e);
  const arrived=moveTo(e,e.target.x,e.target.y,G.hard?20:16,dt); e.mv=true;
  const c=Math.floor((e.x-FX)/CELL), r=Math.floor((e.y-FY)/CELL);
  for(let dr=-1;dr<=0;dr++)for(let dc=-1;dc<=1;dc++){const cc=c+dc, rr2=r+dr; if(cc>=0&&rr2>=0&&cc<COLS&&rr2<ROWS){const i=rr2*COLS+cc; G.grass[i]=G.gT[i]=0;}}
  if(arrived){
    const tg=e.target;
    if(tg.tree&&G.trees.includes(tg.tree)){tg.tree.g=.3; e.flat.push(tg.tree); fx('dust',tg.x,tg.y); sfx('thud'); toast('Ottakomban flattened a tree. It will grow back.');}
    if(tg.ws!==undefined&&G.ws[tg.ws]){G.ws[tg.ws].broken=12; fx('dust',G.wsX[tg.ws],WS_BY-10); sfx('build'); toast(`Ottakomban smashed the ${WS[G.ws[tg.ws].type].name.toLowerCase()}! It needs 12 seconds of repairs.`);}
    e.target=null;
  }
}
function hitElephant(e,actor){
  const t=G.clock; e.hits[actor]=t;
  const team=Object.entries(e.hits).some(([a,ht])=>a!==actor&&t-ht<.7);
  e.pts+=team?3:1; e.stun=.15; sfx('hit');
  if(team){floatText('TEAM HIT!',e.x,e.y-60,'#7fe3ee'); e.hits={};}
  if(e.pts>=e.need){e.state='flee'; sfx('elephant'); toast('Ottakomban ran off into the forest!'); floatText('+₹150',e.x,e.y-40,'#ffe39a'); G.money+=150;}
}
function crackers(){
  const live=G.elephants.filter(e=>e.state!=='flee');
  if(!live.length){toast('No elephant to scare right now.'); return false;}
  live.forEach(e=>{e.state='flee'; fx('puff',e.x,e.y-30);}); sfx('cracker'); toast('Bang! The firecracker scared Ottakomban away.');
  return true;
}
const nightish=()=>!!(G&&G.dn&&(G.dn.phase==='dusk'||G.dn.phase==='night'));
const isNight=()=>!!(G&&G.dn&&G.dn.phase==='night');
function dark(){
  if(!G||!G.dn) return 0; const d=G.dn;
  return d.phase==='dusk'?Math.min(1,d.t/DUSK):d.phase==='night'?1:d.phase==='dawn'?Math.max(0,1-d.t/DAWN):0;
}
const inPenRect=(x,y)=>Math.abs(x-PEN.x)<PEN.w/2+6&&Math.abs(y-PEN.y)<PEN.h/2+6;
function penSpot(){return{x:PEN.x-PEN.w/2+14+Math.random()*(PEN.w-28),y:PEN.y-PEN.h/2+18+Math.random()*(PEN.h-28)};}
function updNight(dt){
  const d=G.dn; if(!d) return; d.t+=dt;
  if(d.phase==='day'){
    if(d.t>=d.next){d.phase='dusk'; d.t=0; G.shovel=false;
      if(G.ev&&G.ev.type!=='powercut'){G.ev=null; G.nextEv=30;}
      G.monkeys.forEach(m=>{if(m.state==='seek') m.state='leave';});
      toast('Night is falling. Your animals are heading to the pen.'); sfx('ev_dusk');}
  }else if(d.phase==='dusk'){
    if(d.t>=DUSK){d.phase='night'; d.t=0; d.len=G.hard?50:40; d.pen=100; d.nj=2; d.nb=5;
      d.pcAt=Math.random()<.45?rnd(6,d.len-18):Infinity; G.nightStats={caught:0,killed:0,lost:[],trees:0};
      toast('Night! Jackals and wild boar are coming. Catch them with the net or kill them with the stick.'); emit({music:'night'},null);}
  }else if(d.phase==='night'){
    d.nj-=dt; if(d.nj<=0){d.nj=(G.hard?4.5:6.5)*rnd(.8,1.2); if(G.animals.some(a=>!ANIM[a.type].meat)) spawnJackal(true);}
    d.nb-=dt; if(d.nb<=0){d.nb=(G.hard?8:11)*rnd(.8,1.2); spawnBoar();}
    if(d.t>=d.pcAt&&!G.ev){d.pcAt=Infinity; startEvent('powercut');}
    if(d.t>=d.len){d.phase='dawn'; d.t=0; if(evOn('powercut')) G.ev=null; endNight();}
  }else if(d.phase==='dawn'&&d.t>=DAWN){d.phase='day'; d.t=0; d.next=G.hard?80:100;}
}
function endNight(){
  const s=G.nightStats||{caught:0,killed:0,lost:[],trees:0};
  G.animals.forEach(a=>{a.inPen=false; a.penSpot=null; a.wait=0;});
  G.jackals.forEach(j=>{if(j.carry){s.lost.push(j.carry); j.counted=true;} j.state='flee';}); G.boars.forEach(b=>{b.state='flee';});
  const parts=[`caught ${s.caught}`,`killed ${s.killed}`];
  if(s.lost.length){const m={}; s.lost.forEach(k=>{m[k]=(m[k]||0)+1;}); parts.push('lost '+Object.entries(m).map(([k,n])=>`${n} ${plural(ANIM[k].name,n)}`).join(', '));}
  if(s.trees) parts.push(`${s.trees} ${s.trees>1?'plants':'plant'} eaten`);
  toast('Morning! Night over: '+parts.join(', ')+'.'); sfx('ding'); emit({music:G.L.rush?'rush':'play'},null);
}
// Animals walk into the pen at dusk and stay there (no hunger, no eggs) until dawn.
function penAnimal(a,dt){
  const st=ANIM[a.type]; a.starve=0; a.enter=false; a.eating=false;
  if(!a.penSpot) a.penSpot=penSpot();
  if(!a.inPen){if(moveTo(a,a.penSpot.x,a.penSpot.y,st.speed*2.2,dt)) a.inPen=true; return;}
  a.wait-=dt; if(a.wait<=0){a.wait=rnd(1,3); a.penSpot=penSpot();}
  moveTo(a,a.penSpot.x,a.penSpot.y,st.speed*.5,dt);
}
function repairPen(){
  if(G.dn.pen>=100){toast('The pen is in good shape.'); return;}
  G.dn.pen=Math.min(100,G.dn.pen+20); fx('dust',PEN.x+rnd(-40,40),PEN.y-PEN.h/2); sfx('pop');
}
// The tool chosen with the Net / Stick button at night. Daytime hits always use the net.
function curTool(){
  if(!nightish()||!CUR) return 'net';
  return CUR.tool==='stick'?'stick':'net';
}
const JACKAL_KILL=()=>G.hard?5:3, BOAR_CATCH=()=>G.hard?10:7, BOAR_KILL=()=>G.hard?6:4;
function predNeed(kind,o,tool){ // taps needed for a player using this tool
  const stick=nightish()&&tool==='stick';
  return kind==='boar'?(stick?BOAR_KILL():BOAR_CATCH()):(stick?JACKAL_KILL():o.need);
}
function spawnBoar(){
  if(!G.trees.some(t=>t.g>.05)) return;
  const side=Math.random()<.5?-1:1, y=FY+40+Math.random()*(FH-80);
  G.boars.push({id:++UID,x:side<0?-30:W+30,y,dir:-side,taps:0,stun:0,state:'raid',target:null,t:0,walk:0,mv:false,gone:false});
  if(!G.boarTold){G.boarTold=true; toast('A wild boar is after your plants! Tap it to stop it.');}
}
function updBoar(b,dt){
  b.mv=false; if(b.stun>0){b.stun-=dt; return;}
  b.t+=dt;
  if(b.state==='flee'){fleeTo(b,55,dt); return;}
  if(!b.target||!G.trees.includes(b.target)){
    const trs=G.trees.filter(t=>t.g>.05); if(!trs.length){b.state='flee'; return;}
    b.target=trs.reduce((a,t)=>dist(t.x,t.y,b.x,b.y)<dist(a.x,a.y,b.x,b.y)?t:a);
  }
  const tr=b.target;
  if(moveTo(b,tr.x+(b.x<tr.x?-13:13),tr.y+4,G.hard?32:26,dt)){
    b.walk+=dt*.6; tr.g=Math.max(0,tr.g-dt*(G.hard?.3:.22)); tr.t=0;
    if(tr.g<=0){G.trees=G.trees.filter(o=>o!==tr); fx('dust',tr.x,tr.y); sfx('attack');
      toast(`A wild boar ate your ${BUY[tr.type].name.toLowerCase()}!`); if(G.nightStats) G.nightStats.trees++; b.target=null;}
  }
  const c=Math.floor((b.x-FX)/CELL), r=Math.floor((b.y-FY)/CELL);
  if(c>=0&&r>=0&&c<COLS&&r<ROWS){const i=r*COLS+c; G.grass[i]=G.gT[i]=Math.min(G.grass[i],.3);}
}
function hitBoar(b){
  const tool=curTool(); b.taps++; b.stun=.3; sfx('hit'); fx('dust',b.x,b.y);
  if(b.taps<(tool==='stick'?BOAR_KILL():BOAR_CATCH())) return;
  b.gone=true; G.boars=G.boars.filter(o=>o!==b);
  if(tool==='stick'){fx('puff',b.x,b.y-8); sfx('thud'); toast('Killed the wild boar with the stick.'); if(G.nightStats) G.nightStats.killed++;}
  else{const cx=clamp(b.x,FX+16,FX+FW-16), cy=clamp(b.y,FY+24,FY+FH-8), life=isNight()?40:15;
    G.cages.push({x:cx,y:cy,t:life,max:life,kind:'boar'}); sfx('cage'); toast('Caught a wild boar! Tap the cage to keep it and sell it.'); if(G.nightStats) G.nightStats.caught++;}
}
function shovelAt(x,y){
  if(nightish()){toast('No digging at night.'); return true;}
  const tr=G.trees.find(tr=>Math.abs(x-tr.x)<20&&y>tr.y-60*(.35+.65*tr.g)&&y<tr.y+10);
  if(tr){const back=Math.round(BUY[tr.type].cost*.3); G.trees=G.trees.filter(o=>o!==tr); G.money+=back; fx('dust',tr.x,tr.y); sfx('thud');
    toast(`Dug up the ${BUY[tr.type].name.toLowerCase()}. +₹${back}`); return true;}
  const i=G.ws.findIndex((w,i)=>w&&w.built&&Math.abs(x-G.wsX[i])<G.wsW/2+6&&y>8&&y<WS_BY+8);
  if(i>=0){const w=G.ws[i], d=WS[w.type], back=Math.round(d.cost*.3);
    Object.assign(w,{built:false,busy:false,jobs:[],cur:null,queue:0,t:0,broken:0}); G.money+=back; fx('dust',G.wsX[i],WS_BY-10); sfx('build');
    toast(`Took down the ${d.name.toLowerCase()}. +₹${back}`); return true;}
  toast('Tap a plant or a building to dig it up.'); return false;
}
const sellable=k=>G.animals.filter(a=>a.type===k&&!a.enter&&!a.dead&&!a.inPen).sort((p,q)=>(q.ready?1:0)-(p.ready?1:0));
function sellAnimal(k){
  const T=G.truck; if(T.state!=='home'||nightish()||!ANIM[k]) return;
  if(autoCap()-cargoUsed()<=0){toast('The auto-rickshaw is full.'); sfx('err'); return;}
  const a=sellable(k)[0]; if(!a) return;
  const item=liveItem(k,!!a.ready); a.dead=true; T.cargo[item]=(T.cargo[item]||0)+1;
  fx('fly',a.x,a.y,{item:'egg',tx:PARK.x,ty:PARK.y-30});
}
function unloadAnimal(item){
  const T=G.truck, back=LIVE_BACK[item]; if(!back||!(T.cargo[item]>0)) return;
  T.cargo[item]--; addAnimal(back[0],PARK.x-60,575,true);
  if(back[1]){const a=G.animals[G.animals.length-1]; a.ready=true; a.prod=1;}
}

// A tap on the farm by the current player (CUR). Returns what happened when the caller needs to react:
// 'market' (open the market panel), 'shoveled' (shovel used up), or undefined.
function tapAt(x,y){
  const mk=(Math.abs(x-WH.x)<64&&y>490&&y<602)||(x>266&&y>515&&y<606);
  for(const e of G.elephants) if(e.state!=='flee'&&dist(e.x+e.dir*10,e.y-26,x,y)<42){hitElephant(e,CUR?CUR.pid:'kuttan'); return;}
  for(const b of G.boars) if(b.state!=='flee'&&dist(b.x+b.dir*4,b.y-6,x,y)<28){hitBoar(b); return;}
  for(const m of G.monkeys) if(m.state!=='scared'&&dist(m.x,m.y-10,x,y)<26){hitMonkey(m); return;}
  for(const j of G.jackals) if(dist(j.x+3*j.dir,j.y-4,x,y)<28){hitJackal(j); return;}
  if(CUR&&CUR.sh) return shovelAt(x,y)?'shoveled':undefined;
  let best=null,bd=24; for(const p of G.products){const d=dist(p.x,p.y-3,x,y); if(d<bd){bd=d;best=p;}}
  if(best){collect(best); return;}
  for(const c of G.cages) if(dist(c.x,c.y-10,x,y)<24){collectCage(c); return;}
  if(isNight()&&inPenRect(x,y)){repairPen(); return;}
  for(const a of G.animals) if(ANIM[a.type].meat&&!a.enter&&dist(a.x,a.y-8,x,y)<20){tapMeatAnimal(a); return;}
  for(const tr of G.trees) if(Math.abs(x-tr.x)<18&&y>tr.y-56*(.35+.65*tr.g)&&y<tr.y+8){waterTree(tr); return;}
  for(let i=0;i<G.ws.length;i++) if(G.ws[i]&&Math.abs(x-G.wsX[i])<G.wsW/2+6&&y>8&&y<WS_BY+8){tapWorkshop(i); return;}
  if(dist(x,y,WELL.x,WELL.by-46)<48){tapWell(); return;}
  if(mk) return 'market';
  if(x>=FX&&x<FX+FW&&y>=FY&&y<FY+FH) plantAt(x,y);
}
function hitJackal(j){
  const tool=curTool();
  j.taps++; j.stun=.3; sfx('hit'); fx('dust',j.x,j.y);
  if(j.taps>=(tool==='stick'?JACKAL_KILL():j.need)){
    j.gone=true; G.jackals=G.jackals.filter(o=>o!==j);
    const cx=clamp(j.x,FX+16,FX+FW-16), cy=clamp(j.y,FY+24,FY+FH-8);
    if(tool==='stick'){fx('puff',j.x,j.y-6); sfx('thud'); if(G.nightStats) G.nightStats.killed++;
      if(j.carry){addAnimal(j.carry,clamp(cx+14,FX+12,FX+FW-12),cy+4,false); toast(`Killed the jackal and saved the ${ANIM[j.carry].name}!`);} else toast('Killed the jackal with the stick.');
      return;}
    if(G.nightStats&&nightish()) G.nightStats.caught++;
    const life=isNight()?40:15; G.cages.push({x:cx,y:cy,t:life,max:life}); sfx('cage');
    if(j.carry){addAnimal(j.carry,clamp(cx+14,FX+12,FX+FW-12),cy+4,false); toast(`You saved the ${ANIM[j.carry].name}! Tap the cage to keep the jackal.`);}
    else toast('Trapped! Tap the cage to move it to the storehouse.');
  }
}
function hitMonkey(m){
  m.taps++; m.stun=.25; sfx('hit');
  if(m.taps>=m.need){m.state='scared'; sfx('chatter'); if(m.item){dropProduct(m.item,m.x,m.y,10); m.item=null;}}
}
function collectCage(c){
  if(storeUsed()>=storeCap()){toast('The storehouse is full. Send goods to the market first.'); sfx('err'); return;}
  c.gone=true; G.cages=G.cages.filter(o=>o!==c);
  const item=c.kind==='boar'?'boarcage':'jackal'; G.store[item]=(G.store[item]||0)+1;
  fx('fly',c.x,c.y,{item,tx:WH.x,ty:WH.by-40}); sfx('pop');
}
function tapWorkshop(i){
  const w=G.ws[i], d=WS[w.type];
  if(!w.built){
    if(G.money>=d.cost&&w.armed!==true){w.armed=true; clearTimeout(w.armT); w.armT=setTimeout(()=>{w.armed=false;},3000); toast(`Tap again to build the ${d.name} for ₹${d.cost}.`); sfx('pop'); return;}
    if(G.money>=d.cost){w.armed=false; G.money-=d.cost; w.built=true; sfx('build'); fx('dust',G.wsX[i],WS_BY-10); toast(`The ${d.name} is open. Tap it to start work.`);}
    else{toast(`Building the ${d.name} costs ₹${d.cost}.`); sfx('err');}
    return;
  }
  if(w.broken>0){toast(`Ottakomban smashed the ${d.name.toLowerCase()}. Repairs take ${Math.ceil(w.broken)} more seconds.`); return;}
  if(d.animal){toast('Tap a grown pig or buffalo (green tick) to send it to the meat shop.'); return;}
  if(w.busy&&w.jobs.length>=3){toast('That queue is full.'); return;}
  const r=pickRecipe(d);
  if(!r){toast(`The ${d.name} needs ${d.recipes.map(r=>Object.keys(r.in).map(k=>ITEMS[k].name.toLowerCase()).join(' + ')).join(', or ')} from the storehouse.`); sfx('err'); return;}
  for(const [k,n] of Object.entries(r.in)) G.store[k]-=n;
  enqueueJob(w,{out:r.out,n:1}); sfx('pop');
}
// how much the farm still needs an item: 2 = a goal, 1 = an ingredient for a goal dish
function needOf(k){
  const goal=G.L.goals[k]; if(goal&&(G.collected[k]||0)<goal) return 2;
  return G.ws.some(w=>w&&w.built&&WS[w.type].recipes.some(r=>r.in[k]&&G.L.goals[r.out]&&(G.collected[r.out]||0)<G.L.goals[r.out]))?1:0;
}
function pickRecipe(d){
  const ok=d.recipes.filter(r=>Object.entries(r.in).every(([k,n])=>(G.store[k]||0)>=n));
  return ok.sort((a,b)=>needOf(b.out)-needOf(a.out))[0]||null;
}
function enqueueJob(w,job){
  if(w.busy) w.jobs.push(job); else{w.busy=true; w.t=0; w.cur=job;}
  w.queue=w.jobs.length; w.dur=WS[w.type].time*wsMult();
}
function tapMeatAnimal(a){
  const st=ANIM[a.type];
  if(!a.ready){toast(`This ${st.name} is still growing. Keep it fed.`); return;}
  const i=G.ws.findIndex(w=>w&&w.type==='meat'), w=G.ws[i];
  if(!w){toast('There is no meat shop on this farm.'); sfx('err'); return;}
  if(!w.built){toast('Build the meat shop first.'); sfx('err'); return;}
  if(w.busy&&w.jobs.length>=3){toast('The meat shop is busy. Try again in a moment.'); sfx('err'); return;}
  a.dead=true; fx('dust',a.x,a.y); fx('fly',a.x,a.y,{item:st.meat,tx:G.wsX[i],ty:WS_BY-30});
  enqueueJob(w,{out:st.meat,n:3}); sfx('pop');
}
function waterTree(tr){
  if(tr.wet>5){toast('That tree is already watered.'); return;}
  if(G.water<=0){toast('No water left. Tap the well to draw more.'); sfx('err'); return;}
  G.water--; tr.wet=20; fx('splash',tr.x,tr.y-6); sfx('water');
}
function tapWell(){
  if(G.wellT>0) return;
  if(G.water>=wellCap()){toast('The well bucket is already full. Tap the soil to water it.'); return;}
  G.wellT=wellRefill(); sfx('crank');
}
function plantAt(x,y){
  if(G.water<=0){toast('No water left. Tap the well to draw more.'); sfx('err'); return;}
  G.water--;
  const c=Math.floor((x-FX)/CELL), r=Math.floor((y-FY)/CELL);
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const cc=c+dc, r2=r+dr; if(cc<0||r2<0||cc>=COLS||r2>=ROWS) continue;
    const i=r2*COLS+cc; G.gT[i]=Math.max(G.gT[i],(dc===0||dr===0)?1:.65);}
  fx('splash',x,y); sfx('water');
}
function buy(k){
  const b=BUY[k];
  if(G.money<b.cost){toast(`A ${b.name.toLowerCase()} costs ₹${b.cost}.`); sfx('err'); return;}
  if(b.kind==='action'){if(crackers()){G.money-=b.cost;} return;}
  if(b.kind==='tree'){if(G.trees.length>=TREE_SLOTS.length){toast('All the planting spots are taken.'); sfx('err'); return;} G.money-=b.cost; addTree(k,false); sfx('grow');}
  else{if(G.animals.length+G.boats.filter(b=>!b.spawned).length>=14){toast('The farm has as many animals as it can feed.'); sfx('err'); return;}
    G.money-=b.cost; G.boats.push({id:++UID,t:0,dur:4,cargo:k,spawned:false}); sfx('boat');}
  sfx('buy');
}

function storeUpgrade(){
  const sl=storeLvl()+1; if(!G||sl>3) return;
  if(G.money<STORE_UP_COST[sl]){toast(`Expanding the storehouse costs ₹${STORE_UP_COST[sl]}.`); sfx('err'); return;}
  G.money-=STORE_UP_COST[sl]; G.storeBoost=(G.storeBoost||0)+1; sfx('build'); toast(`The storehouse now holds ${storeCap()} for this level.`);
}
function marketUpgrade(){
  const nl=autoLvl()+1; if(!G||nl>3||G.truck.state!=='home') return;
  if(G.money<AUTO_UP_COST[nl]){toast(`The upgrade costs ₹${AUTO_UP_COST[nl]}.`); sfx('err'); return;}
  G.money-=AUTO_UP_COST[nl]; G.autoBoost=(G.autoBoost||0)+1; sfx('honk'); toast(`Upgraded to the ${UPG.auto.names[nl]} for this level. It carries ${autoCap()}.`);
}
function marketAction(a,k){
  if(a==='animal'){sellAnimal(k); return;}
  if(a==='unload'&&LIVE_BACK[k]){if(G.truck.state==='home') unloadAnimal(k); return;}
  if(!G||!ITEMS[k]) return; const T=G.truck; if(T.state!=='home') return;
  const room=autoCap()-cargoUsed();
  if(a==='load'){if(room>0&&G.store[k]>0){G.store[k]--; T.cargo[k]=(T.cargo[k]||0)+1;}}
  else if(a==='loadall'){const n=Math.min(room,G.store[k]||0); if(n>0){G.store[k]-=n; T.cargo[k]=(T.cargo[k]||0)+n;}}
  else if(a==='unload'){if(!(T.cargo[k]>0)) return; if(storeUsed()>=storeCap()){toast('The storehouse has no room for that.'); return;} T.cargo[k]--; G.store[k]=(G.store[k]||0)+1;}
}
function marketGo(){
  const T=G.truck; if(T.state!=='home'||!cargoUsed()) return;
  if(evOn('hartal')){toast('Hartal today. The market is closed, so the auto can’t go yet.'); sfx('err'); return;}
  if(nightish()){toast('The market is closed at night.'); sfx('err'); return;}
  T.state='going'; T.t=0; T.sold=false; sfx('depart'); toast('The auto is off to the market.');
}
function snapshot(){
  const T=G.truck;
  return{t:'s',li:G.li,m:G.money,gt:r1(G.t),st:G.state,w:G.water,wt:r1(G.wellT),up:G.up,
    g:Array.from(G.grass,v=>Math.round(v*20)),
    a:G.animals.map(a=>[a.id,ANIM_TYPES.indexOf(a.type),r1(a.x),r1(a.y),a.dir,Math.round(a.food*100),a.mv?1:0,a.ready?1:0,Math.round(a.prod*100)]),
    tr:G.trees.map(t=>[TREE_TYPES.indexOf(t.type),t.slot,r1(t.g),r1(t.t),r1(t.wet||0)]),ab:G.autoBoost||0,sb:G.storeBoost||0,
    p:G.products.map(p=>[p.id,p.type,r1(p.x),r1(p.y),r1(p.life),r1(p.age)]),
    j:G.jackals.map(j=>[j.id,r1(j.x),r1(j.y),j.dir,j.taps,r1(j.stun),j.carry||0,j.mv?1:0]),
    mk:G.monkeys.map(m=>[m.id,r1(m.x),r1(m.y),m.dir,m.taps,r1(m.stun),m.item||0,m.mv?1:0,m.state==='scared'?1:0]),
    c:G.cages.map(c=>[r1(c.x),r1(c.y),r1(c.t),c.max,c.kind==='boar'?1:0]),
    bo:G.boars.map(b=>[b.id,r1(b.x),r1(b.y),b.dir,b.taps,r1(b.stun),b.mv?1:0,b.state==='flee'?1:0]),
    dn:G.dn?[PHASES.indexOf(G.dn.phase),r1(G.dn.t),G.dn.len||0,Math.round(G.dn.pen||0)]:0,
    b:G.boats.map(b=>[b.id,r1(b.t),b.dur,b.cargo,b.spawned?1:0]),
    el:G.elephants.map(e=>[e.id,r1(e.x),r1(e.y),e.dir,e.pts,e.need,e.state==='flee'?1:0]),
    ws:G.ws.map(w=>w&&[w.built?1:0,w.busy?1:0,r1(w.t),r1(w.dur),w.queue,r1(w.broken||0)]),
    ce:G.ev?[EVENT_KEYS.indexOf(G.ev.type),r1(G.ev.t),G.ev.dur,r1(G.ev.x||0),r1(G.ev.y||0),G.ev.hit?1:0]:0,
    tk:[T.state==='home'?0:1,r1(T.t),T.cargo,T.sold?1:0],
    s:G.store,co:G.collected,fr:G.failReason||''};
}
function botKeep(){ // inputs a built workshop still needs, so Kuttan doesn't sell them
  const keep={};
  G.ws.forEach(w=>{
    if(!w||!w.built) return;
    WS[w.type].recipes.forEach(r=>{if(needOf(r.out)>0) for(const k in r.in) keep[k]=true;});
  });
  return keep;
}
function botTap(get,intent){return{get,intent,act:p=>asPlayer({pid:'kuttan',tool:'net',sh:0},()=>tapAt(p[0],p[1]))};}
function botWorkshop(){ // the next workshop job Kuttan can start, or null
  for(let i=0;i<G.ws.length;i++){
    const w=G.ws[i]; if(!w||!w.built||(w.busy&&w.queue>=1)) continue; const d=WS[w.type];
    if(d.animal){const ra=G.animals.find(a=>a.ready&&!a.enter&&!a.dead); if(ra) return botTap(()=>ra.dead?null:[ra.x,ra.y-8],'Taking the '+ANIM[ra.type].name+' to the meat shop'); continue;}
    if(pickRecipe(d)) return botTap(()=>[G.wsX[i],WS_BY-30],'Running the '+d.name.toLowerCase());
  }
  return null;
}
function botChoose(){
  const free=storeCap()-storeUsed(), inField=o=>o.x>FX&&o.x<FX+FW&&o.y>FY-10&&o.y<FY+FH+10;
  const el=G.elephants.find(e=>e.state!=='flee'&&inField(e));
  if(el) return botTap(()=>el.gone||el.state==='flee'?null:[el.x+el.dir*10,el.y-26],'Fighting Ottakomban');
  const bo=G.boars.find(b=>b.state!=='flee'&&inField(b));
  if(bo) return botTap(()=>bo.gone||bo.state==='flee'?null:[bo.x+bo.dir*4,bo.y-6],'Chasing the wild boar');
  const j=G.jackals.find(j=>j.carry&&inField(j))||G.jackals.find(j=>j.state==='hunt'&&inField(j));
  if(j) return botTap(()=>j.gone?null:[j.x+3*j.dir,j.y-4],'Chasing the jackal');
  const m=G.monkeys.find(m=>m.state!=='scared'&&inField(m));
  if(m) return botTap(()=>m.gone||m.state==='scared'?null:[m.x,m.y-10],'Shooing the monkey');
  if(isNight()&&G.dn.pen<60) return botTap(()=>isNight()?[PEN.x,PEN.y]:null,'Fixing the pen');
  const wsAct=botWorkshop();
  if(free>0&&G.products.length){
    const p=G.products.slice().sort((a,b)=>(needOf(b.type)-needOf(a.type))||(a.life-b.life))[0];
    if(!wsAct||needOf(p.type)>0||p.life<5) return botTap(()=>G.products.includes(p)?[p.x,p.y-3]:null,'Collecting');
  }
  if(wsAct) return wsAct;
  if(free>0&&G.cages.length){const c=G.cages[0]; return botTap(()=>G.cages.includes(c)?[c.x,c.y-10]:null,'Fetching the cage');}
  if(G.water===0&&G.wellT<=0) return botTap(()=>[WELL.x,WELL.by-46],'Drawing water');
  if(G.water>0){
    for(const a of G.animals.filter(a=>!a.enter&&a.food<.6).sort((a,b)=>a.food-b.food)){
      const c=nearestGrass(a.x,a.y), cc=c>=0?cellCenter(c):null;
      if(!cc||dist(cc[0],cc[1],a.x,a.y)>CELL*2.2){const x=clamp(a.x,FX+6,FX+FW-6), y=clamp(a.y,FY+6,FY+FH-6); return botTap(()=>[x,y],'Watering');}
    }
    let green=0; for(let i=0;i<G.grass.length;i++) if(G.grass[i]>.2) green++;
    if(G.water>1&&G.animals.length&&green<G.animals.length*4){
      const a=G.animals[Math.floor(Math.random()*G.animals.length)], x=clamp(a.x+rnd(-40,40),FX+6,FX+FW-6), y=clamp(a.y+rnd(-40,40),FY+6,FY+FH-6);
      return botTap(()=>[x,y],'Watering');
    }
  }
  if(G.water>=2){const tr=G.trees.find(t=>(t.wet||0)<=0); if(tr) return botTap(()=>G.trees.includes(tr)?[tr.x,tr.y-20]:null,'Watering the trees');}
  if(G.truck.state==='home'&&!evOn('hartal')&&!nightish()){
    const keep=botKeep(), sell=Object.keys(G.store).filter(k=>G.store[k]>0&&!keep[k]), n=sell.reduce((a,k)=>a+G.store[k],0);
    const needCash=G.L.goals.money&&G.money<G.L.goals.money;
    if(n>0&&(free<=2||n>=autoCap()*.6||(needCash&&n>=2)))
      return{get:()=>[PARK.x,PARK.y-30],intent:'Off to the market',act:()=>{sell.forEach(k=>marketAction('loadall',k)); marketGo();}};
    if(free===0){const k=Object.keys(G.store).find(k=>G.store[k]>0); if(k) return{get:()=>[PARK.x,PARK.y-30],intent:'Making room',act:()=>{marketAction('loadall',k); marketGo();}};}
  }
  return null;
}
function botTick(dt){
  const B=G.bot, sk=BOT_SKILL[B.skill];
  if(B.target){
    const p=B.target.get(); if(!p){B.target=null; B.cool=.15; return;}
    const dx=p[0]-B.x, dy=p[1]-B.y, d=Math.hypot(dx,dy), s=sk.speed*dt;
    if(d>s){B.x+=dx/d*s; B.y+=dy/d*s; return;}
    B.x=p[0]; B.y=p[1]; B.target.act(p); emit({fx:['tap',p[0],p[1],{d:.4}]},null);
    B.target=null; B.cool=sk.delay*rnd(.7,1.3); return;
  }
  B.cool-=dt; if(B.cool>0) return;
  B.target=botChoose();
  if(B.target) B.intent=B.target.intent; else{B.cool=.3; B.intent='';}
}

// A player action. msg: {t:'tap',x,y,tool,sh} | {t:'buy',k} | {t:'mk',a,k} | {t:'go'} | {t:'upauto'} | {t:'upstore'}
function input(pid,msg){
  if(!G||G.state!=='play'||!msg) return;
  return asPlayer({pid,tool:msg.tool==='stick'?'stick':'net',sh:!!msg.sh},()=>{
    switch(msg.t){
      case 'tap': if(typeof msg.x==='number'&&typeof msg.y==='number'&&isFinite(msg.x)&&isFinite(msg.y)) return tapAt(msg.x,msg.y); break;
      case 'buy': if(BUY[msg.k]&&G.L.buy.includes(msg.k)) buy(msg.k); break;
      case 'mk': marketAction(msg.a,msg.k); break;
      case 'go': marketGo(); break;
      case 'upauto': marketUpgrade(); break;
      case 'upstore': storeUpgrade(); break;
    }
  });
}
return {
  get G(){return G;},
  newGame, update, step:update, input, snapshot,
  start(){if(G&&G.state==='intro') G.state='play';},
  stopBot(){if(G&&G.bot) G.bot.on=false;},
  _debug:{startEvent,spawnBoar,spawnJackal,spawnElephant,spawnMonkey},
  // read-only helpers the screen uses for drawing and panels
  storeUsed, cargoUsed, cargoValue, storeCap, autoCap, autoTrip, autoLvl, storeLvl, wellCap, wellRefill,
  evOn, nightish, isNight, dark, predNeed, needOf, pickRecipe, sellable, goalsMet, cellCenter, inPenRect,
};
}

const API={createEngine,VERSION:'1',LEVEL_COUNT:LEVELS.length,
  data:{W,H,FX,FY,CELL,COLS,ROWS,FW,FH,WS_BY,WS_KEYS,slotGeom,WH,WELL,PARK,JETTY,TREE_SLOTS,ITEMS,MASS,BUY,ANIM,ANIM_TYPES,TREE,TREE_TYPES,WS,UPG,UPG_COST,LEVELS,REGIONS,regionOf,
    AUTO_UP_COST,STORE_UP_COST,rnd,dist,clamp,timeLimit,EVENTS,EVENT_KEYS,PEN,DUSK,DAWN,PHASES,liveItem,LIVE_BACK,medalFor,plural,r1,BOT_SKILL}};
root.NaadanCore=API;
// with a plain createEngine() for the server, also expose a convenience wrapper matching the server's interface
API.createGame=function(o){
  const players=(o.players||[]).map(p=>p.id);
  const eng=createEngine({event:(e,to)=>{if(o.hooks&&o.hooks.event) o.hooks.event(e,to);}});
  eng.newGame(o.level,{hard:players.length>1,up:o.up,nights:o.nights!==false,players});
  return {
    start:()=>eng.start(), step:dt=>eng.step(dt), input:(pid,msg)=>{eng.input(pid,msg);}, snapshot:()=>eng.snapshot(),
    get state(){return eng.G.state;}, get level(){return eng.G.L;},
    result(){const G=eng.G; return {won:G.state==='won'||G.state==='done',medal:(G.state==='won'||G.state==='done')?medalFor(G.L,G.t):0,time:G.t,reason:G.failReason||''};},
  };
};
})(typeof globalThis!=='undefined'?globalThis:this);
