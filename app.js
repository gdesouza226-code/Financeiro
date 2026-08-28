(()=>{
const $ = (id) => document.getElementById(id);
const money = (v=0) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v)||0);
const today = new Date().toISOString().slice(0,10);

let currentUser = null;
let movements = [];
let goals = [];

function toast(message, error=false){
  const div=document.createElement("div");
  div.className="toast-msg"+(error?" error":"");
  div.textContent=message;
  $("toast").appendChild(div);
  setTimeout(()=>div.remove(),3500);
}

function setAuthTab(tab){
  const login = tab === "login";
  $("tabLogin").classList.toggle("active", login);
  $("tabSignup").classList.toggle("active", !login);
  $("loginForm").classList.toggle("hidden", !login);
  $("signupForm").classList.toggle("hidden", login);
}

$("tabLogin").onclick=()=>setAuthTab("login");
$("tabSignup").onclick=()=>setAuthTab("signup");

if (!window.supabase) {
  toast("Falha ao carregar a biblioteca do Supabase. Atualize a página.", true);
  throw new Error("Supabase JS não carregou");
}
if (!window.SUPABASE_CONFIG?.url || !window.SUPABASE_CONFIG?.anonKey) {
  toast("Configuração do Supabase não encontrada.", true);
  throw new Error("Configuração do Supabase ausente");
}
const supabase = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);

$("loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const { error } = await supabase.auth.signInWithPassword({
    email:$("loginEmail").value.trim(),
    password:$("loginPassword").value
  });
  if(error) return toast(error.message,true);
  toast("Login realizado.");
});

$("signupForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const name=$("signupName").value.trim();
  const { data, error }=await supabase.auth.signUp({
    email:$("signupEmail").value.trim(),
    password:$("signupPassword").value,
    options:{data:{name}}
  });
  if(error) return toast(error.message,true);
  if(data.user && !data.session) toast("Conta criada. Verifique seu e-mail para confirmar o cadastro.");
  else toast("Conta criada com sucesso.");
});

$("logoutBtn").onclick=async()=>{ await supabase.auth.signOut(); };

supabase.auth.onAuthStateChange((_event, session)=>{
  currentUser=session?.user || null;
  renderAuthState();
});

async function renderAuthState(){
  const logged=!!currentUser;
  $("authView").classList.toggle("hidden",logged);
  $("appView").classList.toggle("hidden",!logged);
  if(!logged) return;
  $("userEmail").textContent=currentUser.email || "";
  $("profileEmail").textContent=currentUser.email || "";
  $("profileName").textContent=currentUser.user_metadata?.name || "Não informado";
  $("movementDate").value=today;
  $("filterMonth").value=new Date().toISOString().slice(0,7);
  await refreshAll();
}

document.querySelectorAll(".nav-btn").forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const target=btn.dataset.view;
    document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
    $(target+"View").classList.remove("hidden");
    const map={
      dashboard:["Visão geral","Acompanhe sua vida financeira em tempo real."],
      movements:["Movimentações","Consulte receitas, despesas e comprovantes."],
      goals:["Metas","Organize seus objetivos financeiros."],
      profile:["Minha conta","Dados do seu acesso pessoal."]
    };
    $("pageTitle").textContent=map[target][0];
    $("pageSubtitle").textContent=map[target][1];
    $("newMovementBtn").classList.toggle("hidden",target==="profile");
  };
});

$("newMovementBtn").onclick=()=>$("movementDialog").showModal();
$("closeDialog").onclick=()=>$("movementDialog").close();

$("movementForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  if(!currentUser) return;

  const btn=e.submitter;
  btn.disabled=true;
  btn.textContent="Salvando...";

  try{
    const type=document.querySelector('input[name="movementType"]:checked').value;
    const amount=Number($("movementAmount").value);
    const file=$("movementReceipt").files[0];
    let receiptPath=null;

    if(file){
      const ext=file.name.split(".").pop().toLowerCase();
      const safeName=`${Date.now()}-${crypto.randomUUID()}.${ext}`;
      receiptPath=`${currentUser.id}/${safeName}`;
      const { error:uploadError }=await supabase.storage.from("receipts").upload(receiptPath,file,{upsert:false});
      if(uploadError) throw uploadError;
    }

    const payload={
      user_id:currentUser.id,
      type,
      amount,
      description:$("movementDescription").value.trim(),
      category:$("movementCategory").value,
      movement_date:$("movementDate").value,
      notes:$("movementNotes").value.trim() || null,
      receipt_path:receiptPath
    };

    const { error }=await supabase.from("transactions").insert(payload);
    if(error) throw error;

    $("movementForm").reset();
    $("movementDate").value=today;
    document.querySelector('input[name="movementType"][value="expense"]').checked=true;
    $("movementDialog").close();
    toast("Movimentação salva.");
    await refreshAll();
  }catch(err){
    toast(err.message || "Não foi possível salvar.",true);
  }finally{
    btn.disabled=false;
    btn.textContent="Salvar movimentação";
  }
});

$("goalForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const { error }=await supabase.from("goals").insert({
    user_id:currentUser.id,
    name:$("goalName").value.trim(),
    target_amount:Number($("goalTarget").value),
    current_amount:Number($("goalCurrent").value),
    target_date:$("goalDate").value || null
  });
  if(error) return toast(error.message,true);
  $("goalForm").reset();
  $("goalCurrent").value="0";
  toast("Meta criada.");
  await loadGoals();
});

$("filterType").onchange=renderMovements;
$("filterMonth").onchange=renderMovements;

async function refreshAll(){
  await Promise.all([loadMovements(),loadGoals()]);
}

async function loadMovements(){
  const { data, error }=await supabase.from("transactions").select("*").order("movement_date",{ascending:false}).order("created_at",{ascending:false});
  if(error) return toast(error.message,true);
  movements=data || [];
  renderDashboard();
  renderMovements();
}

async function loadGoals(){
  const { data, error }=await supabase.from("goals").select("*").order("created_at",{ascending:false});
  if(error) return toast(error.message,true);
  goals=data || [];
  renderGoals();
}

function renderDashboard(){
  const month=new Date().toISOString().slice(0,7);
  const monthItems=movements.filter(m=>m.movement_date?.slice(0,7)===month);
  const totalIncome=movements.filter(m=>m.type==="income").reduce((s,m)=>s+Number(m.amount),0);
  const totalExpense=movements.filter(m=>m.type==="expense").reduce((s,m)=>s+Number(m.amount),0);
  const monthIncome=monthItems.filter(m=>m.type==="income").reduce((s,m)=>s+Number(m.amount),0);
  const monthExpense=monthItems.filter(m=>m.type==="expense").reduce((s,m)=>s+Number(m.amount),0);

  $("balanceValue").textContent=money(totalIncome-totalExpense);
  $("incomeValue").textContent=money(monthIncome);
  $("expenseValue").textContent=money(monthExpense);
  $("savingsValue").textContent=money(monthIncome-monthExpense);

  const recent=movements.slice(0,6);
  $("recentList").innerHTML=recent.length?recent.map(m=>movementHtml(m)).join(""):'<div class="empty">Nenhuma movimentação ainda.</div>';

  const cats={};
  monthItems.filter(m=>m.type==="expense").forEach(m=>cats[m.category]=(cats[m.category]||0)+Number(m.amount));
  const entries=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  $("categoryList").innerHTML=entries.length?entries.map(([cat,val])=>`
    <div class="item">
      <div class="item-main"><div class="item-title">${escapeHtml(cat)}</div></div>
      <div class="item-value expense">${money(val)}</div>
    </div>`).join(""):'<div class="empty">Sem despesas neste mês.</div>';
}

function renderMovements(){
  let data=[...movements];
  const type=$("filterType").value;
  const month=$("filterMonth").value;
  if(type) data=data.filter(m=>m.type===type);
  if(month) data=data.filter(m=>m.movement_date?.slice(0,7)===month);
  $("movementList").innerHTML=data.length?data.map(m=>movementHtml(m,true)).join(""):'<div class="empty">Nenhuma movimentação encontrada.</div>';
  document.querySelectorAll("[data-receipt]").forEach(btn=>{
    btn.onclick=()=>openReceipt(btn.dataset.receipt);
  });
  document.querySelectorAll("[data-delete-transaction]").forEach(btn=>{
    btn.onclick=()=>deleteTransaction(btn.dataset.deleteTransaction);
  });
}

function movementHtml(m, actions=false){
  const sign=m.type==="income"?"+":"-";
  const date=new Date(m.movement_date+"T12:00:00").toLocaleDateString("pt-BR");
  return `<div class="item">
    <div class="item-main">
      <div class="item-title">${escapeHtml(m.description)} <span class="badge">${escapeHtml(m.category)}</span></div>
      <div class="item-meta">${date}${m.notes?" • "+escapeHtml(m.notes):""}</div>
      ${actions?`<div class="item-meta">
        ${m.receipt_path?`<button class="ghost" data-receipt="${m.receipt_path}">Ver comprovante</button>`:""}
        <button class="ghost" data-delete-transaction="${m.id}">Excluir</button>
      </div>`:""}
    </div>
    <div class="item-value ${m.type}">${sign} ${money(m.amount)}</div>
  </div>`;
}

async function openReceipt(path){
  const { data, error }=await supabase.storage.from("receipts").createSignedUrl(path,60);
  if(error) return toast(error.message,true);
  window.open(data.signedUrl,"_blank","noopener,noreferrer");
}

async function deleteTransaction(id){
  const item=movements.find(m=>String(m.id)===String(id));
  if(!confirm("Excluir esta movimentação?")) return;
  if(item?.receipt_path){
    await supabase.storage.from("receipts").remove([item.receipt_path]);
  }
  const { error }=await supabase.from("transactions").delete().eq("id",id);
  if(error) return toast(error.message,true);
  toast("Movimentação excluída.");
  await loadMovements();
}

function renderGoals(){
  $("goalList").innerHTML=goals.length?goals.map(g=>{
    const pct=Math.min(100,Math.round((Number(g.current_amount)/Math.max(1,Number(g.target_amount)))*100));
    return `<div class="goal">
      <div class="goal-head">
        <strong>${escapeHtml(g.name)}</strong>
        <span>${pct}%</span>
      </div>
      <div class="item-meta">${money(g.current_amount)} de ${money(g.target_amount)}${g.target_date?" • até "+new Date(g.target_date+"T12:00:00").toLocaleDateString("pt-BR"):""}</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </div>`;
  }).join(""):'<div class="empty">Nenhuma meta cadastrada.</div>';
}

function escapeHtml(value=""){
  return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

async function initApp(){
  try{
    const { data, error } = await supabase.auth.getSession();
    if(error) throw error;
    currentUser = data?.session?.user || null;
    await renderAuthState();
  }catch(err){
    console.error("Erro ao iniciar o aplicativo:", err);
    toast("Não foi possível conectar ao Supabase. Atualize a página e tente novamente.", true);
  }
}

initApp();

})();
