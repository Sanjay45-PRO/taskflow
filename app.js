/* ---------------- State ---------------- */
let session = null; // {role, name, email, team}
let tasks = [];
let currentFilter = 'all';
let employeeNames = [];
let realtimeChannel = null;

/* ---------------- Init ---------------- */
window.addEventListener('DOMContentLoaded', async () => {
  wireLoginScreen();
  wireAppScreen();
  registerServiceWorker();

  const saved = localStorage.getItem('taskflow-session');
  if (saved) {
    session = JSON.parse(saved);
    await enterApp();
  }
});

/* ---------------- Login screen ---------------- */
let loginStage = 'initial'; // initial | needPassword | needItPassword | needManagerSetup
let loginRole = 'employee'; // employee | manager — set by the tabs on the login screen

function wireLoginScreen(){
  document.getElementById('loginBtn').addEventListener('click', handleLoginContinue);
  document.getElementById('tabEmployee').addEventListener('click', () => setLoginRole('employee'));
  document.getElementById('tabManager').addEventListener('click', () => setLoginRole('manager'));
}

function setLoginRole(role){
  loginRole = role;
  document.getElementById('tabEmployee').classList.toggle('active', role === 'employee');
  document.getElementById('tabManager').classList.toggle('active', role === 'manager');
  resetLoginStage();
}

async function handleLoginContinue(){
  const name = document.getElementById('loginName').value.trim();
  const team = document.getElementById('teamCode').value.trim().toLowerCase();
  const hint = document.getElementById('loginHint');

  if (!name || !team){
    alert('Please enter your name and a team/workspace code.');
    return;
  }

  if (loginStage === 'needPassword'){
    const password = document.getElementById('loginPassword').value;
    if (!password){ alert('Please enter the manager password.'); return; }
    const { data, error } = await supabaseClient.rpc('verify_manager', { p_team: team, p_name: name, p_password: password });
    if (error || !data){
      alert('Incorrect manager password.');
      return;
    }
    session = { role: 'manager', name, email: '', team };
    localStorage.setItem('taskflow-session', JSON.stringify(session));
    await enterApp();
    return;
  }

  if (loginStage === 'needItPassword'){
    const password = document.getElementById('loginItPassword').value;
    if (!password){ alert('Please enter the IT support password.'); return; }
    const { data, error } = await supabaseClient.rpc('verify_it_support', { p_team: team, p_name: name, p_password: password });
    if (error || !data){
      alert('Incorrect IT support password.');
      return;
    }
    session = { role: 'it_support', name, email: '', team };
    localStorage.setItem('taskflow-session', JSON.stringify(session));
    await enterApp();
    return;
  }

  if (loginStage === 'needManagerSetup'){
    const password = document.getElementById('newManagerPassword').value;
    const email = document.getElementById('newManagerEmail').value.trim();
    if (!password || password.length < 4){ alert('Choose a password at least 4 characters long.'); return; }
    const { data, error } = await supabaseClient.rpc('register_manager', { p_team: team, p_name: name, p_password: password, p_email: email || null });
    if (error || !data){
      alert('Could not set up the manager account. Someone may have just registered — try logging in again.');
      resetLoginStage();
      return;
    }
    session = { role: 'manager', name, email, team };
    localStorage.setItem('taskflow-session', JSON.stringify(session));
    await enterApp();
    return;
  }

  // initial lookup
  const { data: existing } = await supabaseClient
    .from('members').select('*').eq('team', team).eq('name', name).maybeSingle();

  if (loginRole === 'employee'){
    if (existing && existing.role === 'employee'){
      session = { role: 'employee', name, email: existing.email || '', team };
      localStorage.setItem('taskflow-session', JSON.stringify(session));
      await enterApp();
      return;
    }
    if (existing && existing.role === 'manager'){
      hint.textContent = 'This name is registered as a manager for this workspace — switch to the Manager tab above.';
      return;
    }
    if (existing && existing.role === 'it_support'){
      loginStage = 'needItPassword';
      document.getElementById('itPasswordField').classList.remove('hidden');
      hint.textContent = 'Enter the IT support password to continue.';
      return;
    }
    hint.textContent = "No employee with that name was found in this workspace. Ask your manager to add you first.";
    return;
  }

  // loginRole === 'manager'
  if (existing && existing.role === 'manager'){
    loginStage = 'needPassword';
    document.getElementById('passwordField').classList.remove('hidden');
    hint.textContent = 'Enter your manager password to continue.';
    return;
  }

  if (existing && (existing.role === 'employee' || existing.role === 'it_support')){
    hint.textContent = `This name is already registered as ${existing.role === 'employee' ? 'an employee' : 'IT support'} in this workspace — switch to the Employee tab above.`;
    return;
  }

  // no manager found under this name — check if this team already has a manager under another name
  const { count } = await supabaseClient
    .from('members').select('*', { count: 'exact', head: true }).eq('team', team).eq('role', 'manager');

  if (count && count > 0){
    hint.textContent = "This team already has a manager registered under a different name. Check the name and try again.";
    return;
  }

  loginStage = 'needManagerSetup';
  document.getElementById('newManagerFields').classList.remove('hidden');
  hint.textContent = 'Set a manager password to finish setting up this workspace.';
}

function resetLoginStage(){
  loginStage = 'initial';
  document.getElementById('passwordField').classList.add('hidden');
  document.getElementById('itPasswordField').classList.add('hidden');
  document.getElementById('newManagerFields').classList.add('hidden');
  document.getElementById('loginHint').textContent = loginRole === 'manager'
    ? "Enter your name and workspace code. If you're already the manager, you'll be asked for your password."
    : "Enter your name and workspace code. If your manager has already added you, you'll go straight to your tasks.";
}

/* ---------------- Enter app ---------------- */
async function enterApp(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');

  document.getElementById('whoLabel').textContent = session.name + (session.role === 'manager' ? ' · Manager' : ' · Employee');
  document.getElementById('avatarInit').textContent = session.name.trim()[0].toUpperCase();

  if (session.role === 'manager'){
    document.getElementById('managerView').classList.remove('hidden');
    document.getElementById('employeeView').classList.add('hidden');
    document.getElementById('itSupportView').classList.add('hidden');
    document.getElementById('mgrTeamName').textContent = session.team;
  } else if (session.role === 'it_support'){
    document.getElementById('itSupportView').classList.remove('hidden');
    document.getElementById('managerView').classList.add('hidden');
    document.getElementById('employeeView').classList.add('hidden');
    document.getElementById('itTeamName').textContent = session.team;
  } else {
    document.getElementById('employeeView').classList.remove('hidden');
    document.getElementById('managerView').classList.add('hidden');
    document.getElementById('itSupportView').classList.add('hidden');
    document.getElementById('empTeamName').textContent = session.team;
  }

  await logLogin();
  await loadTasksOnce();
  listenToTasks();
  setupNotificationBanner();
  await setupPush();
  if (session.role === 'manager') {
    loadUsageStats(); loadEmployeeOptions();
    wireNewManagerSections();
    loadAttendance(); loadLiveMap(); loadClaims(); loadOnDuty(); loadDevices();
  }
  if (session.role === 'it_support') { await loadTicketsOnce(); listenToTickets(); }
}

/* ---------------- Supabase helpers ---------------- */
function memberKey(){ return session.name.trim().toLowerCase(); }

async function loadEmployeeOptions(){
  const { data } = await supabaseClient
    .from('members').select('name, email_sent_count').eq('team', session.team).eq('role', 'employee').order('name');
  employeeNames = (data || []).map(m => m.name);
  const select = document.getElementById('taskAssignee');
  select.innerHTML = '<option value="">Select an employee…</option>' +
    employeeNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

  const listPanel = document.getElementById('employeeListPanel');
  if (!employeeNames.length){
    listPanel.innerHTML = '';
  } else {
    listPanel.innerHTML = (data || []).map(m => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
        <span class="assignee-chip"><span class="dotc"></span>${escapeHtml(m.name)}</span>
        <div style="display:flex;align-items:center;gap:10px;">
          <span title="Reminder emails sent to this person" style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:5px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
            ${m.email_sent_count || 0} sent
          </span>
          <button class="icon-btn" onclick="removeEmployee('${escapeHtml(m.name).replace(/'/g,"\\'")}')" title="Remove employee"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg></button>
        </div>
      </div>
    `).join('');
  }
  renderManagerAll();
}

async function removeEmployee(name){
  if (!confirm(`Remove ${name} completely? They will no longer be able to log in, and their existing tasks will stay assigned to their name but become unclaimed.`)) return;
  const { error } = await supabaseClient.from('members').delete()
    .eq('team', session.team).eq('name', name).eq('role', 'employee');
  if (error){ console.error('remove employee failed', error); alert('Could not remove employee.'); return; }
  await loadEmployeeOptions();
  await loadUsageStats();
}

async function addEmployee(){
  const name = document.getElementById('newEmpName').value.trim();
  const email = document.getElementById('newEmpEmail').value.trim();
  if (!name){ alert('Please enter the employee\'s name.'); return; }
  const { data, error } = await supabaseClient.rpc('add_employee', {
    p_team: session.team, p_name: name, p_email: email || null
  });
  if (error || !data){
    console.error('add employee failed', error);
    alert('Could not add employee. Check the browser console for details.');
    return;
  }
  document.getElementById('newEmpName').value = '';
  document.getElementById('newEmpEmail').value = '';
  await loadEmployeeOptions();
  await loadUsageStats();
}

async function logLogin(){
  await supabaseClient.from('login_log').insert({
    team: session.team,
    name: session.name,
    role: session.role
  });
}

async function loadTasksOnce(){
  const { data, error } = await supabaseClient
    .from('tasks').select('*').eq('team', session.team);
  if (error) { console.error('load tasks failed', error); return; }
  tasks = data || [];
  render();
}

function listenToTasks(){
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient
    .channel('tasks-' + session.team)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `team=eq.${session.team}` },
      () => loadTasksOnce())
    .subscribe();
}

/* ---------------- Top bar / logout ---------------- */
function wireAppScreen(){
  const doLogout = () => {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    session = null;
    localStorage.removeItem('taskflow-session');
    resetLoginStage();
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
  };
  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  const sideLogout = document.getElementById('logoutBtnSide');
  if (sideLogout) sideLogout.addEventListener('click', doLogout);

  document.querySelectorAll('.side-nav a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelectorAll('.side-nav a').forEach(a => a.classList.remove('active'));
      link.classList.add('active');
    });
  });

  const notifBell = document.getElementById('notifBell');
  if (notifBell) notifBell.addEventListener('click', () => {
    const list = document.getElementById('mgrTaskList') || document.getElementById('empTaskList');
    if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('addEmployeeBtn').addEventListener('click', addEmployee);

  document.getElementById('cancelReport').addEventListener('click', () => {
    document.getElementById('reportModal').classList.add('hidden');
    document.getElementById('reportFile').value = '';
    document.getElementById('reportFileName').textContent = '';
    document.getElementById('reportPhoto').value = '';
    document.getElementById('reportPhotoName').textContent = '';
    document.getElementById('reportPhotoPreview').classList.add('hidden');
    document.getElementById('reportPhotoPreview').src = '';
    pendingDoneTaskId = null;
  });
  document.getElementById('confirmReport').addEventListener('click', submitCompletionReport);

  function isExcelFile(file){
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.xls') || name.endsWith('.xlsx');
  }

  function clearExcelSelection(){
    document.getElementById('reportFile').value = '';
    document.getElementById('reportFileName').innerHTML = '';
  }
  function clearPhotoSelection(){
    document.getElementById('reportPhoto').value = '';
    document.getElementById('reportPhotoName').innerHTML = '';
    document.getElementById('reportPhotoPreview').classList.add('hidden');
    document.getElementById('reportPhotoPreview').src = '';
  }

  function renderFileChip(){
    const fileInput = document.getElementById('reportFile');
    const nameBox = document.getElementById('reportFileName');
    const f = fileInput.files && fileInput.files[0];
    if (!f){ nameBox.innerHTML = ''; return; }
    if (!isExcelFile(f)){
      alert('Only Excel files (.xls or .xlsx) are allowed as attachments.');
      fileInput.value = '';
      nameBox.innerHTML = '';
      return;
    }
    clearPhotoSelection(); // mutually exclusive — picking Excel clears any chosen photo
    nameBox.innerHTML = `<span class="file-chip">📎 ${escapeHtml(f.name)} (${(f.size/1024).toFixed(0)} KB) <button type="button" id="removeReportFile">✕</button></span>`;
    document.getElementById('removeReportFile').addEventListener('click', clearExcelSelection);
  }

  function renderPhotoChip(){
    const photoInput = document.getElementById('reportPhoto');
    const nameBox = document.getElementById('reportPhotoName');
    const preview = document.getElementById('reportPhotoPreview');
    const f = photoInput.files && photoInput.files[0];
    if (!f){ nameBox.innerHTML = ''; preview.classList.add('hidden'); return; }
    if (!f.type || !f.type.startsWith('image/')){
      alert('Only image files are allowed as a photo attachment.');
      photoInput.value = '';
      nameBox.innerHTML = '';
      return;
    }
    clearExcelSelection(); // mutually exclusive — picking a photo clears any chosen Excel file
    nameBox.innerHTML = `<span class="file-chip">📷 ${escapeHtml(f.name)} (${(f.size/1024).toFixed(0)} KB) <button type="button" id="removeReportPhoto">✕</button></span>`;
    document.getElementById('removeReportPhoto').addEventListener('click', clearPhotoSelection);
    const reader = new FileReader();
    reader.onload = (e) => { preview.src = e.target.result; preview.classList.remove('hidden'); };
    reader.readAsDataURL(f);
  }

  document.getElementById('reportFile').addEventListener('change', renderFileChip);
  document.getElementById('reportPhoto').addEventListener('change', renderPhotoChip);

  const dropzone = document.getElementById('reportDropzone');
  if (dropzone){
    ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); dropzone.classList.add('dragover');
    }));
    ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); dropzone.classList.remove('dragover');
    }));
    dropzone.addEventListener('drop', (e) => {
      const dropped = e.dataTransfer.files;
      if (dropped && dropped.length){
        if (!isExcelFile(dropped[0])){
          alert('Only Excel files (.xls or .xlsx) are allowed as attachments.');
          return;
        }
        document.getElementById('reportFile').files = dropped;
        renderFileChip();
      }
    });
  }

  const photoDropzone = document.getElementById('reportPhotoDropzone');
  if (photoDropzone){
    ['dragenter','dragover'].forEach(evt => photoDropzone.addEventListener(evt, (e) => {
      e.preventDefault(); photoDropzone.classList.add('dragover');
    }));
    ['dragleave','drop'].forEach(evt => photoDropzone.addEventListener(evt, (e) => {
      e.preventDefault(); photoDropzone.classList.remove('dragover');
    }));
    photoDropzone.addEventListener('drop', (e) => {
      const dropped = e.dataTransfer.files;
      if (dropped && dropped.length){
        if (!dropped[0].type || !dropped[0].type.startsWith('image/')){
          alert('Only image files are allowed as a photo attachment.');
          return;
        }
        document.getElementById('reportPhoto').files = dropped;
        renderPhotoChip();
      }
    });
  }


  document.getElementById('raiseTicketFab').addEventListener('click', () => {
    document.getElementById('ticketModal').classList.remove('hidden');
  });
  document.getElementById('cancelTicket').addEventListener('click', closeTicketModal);
  document.getElementById('confirmTicket').addEventListener('click', submitTicket);

  document.getElementById('setItSupportBtn').addEventListener('click', setItSupport);
  const changeBtn = document.getElementById('changeItSupportBtn');
  if (changeBtn) changeBtn.addEventListener('click', () => {
    document.getElementById('itSupportStatus').classList.add('hidden');
    document.getElementById('itSupportForm').style.display = 'flex';
  });

  document.querySelectorAll('#itSupportView .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#itSupportView .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ticketFilter = chip.dataset.tf;
      renderTickets();
    });
  });

  document.getElementById('enableNotifBtn').addEventListener('click', () => setupPush(true));

  document.getElementById('openAssignModal').addEventListener('click', () => {
    document.getElementById('assignModal').classList.remove('hidden');
  });
  document.getElementById('cancelAssign').addEventListener('click', closeAssignModal);
  document.getElementById('confirmAssign').addEventListener('click', assignTask);

  document.getElementById('openBulkAssignModal').addEventListener('click', () => {
    renderBulkEmployeeCheckboxes();
    document.getElementById('bulkAssignModal').classList.remove('hidden');
  });
  document.getElementById('cancelBulkAssign').addEventListener('click', closeBulkAssignModal);
  document.getElementById('confirmBulkAssign').addEventListener('click', bulkAssignTask);

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.f;
      renderManagerTasks();
    });
  });
}

function closeAssignModal(){
  document.getElementById('assignModal').classList.add('hidden');
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDesc').value = '';
  document.getElementById('taskAssignee').value = '';
  document.getElementById('taskDue').value = '';
}

async function assignTask(){
  const title = document.getElementById('taskTitle').value.trim();
  const desc = document.getElementById('taskDesc').value.trim();
  const assignee = document.getElementById('taskAssignee').value.trim();
  const due = document.getElementById('taskDue').value;
  if (!title || !assignee){
    alert('Please enter a task title and who it is assigned to.');
    return;
  }
  if (!due){
    alert('Please set a due date for this task — it is required.');
    return;
  }
  await supabaseClient.from('tasks').insert({
    team: session.team,
    title, description: desc, assignee,
    due,
    status: 'pending',
    created_by: session.name
  });
  closeAssignModal();
}

/* ---------------- Bulk task assignment (additive feature) ---------------- */

function renderBulkEmployeeCheckboxes(){
  const container = document.getElementById('bulkEmployeeCheckboxes');
  if (!employeeNames.length){
    container.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted);margin:0;">Add employees first — none found yet.</p>';
    return;
  }
  container.innerHTML = employeeNames.map(name => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13.5px;font-weight:500;color:var(--text);text-transform:none;">
      <input type="checkbox" class="bulk-emp-check" value="${escapeHtml(name)}" style="width:16px;height:16px;" />
      ${escapeHtml(name)}
    </label>
  `).join('');
}

function closeBulkAssignModal(){
  document.getElementById('bulkAssignModal').classList.add('hidden');
  document.getElementById('bulkTaskTitle').value = '';
  document.getElementById('bulkTaskDesc').value = '';
  document.getElementById('bulkTaskDue').value = '';
  document.getElementById('bulkTaskPriority').value = 'Medium';
}

async function bulkAssignTask(){
  const title = document.getElementById('bulkTaskTitle').value.trim();
  const desc = document.getElementById('bulkTaskDesc').value.trim();
  const due = document.getElementById('bulkTaskDue').value;
  const priority = document.getElementById('bulkTaskPriority').value;
  const selected = Array.from(document.querySelectorAll('.bulk-emp-check:checked')).map(cb => cb.value);

  if (!title){ alert('Please enter a task title.'); return; }
  if (!selected.length){ alert('Please select at least one employee.'); return; }
  if (!due){ alert('Please set a due date for this task — it is required.'); return; }

  const batch_id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const rows = selected.map(assignee => ({
    team: session.team,
    title, description: desc, assignee,
    due,
    status: 'pending',
    created_by: session.name,
    batch_id,
    priority
  }));

  const { error } = await supabaseClient.from('tasks').insert(rows);
  if (error){
    console.error('bulk assign failed', error);
    alert('Could not create the bulk tasks. Please try again.');
    return;
  }
  closeBulkAssignModal();
}

function renderBulkMarksheet(){
  const container = document.getElementById('bulkMarksheet');
  const batches = {};
  tasks.forEach(t => {
    if (!t.batch_id) return;
    batches[t.batch_id] = batches[t.batch_id] || [];
    batches[t.batch_id].push(t);
  });
  const batchIds = Object.keys(batches);
  if (!batchIds.length){
    container.innerHTML = '<div class="empty-state">No bulk tasks assigned yet.</div>';
    return;
  }

  container.innerHTML = batchIds.map(bid => {
    const rows = batches[bid].slice().sort((a,b) => a.assignee.localeCompare(b.assignee));
    const first = rows[0];
    const doneCount = rows.filter(r => r.status === 'done').length;
    const rowsHtml = rows.map(r => `
      <tr>
        <td style="padding:8px 10px;border-top:1px solid var(--border);font-weight:600;color:var(--text);">${escapeHtml(r.assignee)}</td>
        <td style="padding:8px 10px;border-top:1px solid var(--border);">${taskBadge(r)}</td>
        <td style="padding:8px 10px;border-top:1px solid var(--border);font-size:12.5px;color:var(--text-muted);">${r.status === 'done' ? formatDuration(r.created_at, r.completed_at) : '—'}</td>
        <td style="padding:8px 10px;border-top:1px solid var(--border);font-size:12.5px;">
          ${r.status === 'done' && r.attachment_url ? `<a href="${r.attachment_url}" target="_blank" rel="noopener" style="color:var(--primary-dark);font-weight:600;text-decoration:none;">📎 file</a>` : '—'}
        </td>
      </tr>
    `).join('');

    return `
      <div style="border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:600;color:var(--text);font-size:14.5px;">${escapeHtml(first.title)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${rows.length} people assigned · ${doneCount}/${rows.length} completed${first.due ? ` · Due ${formatDate(first.due)}` : ''}</div>
          </div>
          <span class="badge ${ticketBadgeClass ? ticketBadgeClass(first.priority) : ''}" style="background:#EEF2F6;color:var(--text-muted);">${escapeHtml(first.priority || 'Medium')}</span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="text-align:left;color:var(--text-muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;">
                <th style="padding:6px 10px;">Employee</th>
                <th style="padding:6px 10px;">Status</th>
                <th style="padding:6px 10px;">Time taken</th>
                <th style="padding:6px 10px;">Attachment</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

let pendingDoneTaskId = null;

async function markDone(taskId){
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;

  if (t.status === 'done'){
    // undo completion
    await supabaseClient.from('tasks').update({
      status: 'pending', completed_at: null, report: null,
      report_attachment_url: null, report_attachment_name: null
    }).eq('id', taskId);
    await loadTasksOnce();
    return;
  }

  pendingDoneTaskId = taskId;
  document.getElementById('reportText').value = '';
  document.getElementById('reportFile').value = '';
  document.getElementById('reportFileName').textContent = '';
  document.getElementById('reportPhoto').value = '';
  document.getElementById('reportPhotoName').textContent = '';
  document.getElementById('reportPhotoPreview').classList.add('hidden');
  document.getElementById('reportPhotoPreview').src = '';
  document.getElementById('reportModal').classList.remove('hidden');
}

const REPORT_ATTACHMENTS_BUCKET = 'task-attachments';

async function submitCompletionReport(){
  const report = document.getElementById('reportText').value.trim();
  if (!report){ alert('Please write a short completion report before marking this done.'); return; }

  const fileInput = document.getElementById('reportFile');
  const photoInput = document.getElementById('reportPhoto');
  const excelFile = fileInput.files && fileInput.files[0];
  const photoFile = photoInput.files && photoInput.files[0];
  const file = excelFile || photoFile; // mutually exclusive — only one can be set at a time
  const confirmBtn = document.getElementById('confirmReport');

  let attachmentUrl = null;
  let attachmentName = null;

  if (file){
    const isPhoto = !!photoFile;
    if (!isPhoto){
      const nameLower = (file.name || '').toLowerCase();
      if (!nameLower.endsWith('.xls') && !nameLower.endsWith('.xlsx')){
        alert('Only Excel files (.xls or .xlsx) are allowed as attachments. Please choose a different file.');
        return;
      }
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Uploading…';
    const path = `${session.team}/${pendingDoneTaskId}-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabaseClient.storage
      .from(REPORT_ATTACHMENTS_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });

    if (uploadError){
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Mark done';
      alert('Could not upload the file: ' + uploadError.message + '\n\nYou can still mark this done without an attachment, or try a different file.');
      return;
    }

    const { data: publicUrlData } = supabaseClient.storage
      .from(REPORT_ATTACHMENTS_BUCKET)
      .getPublicUrl(path);
    attachmentUrl = publicUrlData.publicUrl;
    attachmentName = file.name;
  }

  await supabaseClient.from('tasks').update({
    status: 'done',
    completed_at: new Date().toISOString(),
    report,
    report_attachment_url: attachmentUrl,
    report_attachment_name: attachmentName
  }).eq('id', pendingDoneTaskId);

  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Mark done';
  document.getElementById('reportModal').classList.add('hidden');
  pendingDoneTaskId = null;
  await loadTasksOnce();
}

async function deleteTask(taskId){
  await supabaseClient.from('tasks').delete().eq('id', taskId);
}

/* ---------------- Rendering ---------------- */
function isOverdue(t){
  if (t.status === 'done' || !t.due) return false;
  return new Date(t.due + 'T23:59:59') < new Date();
}

function render(){
  if (!session) return;
  if (session.role === 'manager') renderManagerAll();
  else renderEmployee();
}

/* ---------------- Pending-work banner ---------------- */
function overdueBannerKey(scope){
  const today = new Date().toISOString().slice(0,10);
  return `tf_overdue_dismissed_${scope}_${session.team}_${session.name}_${today}`;
}

function renderOverdueBanner(elId, scope, overdueCount, dueSoonCount){
  const el = document.getElementById(elId);
  if (!el) return;
  if (!overdueCount && !dueSoonCount){ el.innerHTML = ''; return; }
  if (sessionStorage.getItem(overdueBannerKey(scope)) === '1'){ el.innerHTML = ''; return; }

  const parts = [];
  if (overdueCount) parts.push(`<b>${overdueCount} overdue task${overdueCount === 1 ? '' : 's'}</b>`);
  if (dueSoonCount) parts.push(`${dueSoonCount} due in the next 24 hours`);
  const message = scope === 'manager'
    ? `Your team has ${parts.join(' and ')}. Check in before they slip further.`
    : `You have ${parts.join(' and ')}. Clear these first.`;

  el.innerHTML = `
    <div class="overdue-banner">
      <div class="ob-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/></svg></div>
      <div class="ob-text">${message}</div>
      <button class="ob-close" id="${elId}Close" title="Dismiss for today">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  document.getElementById(`${elId}Close`).addEventListener('click', () => {
    sessionStorage.setItem(overdueBannerKey(scope), '1');
    el.innerHTML = '';
  });
}

function isDueSoon(t){
  if (!t.due || t.status === 'done') return false;
  const due = new Date(t.due + 'T23:59:59');
  const now = new Date();
  const hrs = (due - now) / 36e5;
  return hrs >= 0 && hrs <= 24;
}

function taskBadge(t){
  if (t.status === 'done') return '<span class="badge done">Completed</span>';
  if (isOverdue(t)) return '<span class="badge overdue">Overdue</span>';
  return '<span class="badge pending">In progress</span>';
}

function renderManagerAll(){
  refreshItSupportStatus();
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const overdue = tasks.filter(isOverdue).length;
  const pending = total - done;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statOverdue').textContent = overdue;
  updateNotifBadge(pending);
  renderOverdueBanner('mgrOverdueBanner', 'manager', overdue, tasks.filter(isDueSoon).length);

  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById('ringPct').textContent = pct + '%';
  const circumference = 238.7;
  document.getElementById('ringProgress').style.strokeDashoffset = circumference - (circumference*pct/100);

  renderPriorityChart();

  const byEmp = {};
  employeeNames.forEach(name => { byEmp[name] = { total: 0, done: 0 }; });
  tasks.forEach(t => {
    byEmp[t.assignee] = byEmp[t.assignee] || {total:0, done:0};
    byEmp[t.assignee].total++;
    if (t.status === 'done') byEmp[t.assignee].done++;
  });
  const empKeys = Object.keys(byEmp);
  const empDiv = document.getElementById('byEmployee');
  if (!empKeys.length){
    empDiv.innerHTML = '<div class="empty-state"><i class="ti ti-users"></i><p>No employees yet — add one above to get started.</p></div>';
  } else {
    empDiv.innerHTML = empKeys.map(name => {
      const d = byEmp[name];
      const p = d.total ? Math.round((d.done/d.total)*100) : 0;
      return `<div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:5px;">
          <span style="font-weight:600;color:var(--text);">${escapeHtml(name)}</span>
          <span style="color:var(--text-muted);">${d.total ? `${d.done}/${d.total} done` : 'No tasks yet'}</span>
        </div>
        <div style="height:7px;background:#EEF2F6;border-radius:20px;overflow:hidden;">
          <div style="height:100%;width:${p}%;background:var(--primary);"></div>
        </div>
      </div>`;
    }).join('');
  }

  renderManagerTasks();
  renderBulkMarksheet();
}

function renderManagerTasks(){
  let list = tasks.slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if (currentFilter === 'pending') list = list.filter(t => t.status !== 'done' && !isOverdue(t));
  if (currentFilter === 'done') list = list.filter(t => t.status === 'done');
  if (currentFilter === 'overdue') list = list.filter(isOverdue);

  const container = document.getElementById('mgrTaskList');
  if (!list.length){
    container.innerHTML = '<div class="empty-state"><i class="ti ti-clipboard-off"></i><p>No tasks in this view.</p></div>';
    return;
  }

  const rows = list.map(t => `
    <tr>
      <td>
        <div style="font-weight:600;color:var(--text);">${escapeHtml(t.title)}</div>
        ${t.status === 'done' && t.report ? `<div style="font-size:12px;color:var(--text-muted);margin-top:3px;">${escapeHtml(t.report)}</div>` : ''}
        ${t.status === 'done' && t.report_attachment_url ? `<a href="${t.report_attachment_url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--primary);margin-top:4px;text-decoration:none;font-weight:600;"><i class="ti ti-paperclip"></i>${escapeHtml(t.report_attachment_name || 'View attachment')}</a>` : ''}
      </td>
      <td><span class="assignee-chip"><span class="dotc"></span>${escapeHtml(t.assignee)}</span></td>
      <td><span class="priority-dot ${escapeHtml(t.priority || 'Medium')}"></span>${escapeHtml(t.priority || 'Medium')}</td>
      <td>${t.due ? formatDate(t.due) : '—'}</td>
      <td>${taskBadge(t)}${t.status === 'done' ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;">Took ${formatDuration(t.created_at, t.completed_at)}</div>` : ''}</td>
      <td><button class="icon-btn" onclick="deleteTask('${t.id}')" title="Delete task"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg></button></td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="task-table">
        <thead>
          <tr><th>Task Name</th><th>Employee</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderEmployee(){
  const mine = tasks.filter(t => t.assignee.trim().toLowerCase() === session.name.trim().toLowerCase());
  const done = mine.filter(t => t.status === 'done').length;
  document.getElementById('empStatPending').textContent = mine.length - done;
  document.getElementById('empStatDone').textContent = done;
  updateNotifBadge(mine.length - done);
  renderOverdueBanner('empOverdueBanner', 'employee', mine.filter(isOverdue).length, mine.filter(isDueSoon).length);

  const container = document.getElementById('empTaskList');
  if (!mine.length){
    container.innerHTML = '<div class="empty-state"><i class="ti ti-clipboard-off"></i><p>No tasks assigned to you yet.</p></div>';
    return;
  }
  const sorted = mine.slice().sort((a,b) => (a.status==='done')-(b.status==='done') || new Date(a.created_at)-new Date(b.created_at));
  container.innerHTML = sorted.map(t => `
    <div class="task-item">
      <div>
        <div class="t-title">${escapeHtml(t.title)}</div>
        ${t.description ? `<div style="font-size:13px;color:var(--text-muted);margin-top:3px;">${escapeHtml(t.description)}</div>` : ''}
        <div class="t-meta">
          ${taskBadge(t)}
          ${t.due ? `<span><i class="ti ti-calendar"></i> Due ${formatDate(t.due)}</span>` : ''}
          <span><i class="ti ti-user-shield"></i> From ${escapeHtml(t.created_by)}</span>
        </div>
        ${t.status === 'done' && t.report ? `<div style="font-size:13px;color:var(--text-muted);margin-top:6px;padding:8px 10px;background:#F4F6F8;border-radius:8px;"><i class="ti ti-file-text" style="margin-right:5px;"></i>${escapeHtml(t.report)}</div>` : ''}
        ${t.status === 'done' && t.report_attachment_url ? `<a href="${t.report_attachment_url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--primary);margin-top:6px;text-decoration:none;font-weight:600;"><i class="ti ti-paperclip"></i>${escapeHtml(t.report_attachment_name || 'View attachment')}</a>` : ''}
      </div>
      <div class="task-actions">
        <button class="btn-sm ${t.status==='done' ? '' : 'btn-teal'}" onclick="markDone('${t.id}')">
          ${t.status === 'done' ? 'Mark as not done' : 'Mark done'}
        </button>
      </div>
    </div>
  `).join('');
}

/* ---------------- Attendance (manager only) ---------------- */
async function loadAttendance(){
  const dateInput = document.getElementById('attendanceDate');
  if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  const date = dateInput.value;

  const { data: members } = await supabaseClient
    .from('members').select('name').eq('team', session.team).eq('role', 'employee').order('name');
  const { data: att } = await supabaseClient
    .from('attendance').select('*').eq('team', session.team).eq('work_date', date);

  const container = document.getElementById('attendanceList');
  if (!members || !members.length){
    container.innerHTML = '<div class="empty-state">No employees yet.</div>';
    return;
  }
  const byName = {};
  (att || []).forEach(a => { byName[a.employee_name] = a; });

  container.innerHTML = members.map(m => {
    const a = byName[m.name];
    const checkedIn = a && a.check_in_at;
    const checkedOut = a && a.check_out_at;
    let hours = '';
    if (checkedIn && checkedOut){
      const h = (new Date(a.check_out_at) - new Date(a.check_in_at)) / 36e5;
      hours = `${h.toFixed(1)} hrs`;
    }
    return `
      <div class="task-item">
        <div>
          <div class="t-title">${escapeHtml(m.name)}</div>
          <div class="t-meta">
            <span><i class="ti ti-login"></i> ${checkedIn ? new Date(a.check_in_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'Not checked in'}</span>
            ${checkedOut ? `<span><i class="ti ti-logout"></i> ${new Date(a.check_out_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>` : ''}
            ${hours ? `<span><i class="ti ti-clock"></i> ${hours}</span>` : ''}
          </div>
        </div>
        <span class="badge ${checkedIn ? (checkedOut ? 'done' : 'progress') : 'overdue'}">
          ${checkedIn ? (checkedOut ? 'Checked out' : 'Checked in') : 'Absent'}
        </span>
      </div>
    `;
  }).join('');
}

/* ---------------- Live Map (manager only) — free OpenStreetMap/Leaflet ---------------- */
let liveMapInstance = null;
const MAP_COLORS = ['#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#7C3AED', '#0FA3B1', '#EC4899', '#64748B'];

function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function haversineMeters(lat1, lon1, lat2, lon2){
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}

// Groups consecutive GPS points that stay within a small radius (GPS jitter tolerance)
// for at least `stopThresholdMin` minutes into a single "stop". Returns a cleaned point
// list (jitter collapsed to one representative point per stop, so it doesn't get counted
// as fake distance) plus the list of detected stops for display.
function detectStops(pts, stopThresholdMin = 15, radiusMeters = 40){
  const stops = [];
  const cleaned = [];
  let i = 0;
  while (i < pts.length){
    let j = i;
    while (j + 1 < pts.length &&
           haversineMeters(pts[i].latitude, pts[i].longitude, pts[j+1].latitude, pts[j+1].longitude) <= radiusMeters){
      j++;
    }
    const cluster = pts.slice(i, j + 1);
    const durationMin = (new Date(cluster[cluster.length - 1].recorded_at) - new Date(cluster[0].recorded_at)) / 60000;

    if (durationMin >= stopThresholdMin && cluster.length > 1){
      const avgLat = cluster.reduce((s, p) => s + p.latitude, 0) / cluster.length;
      const avgLng = cluster.reduce((s, p) => s + p.longitude, 0) / cluster.length;
      stops.push({ start: cluster[0].recorded_at, end: cluster[cluster.length - 1].recorded_at, durationMin, lat: avgLat, lng: avgLng });
      cleaned.push({ latitude: avgLat, longitude: avgLng, recorded_at: cluster[0].recorded_at });
    } else {
      cluster.forEach(p => cleaned.push(p));
    }
    i = j + 1;
  }
  return { cleaned, stops };
}

// Snaps raw GPS points onto actual roads using OSRM's free public routing service.
// Falls back to the raw straight-line points if the request fails or times out.
async function snapToRoads(latlngs){
  if (latlngs.length < 2) return latlngs;
  let sample = latlngs;
  if (sample.length > 100){
    const step = Math.ceil(sample.length / 100);
    sample = latlngs.filter((_, i) => i % step === 0 || i === latlngs.length - 1);
  }
  const coordStr = sample.map(([lat, lng]) => `${lng},${lat}`).join(';');
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]){
      return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    }
  } catch (e) {
    console.warn('Road snapping unavailable, showing direct path instead', e);
  }
  return latlngs;
}

let liveMapAutoRefresh = null;

async function loadLiveMap(){
  const dateInput = document.getElementById('mapDate');
  if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  const date = dateInput.value;
  const isToday = date === new Date().toISOString().slice(0, 10);
  const startTs = `${date}T00:00:00Z`;
  const endTs = `${date}T23:59:59Z`;

  const { data: points } = await supabaseClient
    .from('location_logs').select('*').eq('team', session.team)
    .gte('recorded_at', startTs).lte('recorded_at', endTs)
    .order('recorded_at', { ascending: true });

  const { data: attRows } = await supabaseClient
    .from('attendance').select('*').eq('team', session.team).eq('work_date', date);
  const attByName = {};
  (attRows || []).forEach(a => { attByName[a.employee_name] = a; });

  const legendEl = document.getElementById('mapLegend');
  const statsEl = document.getElementById('mapStats');

  if (!liveMapInstance){
    liveMapInstance = L.map('liveMap').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 19, subdomains: 'abcd'
    }).addTo(liveMapInstance);
  }
  liveMapInstance.eachLayer(layer => { if (layer instanceof L.Polyline || layer instanceof L.CircleMarker || layer instanceof L.Marker) liveMapInstance.removeLayer(layer); });

  if (!points || !points.length){
    legendEl.innerHTML = isToday ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--danger);"><span style="width:7px;height:7px;border-radius:50%;background:var(--danger);animation:pulseLive 1.5s infinite;"></span>LIVE · updates every 30s</span>` : '';
    statsEl.innerHTML = '<div class="empty-state">No location data for this day yet.</div>';
    if (liveMapAutoRefresh) clearInterval(liveMapAutoRefresh);
    if (isToday) liveMapAutoRefresh = setInterval(loadLiveMap, 30000);
    return;
  }

  const byPerson = {};
  points.forEach(p => { (byPerson[p.employee_name] = byPerson[p.employee_name] || []).push(p); });
  const names = Object.keys(byPerson);
  const allBounds = [];

  legendEl.innerHTML = names.map((name, i) => `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);">
      <span style="width:10px;height:10px;border-radius:50%;background:${MAP_COLORS[i % MAP_COLORS.length]};display:inline-block;"></span>
      ${escapeHtml(name)}
    </span>
  `).join('') + (isToday ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--danger);margin-left:auto;"><span style="width:7px;height:7px;border-radius:50%;background:var(--danger);animation:pulseLive 1.5s infinite;"></span>LIVE · updates every 30s</span>` : '');

  const statRows = [];
  for (let i = 0; i < names.length; i++){
    const name = names[i];
    const rawPts = byPerson[name];
    const { cleaned: pts, stops } = detectStops(rawPts, 15, 40);
    const latlngs = pts.map(p => [p.latitude, p.longitude]);
    const color = MAP_COLORS[i % MAP_COLORS.length];

    const roadPath = await snapToRoads(latlngs);
    L.polyline(roadPath, { color, weight: 4, opacity: 0.8 }).addTo(liveMapInstance);

    const startIcon = L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:#16A34A;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`, iconSize: [16,16], iconAnchor: [8,8] });
    const endIcon = L.divIcon({ className: '', html: `<div style="width:16px;height:16px;border-radius:50%;background:#DC2626;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`, iconSize: [16,16], iconAnchor: [8,8] });
    L.marker(latlngs[0], { icon: startIcon }).bindTooltip(`${name} — start`).addTo(liveMapInstance);
    if (latlngs.length > 1) L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).bindTooltip(`${name} — latest`).addTo(liveMapInstance);
    allBounds.push(...latlngs);

    // Stop markers — small orange dots wherever they stayed put for 15+ min
    const timeFmtShort = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    stops.forEach(s => {
      const stopIcon = L.divIcon({ className: '', html: `<div style="width:14px;height:14px;border-radius:4px;background:#F59E0B;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`, iconSize: [14,14], iconAnchor: [7,7] });
      L.marker([s.lat, s.lng], { icon: stopIcon }).bindTooltip(`${name} — stopped ${Math.round(s.durationMin)} min (${timeFmtShort(s.start)}–${timeFmtShort(s.end)})`).addTo(liveMapInstance);
    });

    let distanceKm = 0;
    for (let j = 1; j < pts.length; j++){
      distanceKm += haversineKm(pts[j-1].latitude, pts[j-1].longitude, pts[j].latitude, pts[j].longitude);
    }

    // Prefer actual check-in/check-out times over first/last GPS ping, so this matches attendance exactly
    const att = attByName[name];
    const checkIn = att && att.check_in_at ? new Date(att.check_in_at) : new Date(pts[0].recorded_at);
    const checkOut = att && att.check_out_at ? new Date(att.check_out_at) : new Date(pts[pts.length - 1].recorded_at);
    const activeHrs = Math.max(0, (checkOut - checkIn) / 36e5);
    const timeFmt = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    statRows.push(`
      <div class="task-item">
        <div>
          <div class="t-title"><span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;margin-right:7px;"></span>${escapeHtml(name)}</div>
          <div class="t-meta">
            <span><i class="ti ti-login"></i> ${timeFmt(checkIn)}${att && att.check_out_at ? ` → ${timeFmt(checkOut)}` : ' (still checked in)'}</span>
            <span><i class="ti ti-route"></i> ${distanceKm.toFixed(1)} km total</span>
            <span><i class="ti ti-clock"></i> ${activeHrs.toFixed(1)} hrs</span>
            <span><i class="ti ti-map-pin"></i> ${rawPts.length} points logged</span>
          </div>
          ${stops.length ? `
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">
              ${stops.map(s => `
                <div style="font-size:12px;color:#92400E;background:rgba(245,158,11,0.1);padding:4px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:5px;width:fit-content;">
                  <i class="ti ti-square-rounded"></i> Stopped ${Math.round(s.durationMin)} min (${timeFmtShort(s.start)}–${timeFmtShort(s.end)})
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `);
  }
  statsEl.innerHTML = statRows.join('');

  if (allBounds.length) liveMapInstance.fitBounds(allBounds, { padding: [30, 30] });
  setTimeout(() => liveMapInstance.invalidateSize(), 200);

  if (liveMapAutoRefresh) clearInterval(liveMapAutoRefresh);
  if (isToday){
    liveMapAutoRefresh = setInterval(loadLiveMap, 30000);
  }
}

/* ---------------- Expense claims (manager only) ---------------- */
let claimFilter = 'pending';

async function loadClaims(){
  // Fetch ALL claims for the totals summary (independent of the current filter)
  const { data: allClaims } = await supabaseClient.from('expense_claims').select('*').eq('team', session.team);
  renderClaimTotals(allClaims || []);

  const approvedByPerson = {};
  (allClaims || []).filter(c => c.status === 'approved').forEach(c => {
    approvedByPerson[c.employee_name] = (approvedByPerson[c.employee_name] || 0) + Number(c.amount);
  });

  let query = supabaseClient.from('expense_claims').select('*').eq('team', session.team)
    .order('submitted_at', { ascending: false });
  if (claimFilter !== 'all') query = query.eq('status', claimFilter);
  const { data } = await query;

  const container = document.getElementById('claimsList');
  if (!data || !data.length){
    container.innerHTML = '<div class="empty-state">No claims here.</div>';
    return;
  }
  container.innerHTML = data.map(c => {
    const personTotal = approvedByPerson[c.employee_name] || 0;
    return `
    <div class="task-item" style="align-items:flex-start;">
      ${c.receipt_url ? `
        <a href="${c.receipt_url}" target="_blank" rel="noopener" style="flex-shrink:0;margin-right:14px;">
          <img src="${c.receipt_url}" alt="Receipt" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
          <div style="display:none;width:72px;height:72px;border-radius:8px;border:1px solid var(--border);align-items:center;justify-content:center;font-size:11px;color:var(--text-muted);text-align:center;">File</div>
        </a>
      ` : `<div style="flex-shrink:0;margin-right:14px;width:72px;height:72px;border-radius:8px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:10.5px;color:var(--text-muted);text-align:center;padding:4px;">No receipt</div>`}
      <div style="flex:1;">
        <div class="t-title">
          ${escapeHtml(c.employee_name)} — ₹${Number(c.amount).toFixed(2)}
          <span style="font-weight:400;color:var(--text-muted);font-size:12.5px;text-transform:capitalize;">(${escapeHtml(c.category)})</span>
        </div>
        <div style="font-size:12px;color:var(--success);font-weight:600;margin-top:2px;">
          <i class="ti ti-report-money"></i> Total approved for ${escapeHtml(c.employee_name)}: ₹${personTotal.toFixed(2)}
        </div>
        <div class="t-meta">
          <span><i class="ti ti-calendar"></i> ${new Date(c.submitted_at).toLocaleDateString()}</span>
          ${c.note ? `<span>${escapeHtml(c.note)}</span>` : ''}
        </div>
        ${c.status === 'rejected' && c.rejection_reason ? `<div style="margin-top:6px;font-size:12.5px;color:var(--danger);background:rgba(239,68,68,0.08);padding:6px 10px;border-radius:6px;display:inline-block;"><i class="ti ti-message-circle"></i> ${escapeHtml(c.rejection_reason)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
        <span class="badge ${c.status === 'approved' ? 'done' : c.status === 'rejected' ? 'overdue' : 'progress'}">${c.status}</span>
        ${c.receipt_url ? `<a href="${c.receipt_url}" target="_blank" rel="noopener" class="btn-sm" style="text-decoration:none;text-align:center;">View</a>` : ''}
        ${c.status === 'pending' ? `
          <button class="btn-sm" onclick="reviewClaim('${c.id}','rejected')">Reject</button>
          <button class="btn-sm btn-teal" onclick="reviewClaim('${c.id}','approved')">Approve</button>
        ` : ''}
      </div>
    </div>
  `;
  }).join('');
}

function renderClaimTotals(claims){
  const el = document.getElementById('claimTotals');
  if (!el) return;
  if (!claims.length){ el.innerHTML = ''; return; }

  const approved = claims.filter(c => c.status === 'approved');
  const pending = claims.filter(c => c.status === 'pending');
  const approvedTotal = approved.reduce((sum, c) => sum + Number(c.amount), 0);
  const pendingTotal = pending.reduce((sum, c) => sum + Number(c.amount), 0);

  const byPerson = {};
  approved.forEach(c => { byPerson[c.employee_name] = (byPerson[c.employee_name] || 0) + Number(c.amount); });
  const personRows = Object.entries(byPerson).sort((a, b) => b[1] - a[1]);

  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="flex:1;min-width:140px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 14px;">
        <div style="font-size:11px;color:#166534;font-weight:600;">APPROVED TOTAL</div>
        <div style="font-size:20px;font-weight:700;color:#166534;">₹${approvedTotal.toFixed(2)}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 14px;">
        <div style="font-size:11px;color:#92400E;font-weight:600;">PENDING TOTAL</div>
        <div style="font-size:20px;font-weight:700;color:#92400E;">₹${pendingTotal.toFixed(2)}</div>
      </div>
    </div>
    ${personRows.length ? `
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">APPROVED BY EMPLOYEE</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        ${personRows.map(([name, total]) => `
          <span style="font-size:12.5px;background:#F1F5F9;padding:6px 12px;border-radius:20px;color:var(--text);">
            ${escapeHtml(name)}: <b>₹${total.toFixed(2)}</b>
          </span>
        `).join('')}
      </div>
    ` : ''}
  `;
}

async function reviewClaim(id, status){
  let rejectionReason = null;
  if (status === 'rejected'){
    rejectionReason = prompt('Reason for rejecting this claim (shown to the employee):');
    if (rejectionReason === null) return; // cancelled
    if (!rejectionReason.trim()){ alert('Please enter a reason so the employee understands why.'); return; }
  }
  await supabaseClient.from('expense_claims').update({
    status, reviewed_at: new Date().toISOString(), reviewed_by: session.name,
    rejection_reason: status === 'rejected' ? rejectionReason.trim() : null
  }).eq('id', id);
  loadClaims();
}

/* ---------------- On-duty requests (manager only) ---------------- */
async function loadOnDuty(){
  const { data } = await supabaseClient
    .from('onduty_requests').select('*').eq('team', session.team)
    .order('submitted_at', { ascending: false });

  const container = document.getElementById('ondutyList');
  if (!data || !data.length){
    container.innerHTML = '<div class="empty-state">No requests yet.</div>';
    return;
  }
  container.innerHTML = data.map(o => `
    <div class="task-item">
      <div>
        <div class="t-title">${escapeHtml(o.employee_name)} — ${o.request_date}</div>
        <div class="t-meta"><span>${escapeHtml(o.reason)}</span></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="badge ${o.status === 'approved' ? 'done' : o.status === 'rejected' ? 'overdue' : 'progress'}">${o.status}</span>
        ${o.status === 'pending' ? `
          <button class="btn-sm btn-teal" onclick="reviewOnDuty('${o.id}','approved')">Approve</button>
          <button class="btn-sm" onclick="reviewOnDuty('${o.id}','rejected')">Reject</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function reviewOnDuty(id, status){
  await supabaseClient.from('onduty_requests').update({
    status, reviewed_at: new Date().toISOString(), reviewed_by: session.name
  }).eq('id', id);
  loadOnDuty();
}

async function loadDevices(){
  const container = document.getElementById('devicesList');
  const { data, error } = await supabaseClient.functions.invoke('swift-service', {
    body: { action: 'list_devices', team: session.team },
  });

  if (error || !data || !data.devices){
    container.innerHTML = '<div class="empty-state">Could not load devices.</div>';
    return;
  }
  if (!data.devices.length){
    container.innerHTML = '<div class="empty-state">No devices have registered yet.</div>';
    return;
  }

  container.innerHTML = data.devices.map(d => {
    const status = d.revoked_at ? 'Revoked' : d.is_approved ? 'Approved' : 'Pending verification';
    const badgeClass = d.revoked_at ? 'overdue' : d.is_approved ? 'done' : 'progress';
    return `
    <div class="task-item">
      <div>
        <div class="t-title">${escapeHtml(d.employee_name)} — ${escapeHtml(d.device_name || 'Unknown device')}</div>
        <div class="t-meta">
          <span>${escapeHtml(d.platform || '')}</span>
          <span>First seen: ${new Date(d.first_seen_at).toLocaleDateString()}</span>
          <span>Last active: ${new Date(d.last_seen_at).toLocaleString()}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="badge ${badgeClass}">${status}</span>
        ${(!d.revoked_at) ? `<button class="btn-sm" onclick="revokeDevice('${d.id}','${escapeHtml(d.employee_name)}','${escapeHtml(d.device_name || 'this device')}')">Revoke</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function revokeDevice(deviceRowId, employeeName, deviceName){
  if (!confirm(`Revoke "${deviceName}" for ${employeeName}? They will need a new verification code to use TaskFlow on that phone again.`)) return;
  const { data, error } = await supabaseClient.functions.invoke('device-auth', {
    body: { action: 'revoke_device', team: session.team, device_row_id: deviceRowId },
  });
  if (error || !data || !data.ok){
    alert('Could not revoke this device. Please try again.');
    return;
  }
  loadDevices();
}

function wireNewManagerSections(){
  document.getElementById('attendanceDate').addEventListener('change', loadAttendance);
  document.getElementById('mapDate').addEventListener('change', loadLiveMap);
  document.getElementById('refreshMapBtn').addEventListener('click', loadLiveMap);
  document.querySelectorAll('[data-claimf]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-claimf]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      claimFilter = btn.dataset.claimf;
      loadClaims();
    });
  });
}

async function loadUsageStats(){
  const { data, error } = await supabaseClient
    .from('login_log').select('*').eq('team', session.team)
    .order('at', { ascending: false }).limit(1000);

  const container = document.getElementById('usageList');
  if (error || !data || !data.length){
    container.innerHTML = '<div class="empty-state">No logins recorded yet.</div>';
    return;
  }
  const stats = {};
  data.forEach(d => {
    stats[d.name] = stats[d.name] || { name: d.name, role: d.role, loginCount: 0, lastLogin: null };
    stats[d.name].loginCount++;
    if (!stats[d.name].lastLogin || d.at > stats[d.name].lastLogin) stats[d.name].lastLogin = d.at;
  });
  const members = Object.values(stats).sort((a,b) => b.loginCount - a.loginCount);
  container.innerHTML = members.map(m => `
    <div class="task-item">
      <div>
        <div class="t-title">${escapeHtml(m.name)} <span style="font-weight:400;color:var(--text-muted);font-size:12.5px;">(${m.role})</span></div>
        <div class="t-meta">
          <span><i class="ti ti-login"></i> ${m.loginCount} login${m.loginCount>1?'s':''}</span>
          <span><i class="ti ti-clock"></i> last seen ${new Date(m.lastLogin).toLocaleString()}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ---------------- IT Support tickets ---------------- */
let ticketPriority = 'Medium';
let ticketFilter = 'All';
let tickets = [];
let ticketsChannel = null;

function closeTicketModal(){
  document.getElementById('ticketModal').classList.add('hidden');
  document.getElementById('tProblem').value = '';
  document.getElementById('tPhone').value = '';
  document.getElementById('tFrom').value = '';
  document.getElementById('tTo').value = '';
  pickPriority('Medium');
}

function pickPriority(p){
  ticketPriority = p;
  document.querySelectorAll('#ticketModal .filter-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.p === p);
  });
}

async function submitTicket(){
  const problem = document.getElementById('tProblem').value.trim();
  const phone = document.getElementById('tPhone').value.trim();
  const free_from = document.getElementById('tFrom').value.trim();
  const free_to = document.getElementById('tTo').value.trim();
  if (!problem || !phone){ alert('Please describe the problem and add your phone number.'); return; }

  const { error } = await supabaseClient.from('tickets').insert({
    team: session.team,
    employee_name: session.name,
    phone, problem,
    priority: ticketPriority,
    free_from: free_from || null,
    free_to: free_to || null
  });
  if (error){ console.error('submit ticket failed', error); alert('Could not submit the ticket. Please try again.'); return; }
  closeTicketModal();
  alert('Ticket raised — IT support has been notified.');
}

async function refreshItSupportStatus(){
  const { data, error } = await supabaseClient
    .from('members').select('name').eq('team', session.team).eq('role', 'it_support').maybeSingle();
  const statusBox = document.getElementById('itSupportStatus');
  const formBox = document.getElementById('itSupportForm');
  if (!statusBox || !formBox) return;
  if (!error && data){
    document.getElementById('itSupportCurrentName').textContent = data.name;
    statusBox.classList.remove('hidden');
    formBox.style.display = 'none';
  } else {
    statusBox.classList.add('hidden');
    formBox.style.display = 'flex';
  }
}

async function setItSupport(){
  const name = document.getElementById('itSupportName').value.trim();
  const password = document.getElementById('itSupportPassword').value;
  if (!name || !password || password.length < 4){
    alert('Enter a name and a password at least 4 characters long.');
    return;
  }
  const { data, error } = await supabaseClient.rpc('set_it_support', { p_team: session.team, p_name: name, p_password: password });
  if (error || !data){ alert('Could not set up the IT support login.'); return; }
  document.getElementById('itSupportName').value = '';
  document.getElementById('itSupportPassword').value = '';
  alert(`IT support login set for "${name}". Share the password with them separately — they log in with just their name, this workspace code, and that password.`);
  refreshItSupportStatus();
}

async function loadTicketsOnce(){
  const { data, error } = await supabaseClient.from('tickets').select('*').eq('team', session.team);
  if (error){ console.error('load tickets failed', error); return; }
  tickets = data || [];
  renderTickets();
}

function listenToTickets(){
  if (ticketsChannel) supabaseClient.removeChannel(ticketsChannel);
  ticketsChannel = supabaseClient
    .channel('tickets-' + session.team)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `team=eq.${session.team}` },
      () => loadTicketsOnce())
    .subscribe();
}

function ticketBadgeClass(priority){
  return { Low: 'progress', Medium: 'progress', High: 'overdue', Urgent: 'overdue' }[priority] || 'progress';
}

function renderTickets(){
  const open = tickets.filter(t => t.status === 'Open').length;
  const progress = tickets.filter(t => t.status === 'In Progress').length;
  const resolved = tickets.filter(t => t.status === 'Resolved').length;
  document.getElementById('ticketStatOpen').textContent = open;
  document.getElementById('ticketStatProgress').textContent = progress;
  document.getElementById('ticketStatResolved').textContent = resolved;

  let list = tickets.slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if (ticketFilter !== 'All') list = list.filter(t => t.status === ticketFilter);

  const container = document.getElementById('ticketList');
  if (!list.length){
    container.innerHTML = '<div class="empty-state"><i class="ti ti-headset"></i><p>No tickets in this view.</p></div>';
    return;
  }
  container.innerHTML = list.map(t => `
    <div class="task-item">
      <div>
        <div class="t-title">${escapeHtml(t.problem)}</div>
        <div class="t-meta">
          <span class="badge ${t.status === 'Resolved' ? 'done' : t.status === 'In Progress' ? 'pending' : 'overdue'}">${t.status}</span>
          <span class="badge ${ticketBadgeClass(t.priority)}">${t.priority}</span>
          <span class="assignee-chip"><span class="dotc"></span>${escapeHtml(t.employee_name)}</span>
          <span><i class="ti ti-phone"></i> ${escapeHtml(t.phone)}</span>
          ${t.free_from ? `<span><i class="ti ti-clock"></i> Free ${escapeHtml(t.free_from)}–${escapeHtml(t.free_to || '')}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <select onchange="updateTicketStatus('${t.id}', this.value)" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);font-size:13px;">
          <option value="Open" ${t.status==='Open'?'selected':''}>Open</option>
          <option value="In Progress" ${t.status==='In Progress'?'selected':''}>In Progress</option>
          <option value="Resolved" ${t.status==='Resolved'?'selected':''}>Resolved</option>
        </select>
      </div>
    </div>
  `).join('');
}

async function updateTicketStatus(id, status){
  await supabaseClient.from('tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
}

/* ---------------- Utilities ---------------- */
function renderPriorityChart(){
  const container = document.getElementById('priorityChart');
  if (!container) return;
  const total = tasks.length;
  if (!total){
    container.innerHTML = '<div class="empty-state" style="padding:20px 8px;">No tasks yet.</div>';
    return;
  }
  const colors = { Low: '#3B82F6', Medium: '#F59E0B', High: '#F97316', Urgent: '#EF4444' };
  const counts = { Low: 0, Medium: 0, High: 0, Urgent: 0 };
  tasks.forEach(t => { const p = t.priority || 'Medium'; if (counts[p] !== undefined) counts[p]++; });

  container.innerHTML = Object.keys(counts).map(p => {
    const pct = total ? Math.round((counts[p]/total)*100) : 0;
    return `
      <div class="mini-bar-row">
        <div class="mini-bar-label">${p}</div>
        <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${pct}%;background:${colors[p]};"></div></div>
        <div class="mini-bar-val">${counts[p]}</div>
      </div>
    `;
  }).join('');
}

function updateNotifBadge(count){
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (count > 0){
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function formatDate(d){
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString(undefined, {month:'short', day:'numeric'});
}
function formatDuration(startIso, endIso){
  const ms = new Date(endIso) - new Date(startIso);
  if (ms < 0 || isNaN(ms)) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

/* ---------------- Notifications / Web Push ---------------- */
function setupNotificationBanner(){
  if ('Notification' in window && Notification.permission === 'default'){
    document.getElementById('permBanner').classList.remove('hidden');
  }
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function setupPush(){
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return;

  document.getElementById('permBanner').classList.add('hidden');

  try{
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    await supabaseClient.from('members')
      .update({ push_subscription: sub.toJSON() })
      .eq('team', session.team).eq('name', session.name);
  }catch(e){
    console.error('push subscription failed', e);
  }
}

/* ---------------- Service worker (PWA + push) ---------------- */
function registerServiceWorker(){
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
  }
}
