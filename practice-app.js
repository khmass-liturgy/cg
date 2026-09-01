(function(){
  'use strict';

  const KEYS={
    repertoire:'kg_repertoire_v2',
    logs:'kg_practice_logs_v2',
    recitals:'kg_recitals_v2',
    focus:'kg_practice_focus_v2'
  };
  const FILE_DB_NAME='kg_repertoire_files_v1';
  const FILE_STORE='attachments';
  const MAX_ATTACHMENTS_PER_PIECE=5;
  const MAX_ATTACHMENT_BYTES=12*1024*1024;
  let fileDbPromise=null;
  const STAGES={
    learning:{label:'익히는 중',order:1},
    polishing:{label:'다듬는 중',order:2},
    ready:{label:'발표 가능',order:3}
  };
  const CHECKS=[
    ['memory','암보 또는 악보 동선 확인'],
    ['recording','휴대폰으로 전체 연주 녹음'],
    ['feedback','녹음 듣고 보완점 1개 기록'],
    ['rehearsal','발표 순서대로 리허설 완료']
  ];
  // khcg 기타반 공개 단원 목록 기준 (연락처 등 민감 정보는 포함하지 않음)
  const MEMBERS=[
    {id:'m_ch_sohee',name:'최소희 소피아',part:'1st'},
    {id:'m_lee_yeonsim',name:'이연심 카타리나',part:'1st'},
    {id:'m_jung_cheol',name:'정철 야고보',part:'2nd'},
    {id:'m_choi_jinhee',name:'최진희 크리스티나',part:'2nd'},
    {id:'m_choi_dongmyung',name:'최동명 미카엘',part:'3rd'},
    {id:'m_choi_soojeong',name:'최수정 소피아',part:'3rd'},
    {id:'m_ha_myeongran',name:'하명란 소화데레사',part:'3rd'},
    {id:'m_hwang_jungwon',name:'황정원 요안나',part:'3rd'},
    {id:'m_park_soonran',name:'박순란 안젤라',part:'3rd'},
    {id:'m_park_hyunho',name:'박현호 빈첸시오',part:'3rd'},
    {id:'m_lee_geumseok',name:'이금석 도미니코',part:'파트 미지정'},
    {id:'m_kim_yongseok',name:'김용석 프란치스코',part:'파트 미지정'},
    {id:'m_yoo_dongjong',name:'유동종 마르코',part:'파트 미지정'},
    {id:'m_lee_misook',name:'이미숙 아녜스',part:'파트 미지정'},
    {id:'m_choi_jaedeok',name:'최재덕 요셉',part:'파트 미지정'}
  ];
  const UNASSIGNED_MEMBER={id:'unassigned',name:'담당 미지정',part:'미지정'};

  function load(key,fallback){
    try{
      const value=JSON.parse(localStorage.getItem(key));
      return value===null?fallback:value;
    }catch(e){return fallback;}
  }
  function persist(key,value){localStorage.setItem(key,JSON.stringify(value));}
  function fileDb(){
    if(fileDbPromise)return fileDbPromise;
    fileDbPromise=new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error('이 브라우저는 파일 보관을 지원하지 않습니다.'));return;}
      const request=indexedDB.open(FILE_DB_NAME,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(FILE_STORE,{keyPath:'id'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('파일 보관함을 열 수 없습니다.'));
    });
    return fileDbPromise;
  }
  function attachmentId(){return `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;}
  function fileSize(bytes){
    if(bytes<1024*1024)return `${Math.max(1,Math.round(bytes/1024))} KB`;
    return `${(bytes/(1024*1024)).toFixed(1)} MB`;
  }
  async function saveAttachment(repId,file){
    const id=attachmentId(),record={id,repId,name:file.name||'첨부 파일',type:file.type||'',size:Number(file.size||0),addedAt:new Date().toISOString(),blob:file};
    const db=await fileDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,'readwrite');tx.objectStore(FILE_STORE).put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('파일 저장에 실패했습니다.'));});
    return {id,name:record.name,type:record.type,size:record.size,addedAt:record.addedAt};
  }
  async function getAttachment(id){
    const db=await fileDb();
    return new Promise((resolve,reject)=>{const request=db.transaction(FILE_STORE,'readonly').objectStore(FILE_STORE).get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('첨부 파일을 읽을 수 없습니다.'));});
  }
  async function deleteAttachment(id){
    const db=await fileDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,'readwrite');tx.objectStore(FILE_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('첨부 파일 삭제에 실패했습니다.'));});
  }
  function html(value){
    return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function localKey(date=new Date()){
    return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  }
  function monthKey(date=new Date()){return localKey(date).slice(0,7);}
  function dateLabel(date=new Date()){
    return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(date);
  }
  function dayDiff(dateText){
    const now=new Date(); now.setHours(0,0,0,0);
    const target=new Date(dateText+'T00:00:00');
    return Math.round((target-now)/86400000);
  }
  function fourthThursday(month){
    const [year,monthNumber]=month.split('-').map(Number),first=new Date(year,monthNumber-1,1);
    const day=1+((4-first.getDay()+7)%7)+21;
    return `${year}-${String(monthNumber).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const KHCG_SCHEDULE_CONFIG={apiKey:'AIzaSyDzkdnSQqFNG9vG54CAaT8xTi6pJxl8mOQ',authDomain:'khmasscg.firebaseapp.com',databaseURL:'https://khmasscg-default-rtdb.firebaseio.com',projectId:'khmasscg',appId:'1:618708075654:web:fe60dda22f97a878df3d07'};
  let khcgSchedule={ready:false,rehearsals:[],recitals:[],error:false};
  let recitalCloud={ready:false,error:'',saving:false};

  let repertoire=load(KEYS.repertoire,[]);
  let logs=load(KEYS.logs,{});
  let recitals=load(KEYS.recitals,{});
  let activeView='today';
  let repFilter='all';
  let activeMember='all';
  let sessionMinutes=30;
  let showAddForm=false;
  let focusId=localStorage.getItem(KEYS.focus)||'';

  const legacyRenderHome=window.renderHome;
  const legacyOpenLesson=window.openLesson;
  const legacyUpdateProg=window.updateProg;

  function todayLog(){
    const key=localKey();
    if(!logs[key]) logs[key]={minutes:0,blocks:[false,false,false],notes:'',pieces:[],updatedAt:''};
    if(!Array.isArray(logs[key].blocks)) logs[key].blocks=[false,false,false];
    return logs[key];
  }
  function currentFocus(){
    let item=repertoire.find(r=>r.id===focusId);
    if(!item) item=repertoire.find(r=>r.stage!=='ready')||repertoire[0]||null;
    if(item && focusId!==item.id){focusId=item.id;localStorage.setItem(KEYS.focus,item.id);}
    return item;
  }
  function streak(){
    const practiced=new Set(Object.entries(logs).filter(([,v])=>Number(v.minutes)>0).map(([k])=>k));
    let cursor=new Date(); cursor.setHours(0,0,0,0);
    if(!practiced.has(localKey(cursor))){cursor.setDate(cursor.getDate()-1);}
    let count=0;
    while(practiced.has(localKey(cursor))){count++;cursor.setDate(cursor.getDate()-1);}
    return count;
  }
  function monthStats(){
    const key=monthKey();
    const entries=Object.entries(logs).filter(([k,v])=>k.startsWith(key)&&Number(v.minutes)>0);
    return {days:entries.length,minutes:entries.reduce((sum,[,v])=>sum+Number(v.minutes||0),0)};
  }
  function stageLabel(stage){return STAGES[stage]?.label||STAGES.learning.label;}
  function lessonById(id){return typeof allLessons==='function'?allLessons().find(l=>l.id===id):null;}
  function courseForLesson(id){return typeof CUR!=='undefined'?CUR.find(c=>c.lessons.some(l=>l.id===id)):null;}
  function isSavedLesson(id){return repertoire.some(r=>r.lessonId===id);}
  function memberOptions(){return [UNASSIGNED_MEMBER,...MEMBERS];}
  function memberInfo(id){return memberOptions().find(member=>member.id===id)||UNASSIGNED_MEMBER;}
  function memberIdFor(item){return item.memberId||'unassigned';}
  function memberLabel(item){return memberInfo(memberIdFor(item)).name;}
  function memberPart(item){return memberInfo(memberIdFor(item)).part;}
  function memberOptionGroups(selectedId){
    const parts=['1st','2nd','3rd','파트 미지정'];
    const selected=selectedId||'unassigned';
    return `<option value="unassigned"${selected==='unassigned'?' selected':''}>담당 미지정</option>`+parts.map(part=>`<optgroup label="${part}">${MEMBERS.filter(member=>member.part===part).map(member=>`<option value="${member.id}"${selected===member.id?' selected':''}>${html(member.name)}</option>`).join('')}</optgroup>`).join('');
  }
  function arrayValues(value){return Array.isArray(value)?value:Object.values(value||{});}
  function isKhcgMonthlyRecital(rehearsal){return !!(rehearsal&&!rehearsal.cancelled&&(rehearsal.monthlyRecital===true||/월례\s*발표회/.test(rehearsal.memo||'')));}
  function khcgRecitalDate(month){
    const scheduled=khcgSchedule.rehearsals.filter(item=>isKhcgMonthlyRecital(item)&&String(item.date||'').slice(0,7)===month).sort((a,b)=>String(a.date).localeCompare(String(b.date)))[0];
    if(scheduled?.date)return {date:scheduled.date,source:'교하성당 기타반 일정'};
    const recital=khcgSchedule.recitals.find(item=>item&&item.month===month);
    if(recital?.date)return {date:recital.date,source:'교하성당 월례발표회 계획'};
    return {date:fourthThursday(month),source:khcgSchedule.ready?'교하성당 기본 일정':'일정 불러오는 중'};
  }
  function syncRecitalDate(month=monthKey()){
    const item=recitals[month];if(!item)return;
    const plan=khcgRecitalDate(month);
    if(item.date!==plan.date){item.date=plan.date;item.dateSource=plan.source;saveRecitals();}
    else item.dateSource=plan.source;
  }
  function recitalPieceSnapshots(item){
    return (item.pieces||[]).map(id=>repertoire.find(piece=>piece.id===id)).filter(Boolean).map(piece=>({sourceId:piece.id,title:piece.title,composer:piece.composer||'',memberId:memberIdFor(piece),memberName:memberLabel(piece),memberPart:memberPart(piece),stage:piece.stage||'learning'}));
  }
  function applyCloudRecital(data){
    const key=monthKey(),current=ensureRecital(),remotePieces=Array.isArray(data.selectedPieces)?data.selectedPieces:[];
    const matchedIds=remotePieces.map(remote=>repertoire.find(piece=>piece.id===remote.sourceId||(piece.title===remote.title&&memberIdFor(piece)===remote.memberId))?.id).filter(Boolean);
    recitals[key]={...current,title:typeof data.title==='string'?data.title:current.title,checks:data.checks&&typeof data.checks==='object'?data.checks:current.checks,notes:typeof data.notes==='string'?data.notes:current.notes,performed:!!data.performed,remotePieces,pieces:matchedIds.length?matchedIds:current.pieces};
    syncRecitalDate(key);saveRecitals();
  }
  function initRecitalCloud(){
    try{
      if(typeof db!=='undefined'&&db?.collection){
        db.collection('monthlyRecitalPlans').doc(monthKey()).onSnapshot(snapshot=>{
          recitalCloud.ready=true;
          if(snapshot.exists)applyCloudRecital(snapshot.data()||{});
          if(activeView==='recital')renderApp();
        },()=>{recitalCloud.error='Firebase 발표곡을 불러오지 못했습니다';if(activeView==='recital')renderApp();});
      }
      if(typeof firebase!=='undefined'&&firebase?.database){
        let scheduleApp=firebase.apps.find(app=>app.name==='khcg-schedule');
        if(!scheduleApp)scheduleApp=firebase.initializeApp(KHCG_SCHEDULE_CONFIG,'khcg-schedule');
        firebase.database(scheduleApp).ref('gyoha-guitar').on('value',snapshot=>{
          const data=snapshot.val()||{};
          khcgSchedule={ready:true,rehearsals:arrayValues(data.rehearsals),recitals:arrayValues(data.monthlyRecitals),error:false};
          syncRecitalDate();if(activeView==='recital')renderApp();
        },()=>{khcgSchedule.error=true;if(activeView==='recital')renderApp();});
      }
    }catch(error){console.warn('월례발표회 Firebase 연결 오류',error);}
  }
  async function saveRecitalToFirebase(){
    const key=monthKey(),item=ensureRecital();syncRecitalDate(key);saveRecitals();
    if(typeof db==='undefined'||!db?.collection||typeof auth==='undefined'||!auth?.currentUser||typeof isAdmin==='undefined'||!isAdmin){
      recitalCloud.error='Firebase 저장은 강좌 관리에서 운영자 로그인 후 사용할 수 있습니다';if(activeView==='recital')renderApp();return;
    }
    recitalCloud.saving=true;recitalCloud.error='';if(activeView==='recital')renderApp();
    try{
      await db.collection('monthlyRecitalPlans').doc(key).set({month:key,title:item.title,date:item.date,dateSource:item.dateSource||khcgRecitalDate(key).source,selectedPieces:recitalPieceSnapshots(item),checks:item.checks||{},notes:item.notes||'',performed:!!item.performed,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:auth.currentUser.email||auth.currentUser.uid},{merge:true});
    }catch(error){recitalCloud.error='Firebase 발표곡 저장에 실패했습니다';console.warn('월례발표회 저장 오류',error);}
    finally{recitalCloud.saving=false;if(activeView==='recital')renderApp();}
  }
  function normalizeRepertoire(){
    let changed=false;
    repertoire=repertoire.map(item=>{
      const member=memberInfo(memberIdFor(item));
      if(item.memberId===member.id&&item.memberName===member.name&&item.memberPart===member.part&&Array.isArray(item.attachments))return item;
      changed=true;
      return {...item,memberId:member.id,memberName:member.name,memberPart:member.part,attachments:Array.isArray(item.attachments)?item.attachments:[]};
    });
    if(changed) persist(KEYS.repertoire,repertoire);
  }

  function setupChrome(){
    const title=document.querySelector('.brand-txt h1');
    const sub=document.querySelector('.brand-txt p');
    if(title) title.textContent='교하성당 클래식기타반';
    if(sub) sub.textContent='나의 연습실';
    const managerBtn=document.querySelector('.head-right .mgr-link[onclick="showMgr()"]');
    const installBtn=document.getElementById('install-btn');
    if(managerBtn){managerBtn.innerHTML='⚙ <span>관리</span>';managerBtn.setAttribute('aria-label','강좌 관리');}
    if(installBtn){installBtn.innerHTML='📲 <span>설치</span>';installBtn.setAttribute('aria-label','앱 설치');}
    if(document.querySelector('.practice-nav')) return;
    const nav=document.createElement('nav');
    nav.className='practice-nav';
    nav.setAttribute('aria-label','주요 메뉴');
    nav.innerHTML=`<div class="practice-nav-in">
      <button class="practice-nav-btn active" data-view="today" onclick="setView('today')"><span class="practice-nav-ico">⌂</span><span>오늘</span></button>
      <button class="practice-nav-btn" data-view="repertoire" onclick="setView('repertoire')"><span class="practice-nav-ico">♬</span><span>레퍼토리</span></button>
      <button class="practice-nav-btn" data-view="recital" onclick="setView('recital')"><span class="practice-nav-ico">★</span><span>월례발표회</span></button>
      <button class="practice-nav-btn" data-view="lessons" onclick="setView('lessons')"><span class="practice-nav-ico">▤</span><span>강좌</span></button>
    </div>`;
    document.querySelector('header')?.after(nav);
  }
  function syncNav(){
    document.querySelectorAll('.practice-nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===activeView));
  }
  function updateHeader(){
    const pill=document.getElementById('progPill');
    if(!pill) return;
    const minutes=Number(logs[localKey()]?.minutes||0);
    pill.textContent=minutes?`오늘 ${minutes}분`:`연속 ${streak()}일`;
  }
  function showBoard(show){
    const board=document.getElementById('board-section');
    if(board) board.style.display=show?'block':'none';
  }
  function prepareHome(){
    document.getElementById('home').style.display='block';
    document.getElementById('detail').style.display='none';
    document.getElementById('mgr').style.display='none';
  }

  function renderApp(){
    syncNav(); updateHeader();
    if(activeView==='lessons'){
      showBoard(true);
      legacyRenderHome();
      updateHeader();
      return;
    }
    showBoard(false);
    const home=document.getElementById('home');
    if(!home) return;
    if(activeView==='repertoire') home.innerHTML=renderRepertoire();
    else if(activeView==='recital') home.innerHTML=renderRecital();
    else home.innerHTML=renderToday();
  }

  function renderToday(){
    const log=todayLog();
    const monthly=monthStats();
    const focus=currentFocus();
    const readyCount=repertoire.filter(r=>r.stage==='ready').length;
    const routine=[
      ['몸과 손 깨우기','5분','튜닝 후 개방현·크로매틱을 아주 천천히'],
      [focus?focus.title:'한 구절 집중','15분',focus?'어려운 2~4마디를 느리게 반복':'레퍼토리를 담으면 오늘의 집중곡이 표시됩니다'],
      ['무대처럼 한 번','10분','멈추지 않고 녹음하며 처음부터 끝까지']
    ];
    return `<div class="app-shell">
      <section class="today-hero">
        <div class="app-kicker">${html(dateLabel())} · DAILY PRACTICE</div>
        <h2 class="app-title">오늘도 기타와<br>가볍게 ${sessionMinutes}분</h2>
        <p class="app-subtitle">짧아도 매일 하는 연습이 곡을 무대 위 레퍼토리로 만듭니다.</p>
        <div class="hero-action">
          <div class="hero-minutes" aria-label="연습 시간 선택">
            ${[15,30,45].map(m=>`<button class="minute-chip${sessionMinutes===m?' active':''}" onclick="setSessionMinutes(${m})">${m}분</button>`).join('')}
          </div>
          <button class="primary-btn" onclick="finishPractice()">✓ 연습 기록 완료</button>
        </div>
      </section>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">연속 연습</div><div class="stat-value">${streak()}<small>일</small></div></div>
        <div class="stat-card"><div class="stat-label">이번 달</div><div class="stat-value">${monthly.minutes}<small>분</small></div></div>
        <div class="stat-card"><div class="stat-label">레퍼토리</div><div class="stat-value">${repertoire.length}<small>곡</small></div></div>
        <div class="stat-card"><div class="stat-label">발표 가능</div><div class="stat-value">${readyCount}<small>곡</small></div></div>
      </div>

      <div class="app-section-head"><div><h3 class="app-section-title">오늘의 3단계 루틴</h3><p class="app-section-note">완벽하게보다, 순서대로 끝내는 데 집중하세요.</p></div><span class="app-section-note">${log.blocks.filter(Boolean).length}/3 완료</span></div>
      <div class="routine-grid">
        ${routine.map((r,i)=>`<button class="routine-card${log.blocks[i]?' done':''}" onclick="toggleRoutine(${i})">
          <div class="routine-top"><span class="routine-number">0${i+1}</span><span class="routine-check">✓</span></div>
          <div class="routine-time">${r[1]}</div><div class="routine-title">${html(r[0])}</div><div class="routine-desc">${html(r[2])}</div>
        </button>`).join('')}
      </div>

      <div class="app-section-head"><div><h3 class="app-section-title">오늘의 집중곡</h3><p class="app-section-note">가장 오래 미룬 곡부터 자동으로 추천합니다.</p></div><button class="text-btn" onclick="setView('repertoire')">전체 보기 →</button></div>
      ${focus?renderFocus(focus):`<div class="empty-state"><div class="empty-icon">♬</div><div class="empty-title">첫 레퍼토리를 담아보세요</div><p class="empty-copy">직접 곡을 추가하거나 강좌의 레슨에서 ‘레퍼토리에 담기’를 누르면 매일 연습 루틴이 자동으로 만들어집니다.</p><button class="primary-btn" onclick="setView('repertoire');toggleAddForm()">＋ 첫 곡 추가</button></div>`}
    </div>`;
  }

  function renderFocus(item){
    const current=Number(item.currentBpm||40),target=Math.max(current,Number(item.targetBpm||80));
    const pct=Math.min(100,Math.round(current/target*100));
    return `<div class="focus-card"><div class="focus-main"><div class="focus-label">${html(stageLabel(item.stage))}</div><div class="focus-title">${html(item.title)}</div><div class="focus-meta">${html(item.composer||'작곡가 미입력')} · 최근 연습 ${item.lastPracticed?html(item.lastPracticed):'아직 없음'}</div><div class="focus-actions">${item.lessonId?`<button class="secondary-btn" onclick="openRepLesson('${item.lessonId}')">강좌 열기</button>`:''}<button class="secondary-btn" onclick="setView('repertoire')">기록 수정</button></div></div><div class="focus-progress"><div class="bpm-row"><strong class="bpm-value">${current}</strong><span class="bpm-label">/ 목표 ${target} BPM</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="app-section-note" style="margin-top:8px">속도 달성률 ${pct}%</div></div></div>`;
  }

  function renderRepertoire(){
    const filtered=repertoire.filter(r=>(repFilter==='all'||r.stage===repFilter)&&(activeMember==='all'||memberIdFor(r)===activeMember)).sort((a,b)=>(STAGES[a.stage]?.order||1)-(STAGES[b.stage]?.order||1));
    return `<div class="app-shell">
      <div class="app-kicker">ENSEMBLE REPERTOIRE</div><h2 class="app-title">단원별로, 한 곡씩 무대에</h2><p class="app-subtitle">기타반 실제 단원에게 곡을 배정하고, 사람별 연습·발표곡을 따로 관리하세요.</p>
      <div class="unit-filter-wrap"><div class="unit-filter-label">담당 단원</div><div class="filter-pills unit-pills">${[{id:'all',name:'전체 단원'},...memberOptions()].map(member=>{const count=member.id==='all'?repertoire.length:repertoire.filter(r=>memberIdFor(r)===member.id).length;return `<button class="filter-pill${activeMember===member.id?' active':''}" onclick="setMemberFilter('${member.id}')">${html(member.name)} ${count}</button>`;}).join('')}</div><a class="member-source-link" href="https://khmass-liturgy.github.io/khcg/" target="_blank" rel="noopener">기타반 단원 관리 열기 ↗</a></div>
      <div class="repertoire-toolbar"><div class="filter-pills">${[['all','전체'],['learning','익히는 중'],['polishing','다듬는 중'],['ready','발표 가능']].map(([key,label])=>`<button class="filter-pill${repFilter===key?' active':''}" onclick="setRepFilter('${key}')">${label} ${key==='all'?repertoire.length:repertoire.filter(r=>r.stage===key).length}</button>`).join('')}</div><button class="primary-btn" onclick="toggleAddForm()">＋ 곡 추가</button></div>
      ${showAddForm?`<form class="add-form" onsubmit="addManualRepertoire(event)"><div class="form-title">새 레퍼토리</div><div class="form-grid unit-add-grid"><div class="app-field"><label for="rep-title">곡명 *</label><input id="rep-title" required maxlength="80" placeholder="예: 로망스"></div><div class="app-field"><label for="rep-member">담당 단원</label><select id="rep-member">${memberOptionGroups(activeMember==='all'?'unassigned':activeMember)}</select></div><div class="app-field"><label for="rep-composer">작곡가</label><input id="rep-composer" maxlength="60" placeholder="예: Anonymous"></div><div class="app-field"><label for="rep-target">목표 BPM</label><input id="rep-target" type="number" min="20" max="240" value="80"></div><div class="app-field rep-file-field"><label for="rep-files">첨부 파일</label><input id="rep-files" type="file" multiple></div><button class="primary-btn" type="submit">저장</button></div></form>`:''}
      ${filtered.length?`<div class="repertoire-list">${filtered.map((item,i)=>renderRepCard(item,i)).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">♬</div><div class="empty-title">${repertoire.length?'이 단원에게 배정된 곡이 없습니다':'아직 담은 곡이 없습니다'}</div><p class="empty-copy">강좌에서 담은 곡은 먼저 담당 미지정으로 저장됩니다. 곡 카드에서 실제 기타반 단원을 지정해 주세요.</p><button class="primary-btn" onclick="toggleAddForm()">＋ 곡 추가</button></div>`}
    </div>`;
  }

  function renderRepCard(item,index){
    const attachments=Array.isArray(item.attachments)?item.attachments:[];
    return `<article class="rep-card"><div class="rep-card-top"><div class="rep-rank">${String(index+1).padStart(2,'0')}</div><div class="rep-info"><div class="rep-title">${html(item.title)}</div><div class="rep-composer"><span class="unit-chip">${html(memberLabel(item))}</span> <span class="member-part">${html(memberPart(item))}</span> ${html(item.composer||'')}</div></div><select class="stage-select" data-stage="${html(item.stage)}" aria-label="숙련 단계" onchange="updateRep('${item.id}','stage',this.value)">${Object.entries(STAGES).map(([k,v])=>`<option value="${k}"${item.stage===k?' selected':''}>${v.label}</option>`).join('')}</select></div>
      <div class="rep-controls"><div class="compact-field rep-unit-control"><label>담당 단원</label><select aria-label="담당 단원" onchange="updateRepMember('${item.id}',this.value)">${memberOptionGroups(memberIdFor(item))}</select></div><div class="compact-field"><label>현재 BPM</label><input type="number" min="20" max="240" value="${Number(item.currentBpm||40)}" onchange="updateRep('${item.id}','currentBpm',this.value)"></div><div class="compact-field"><label>목표 BPM</label><input type="number" min="20" max="240" value="${Number(item.targetBpm||80)}" onchange="updateRep('${item.id}','targetBpm',this.value)"></div></div>
      <textarea class="rep-note" maxlength="220" placeholder="다음 연습에서 고칠 한 가지" onchange="updateRep('${item.id}','note',this.value)">${html(item.note||'')}</textarea>
      <div class="attachment-box"><div class="attachment-head"><span>첨부 파일</span><label class="attachment-add">＋ 첨부<input type="file" multiple onchange="attachRepFiles('${item.id}',this)"></label></div><p class="attachment-help">악보·연습 녹음·참고 자료 · 파일당 12MB, 곡당 ${MAX_ATTACHMENTS_PER_PIECE}개</p>${attachments.length?`<ul class="attachment-list">${attachments.map(file=>`<li><button class="attachment-open" onclick="downloadRepAttachment('${file.id}')">${html(file.name)} <small>${fileSize(Number(file.size||0))}</small></button><button class="attachment-remove" aria-label="${html(file.name)} 삭제" onclick="removeRepAttachment('${item.id}','${file.id}')">×</button></li>`).join('')}</ul>`:`<div class="attachment-empty">아직 첨부한 파일이 없습니다.</div>`}</div>
      <div class="rep-actions"><button class="link-btn" onclick="chooseFocus('${item.id}')">◎ 오늘 집중곡</button><div>${item.lessonId?`<button class="link-btn" onclick="openRepLesson('${item.lessonId}')">강좌</button>`:''}<button class="link-btn" style="color:#a34c40;margin-left:10px" onclick="removeRep('${item.id}')">삭제</button></div></div></article>`;
  }

  function ensureRecital(){
    const key=monthKey(),now=new Date();
    if(!recitals[key]) recitals[key]={title:`${now.getMonth()+1}월 월례발표회`,date:fourthThursday(key),pieces:[],checks:{},notes:'',performed:false};
    syncRecitalDate(key);
    return recitals[key];
  }
  function renderRecital(){
    const item=ensureRecital(),key=monthKey(),diff=dayDiff(item.date);
    const selectedCount=(item.remotePieces?.length||item.pieces.length);
    const completed=CHECKS.filter(([id])=>item.checks?.[id]).length+(selectedCount>0?1:0);
    const readiness=Math.round(completed/(CHECKS.length+1)*100);
    const dday=diff>0?`D-${diff}`:diff===0?'D-DAY':`D+${Math.abs(diff)}`;
    return `<div class="app-shell"><div class="app-kicker">MONTHLY RECITAL</div><h2 class="app-title">매달 한 번, 연습을 무대로</h2><p class="app-subtitle">월례발표회가 곡의 마감일이 되어 줍니다. 이번 달에는 욕심내지 말고 1~2곡만 완주해보세요.</p>
      <div class="recital-layout"><section class="recital-card featured"><span class="month-badge">★ ${html(key.replace('-','.'))} 월례발표회</span><div class="recital-name">${html(item.title)}</div><div class="recital-date">${html(item.date)} · ${html(item.dateSource||'교하성당 월례발표회 계획')}</div><div class="countdown"><strong>${dday}</strong><span>${item.performed?'발표를 완료했습니다':'무대까지 남은 시간'}</span></div><div class="readiness"><div class="readiness-top"><span>준비도</span><strong>${readiness}%</strong></div><div class="readiness-track"><div class="readiness-fill" style="width:${readiness}%"></div></div></div></section>
      <section class="recital-card"><div class="form-title">발표회 설정</div><div class="recital-fields"><div class="app-field"><label>발표회 이름</label><input value="${html(item.title)}" maxlength="60" onchange="updateRecital('title',this.value)"></div><div class="app-field"><label>발표일</label><div class="synced-date">${html(item.date)}<small>${html(item.dateSource||'교하성당 월례발표회 계획')} 기준</small></div></div></div><div class="form-title" style="margin-top:21px">준비 체크</div><div class="check-list"><label class="check-row"><input type="checkbox" ${selectedCount?'checked':''} disabled><span>발표곡 1곡 이상 선택</span></label>${CHECKS.map(([id,label])=>`<label class="check-row"><input type="checkbox" ${item.checks?.[id]?'checked':''} onchange="toggleRecitalCheck('${id}',this.checked)"><span>${label}</span></label>`).join('')}</div></section></div>
      <div class="app-section-head"><div><h3 class="app-section-title">이번 달 발표곡</h3><p class="app-section-note">선택 내용은 Firebase에 공용 발표 계획으로 저장됩니다.</p></div><span class="app-section-note">${selectedCount}곡 선택</span></div>
      ${repertoire.length?`<div class="repertoire-list">${repertoire.map(r=>`<label class="recital-piece"><input type="checkbox" ${item.pieces.includes(r.id)?'checked':''} onchange="toggleRecitalPiece('${r.id}',this.checked)"><div class="recital-piece-info"><div class="recital-piece-title">${html(r.title)}</div><div class="recital-piece-sub">${html(memberLabel(r))} · ${html(memberPart(r))} · ${html(stageLabel(r.stage))} · ${Number(r.currentBpm||40)}/${Number(r.targetBpm||80)} BPM</div></div></label>`).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">★</div><div class="empty-title">먼저 발표할 곡을 준비해보세요</div><p class="empty-copy">레퍼토리에 곡을 추가하면 이번 달 발표곡으로 선택할 수 있습니다.</p><button class="primary-btn" onclick="setView('repertoire');toggleAddForm()">레퍼토리 추가</button></div>`}
      <div class="app-section-head"><div><h3 class="app-section-title">발표 후 한 줄 회고</h3><p class="app-section-note">잘한 점 하나와 다음 달에 바꿀 점 하나면 충분합니다.</p></div></div><div class="add-form"><div class="app-field"><textarea rows="4" maxlength="500" placeholder="예: 긴장했지만 끝까지 멈추지 않았다. 다음 달에는 템포를 조금 낮춰 준비하자." onchange="updateRecital('notes',this.value)">${html(item.notes||'')}</textarea></div><div class="recital-save-row"><span class="firebase-status">${recitalCloud.saving?'Firebase에 저장 중…':recitalCloud.error||'Firebase 공용 발표 계획'}</span><button class="${item.performed?'secondary-btn':'primary-btn'}" onclick="togglePerformed()">${item.performed?'✓ 발표 완료됨':'발표 완료로 기록'}</button></div></div>
    </div>`;
  }

  function saveRepertoire(){persist(KEYS.repertoire,repertoire);}
  function saveLogs(){persist(KEYS.logs,logs);}
  function saveRecitals(){persist(KEYS.recitals,recitals);}
  async function attachFilesToRepertoire(repId,files){
    const item=repertoire.find(entry=>entry.id===repId);
    if(!item||!files.length)return;
    const existing=Array.isArray(item.attachments)?item.attachments:[];
    const candidates=files.slice(0,Math.max(0,MAX_ATTACHMENTS_PER_PIECE-existing.length));
    if(!candidates.length){toast(`곡당 파일은 ${MAX_ATTACHMENTS_PER_PIECE}개까지 첨부할 수 있습니다`);return;}
    const oversized=candidates.filter(file=>Number(file.size||0)>MAX_ATTACHMENT_BYTES);
    const valid=candidates.filter(file=>Number(file.size||0)<=MAX_ATTACHMENT_BYTES);
    if(oversized.length)toast(`12MB를 넘는 파일 ${oversized.length}개는 제외했습니다`);
    if(!valid.length)return;
    const added=[];
    for(const file of valid){
      try{added.push(await saveAttachment(repId,file));}
      catch(error){toast('파일 보관 공간이 부족하거나 저장에 실패했습니다');break;}
    }
    if(!added.length)return;
    item.attachments=[...existing,...added];saveRepertoire();renderApp();toast(`${added.length}개 파일을 첨부했습니다`);
  }
  window.attachRepFiles=async function(repId,input){
    const files=Array.from(input?.files||[]);if(input)input.value='';
    await attachFilesToRepertoire(repId,files);
  };
  window.downloadRepAttachment=async function(id){
    try{
      const file=await getAttachment(id);
      if(!file?.blob){toast('이 기기에서 찾을 수 없는 파일입니다');return;}
      const url=URL.createObjectURL(file.blob),link=document.createElement('a');
      link.href=url;link.download=file.name||'attachment';link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){toast('첨부 파일을 열 수 없습니다');}
  };
  window.removeRepAttachment=async function(repId,id){
    const item=repertoire.find(entry=>entry.id===repId),file=item?.attachments?.find(entry=>entry.id===id);
    if(!item||!file||!confirm(`“${file.name}” 파일을 삭제할까요?`))return;
    try{await deleteAttachment(id);item.attachments=item.attachments.filter(entry=>entry.id!==id);saveRepertoire();renderApp();toast('첨부 파일을 삭제했습니다');}
    catch(error){toast('첨부 파일 삭제에 실패했습니다');}
  };
  function toast(message){
    document.querySelector('.save-toast')?.remove();
    const el=document.createElement('div');el.className='save-toast';el.textContent=message;document.body.appendChild(el);
    setTimeout(()=>el.remove(),1900);
  }

  window.setView=function(view){
    if(!['today','repertoire','recital','lessons'].includes(view)) return;
    activeView=view;prepareHome();renderApp();window.scrollTo({top:0,behavior:'smooth'});
  };
  window.renderHome=renderApp;
  window.updateProg=updateHeader;
  window.setSessionMinutes=function(minutes){sessionMinutes=minutes;renderApp();};
  window.toggleRoutine=function(index){const log=todayLog();log.blocks[index]=!log.blocks[index];log.updatedAt=new Date().toISOString();saveLogs();renderApp();};
  window.finishPractice=function(){
    const log=todayLog();log.minutes=Number(log.minutes||0)+sessionMinutes;log.blocks=[true,true,true];log.updatedAt=new Date().toISOString();
    const focus=currentFocus();
    if(focus){focus.lastPracticed=localKey();focus.totalMinutes=Number(focus.totalMinutes||0)+sessionMinutes;log.pieces=[...new Set([...(log.pieces||[]),focus.id])];saveRepertoire();}
    saveLogs();renderApp();toast(`${sessionMinutes}분 연습을 기록했습니다`);
  };
  window.setRepFilter=function(filter){repFilter=filter;renderApp();};
  window.setMemberFilter=function(memberId){
    activeMember=memberId;
    renderApp();
  };
  window.toggleAddForm=function(){showAddForm=!showAddForm;renderApp();setTimeout(()=>document.getElementById('rep-title')?.focus(),50);};
  window.addManualRepertoire=async function(event){
    event.preventDefault();
    const title=document.getElementById('rep-title')?.value.trim();if(!title)return;
    const files=Array.from(document.getElementById('rep-files')?.files||[]);
    const member=memberInfo(document.getElementById('rep-member')?.value||'unassigned');
    const item={id:'rep_'+Date.now().toString(36),title,composer:document.getElementById('rep-composer')?.value.trim()||'',memberId:member.id,memberName:member.name,memberPart:member.part,attachments:[],stage:'learning',currentBpm:40,targetBpm:Number(document.getElementById('rep-target')?.value||80),note:'',addedAt:localKey(),lastPracticed:''};
    repertoire.unshift(item);
    saveRepertoire();showAddForm=false;renderApp();toast('레퍼토리에 곡을 추가했습니다');
    await attachFilesToRepertoire(item.id,files);
  };
  window.updateRep=function(id,field,value){
    const allowed=['stage','currentBpm','targetBpm','note'];if(!allowed.includes(field))return;
    const item=repertoire.find(r=>r.id===id);if(!item)return;
    item[field]=['currentBpm','targetBpm'].includes(field)?Math.max(20,Math.min(240,Number(value)||40)):value;
    saveRepertoire();if(field==='stage')renderApp();else toast('변경 내용을 저장했습니다');
  };
  window.updateRepMember=function(id,memberId){
    const item=repertoire.find(r=>r.id===id),member=memberInfo(memberId);if(!item)return;
    item.memberId=member.id;item.memberName=member.name;item.memberPart=member.part;
    activeMember=member.id;saveRepertoire();renderApp();toast(`${member.name} 단원에게 배정했습니다`);
  };
  window.chooseFocus=function(id){focusId=id;localStorage.setItem(KEYS.focus,id);toast('오늘의 집중곡으로 지정했습니다');};
  window.removeRep=function(id){
    const item=repertoire.find(r=>r.id===id);if(!item||!confirm(`“${item.title}”을 레퍼토리에서 삭제할까요?\n연습 일지와 강좌 자료는 삭제되지 않습니다.`))return;
    (item.attachments||[]).forEach(file=>deleteAttachment(file.id).catch(()=>{}));
    repertoire=repertoire.filter(r=>r.id!==id);Object.values(recitals).forEach(r=>r.pieces=(r.pieces||[]).filter(pid=>pid!==id));saveRepertoire();saveRecitals();renderApp();
  };
  window.addLessonToRepertoire=function(lid){
    const lesson=lessonById(lid);if(!lesson)return;
    const existing=repertoire.find(r=>r.lessonId===lid);
    if(existing){chooseFocus(existing.id);return;}
    const item={id:'rep_'+Date.now().toString(36),lessonId:lid,title:lesson.title,composer:'',memberId:'unassigned',memberName:'담당 미지정',memberPart:'미지정',attachments:[],stage:'learning',currentBpm:40,targetBpm:80,note:'',addedAt:localKey(),lastPracticed:''};
    repertoire.unshift(item);saveRepertoire();focusId=item.id;localStorage.setItem(KEYS.focus,item.id);injectLessonButton(lid);updateHeader();toast('레퍼토리에 담았습니다');
  };
  window.openRepLesson=function(lid){activeView='lessons';syncNav();legacyOpenLesson(lid);showBoard(false);injectLessonButton(lid);window.scrollTo(0,0);};
  window.updateRecital=function(field,value){const allowed=['title','notes'];if(!allowed.includes(field))return;ensureRecital()[field]=value;saveRecitals();saveRecitalToFirebase();if(field!=='notes')renderApp();else toast('회고를 저장했습니다');};
  window.toggleRecitalCheck=function(id,checked){ensureRecital().checks[id]=checked;saveRecitals();saveRecitalToFirebase();renderApp();};
  window.toggleRecitalPiece=function(id,checked){const item=ensureRecital();item.pieces=checked?[...new Set([...item.pieces,id])]:item.pieces.filter(pid=>pid!==id);item.remotePieces=recitalPieceSnapshots(item);saveRecitals();saveRecitalToFirebase();renderApp();};
  window.togglePerformed=function(){const item=ensureRecital();item.performed=!item.performed;saveRecitals();saveRecitalToFirebase();renderApp();toast(item.performed?'월례발표회를 완료했습니다':'완료 표시를 취소했습니다');};

  function injectLessonButton(lid){
    const head=document.querySelector('.dcard-head');if(!head)return;
    head.querySelector('.lesson-rep-action')?.remove();
    const saved=isSavedLesson(lid),btn=document.createElement('button');
    btn.className='lesson-rep-action'+(saved?' saved':'');
    btn.textContent=saved?'✓ 레퍼토리에 담긴 곡':'＋ 레퍼토리에 담기';
    btn.onclick=()=>addLessonToRepertoire(lid);head.appendChild(btn);
  }
  window.openLesson=function(lid){activeView='lessons';syncNav();legacyOpenLesson(lid);showBoard(false);injectLessonButton(lid);};

  normalizeRepertoire();
  setupChrome();
  initRecitalCloud();
  renderApp();
})();
