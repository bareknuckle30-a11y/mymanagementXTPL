import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Bell, CalendarDays, MessageCircle, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Clock, FileText, Grid2X2, Inbox, LayoutDashboard, List, LogOut, Menu, MoreHorizontal, Paperclip, PanelLeftClose, Plus, QrCode, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, Upload, UserPlus, Users, X, Zap } from 'lucide-react';
import { apiFetch, downloadApiFile, readJson, toastMessage } from './api.js';
import DocumentsPage from './Documents.jsx';
import TrackerPage from './Tracker.jsx';
import ChatPage from './Chat.jsx';
import LoginReportPage from './LoginReport.jsx';
import SecureQRPage from './SecureQR.jsx';
import SessionClock from './SessionClock.jsx';
import { NotificationBell, useLiveNotifications } from './Notifications.jsx';
import { ThemeToggle } from './Theme.jsx';

const projects = [
  { id: 'p1', name: 'Marketing', color: 'blue', icon: '◈', description: 'Ads, social, WhatsApp and content' },
  { id: 'p2', name: 'Telecalling Reports', color: 'violet', icon: '▣', description: 'Daily and weekly calling reports' },
  { id: 'p3', name: 'Training & Demo Sessions', color: 'cyan', icon: '✳', description: 'Product demos and team training' },
  { id: 'p4', name: 'Operations', color: 'orange', icon: '⌘', description: 'Orders, payments and inventory' },
];
const statusOptions = ['Todo', 'In progress', 'Submitted', 'Done'];
const priorityOptions = ['Low', 'Medium', 'High'];
const LOGO = `${import.meta.env.BASE_URL}xtpl-logo.jpg`;
// Local calendar date (toISOString() is UTC and shows yesterday for part of the day in India).
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HASH = {
  Overview: 'overview',
  'All tasks': 'tasks',
  Team: 'team',
  'Login report': 'login-report',
  'Secure QR': 'secure-qr',
  Inbox: 'inbox',
  Chat: 'chat',
  Documents: 'documents',
  Tracker: 'tracker',
  Schedule: 'schedule',
  Settings: 'settings',
  Help: 'help',
  'Open tasks': 'open',
  'My work': 'my-work',
  Submitted: 'submitted',
};
const ADMIN_ONLY_PAGES = ['Login report', 'Secure QR'];
const HASH_PAGE = Object.fromEntries(Object.entries(HASH).map(([k, v]) => [v, k]));

function parseHash() {
  // Prefer clean browser paths (/chat); continue to support legacy #/chat links.
  const legacy = (window.location.hash || '').replace(/^#\/?/, '');
  const pathPart = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const raw = pathPart || legacy || 'overview';
  const [path, pathQuery] = raw.split('?');
  const params = new URLSearchParams(pathQuery || window.location.search.slice(1));
  return { page: HASH_PAGE[path] || 'Overview', project: params.get('project') || 'All projects' };
}

function hashFor(page, project) {
  const p = HASH[page] || 'overview';
  const q = project && project !== 'All projects' ? `?project=${encodeURIComponent(project)}` : '';
  return `/${p}${q}`;
}

function blankForm(project, dueDate = localISO()) {
  return {
    title: '',
    description: '',
    project: project === 'All projects' ? 'Marketing' : (project || 'Marketing'),
    status: 'Todo',
    priority: 'Medium',
    startDate: localISO(),
    dueDate,
    assigneeId: '',
  };
}

export default function App({ user, onLogout }) {
  const isAdmin = user.role === 'admin';
  const today = localISO();
  const initial = parseHash();
  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [page, setPage] = useState(initial.page);
  const [selectedProject, setSelectedProject] = useState(initial.project);
  const [view, setView] = useState('Board');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All status');
  const [showFilters, setShowFilters] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820);
  const [toast, setToast] = useState('');
  const [apiStatus, setApiStatus] = useState('Connecting');
  const [form, setForm] = useState(blankForm('Marketing'));
  const [submitFor, setSubmitFor] = useState(null);
  const [submitNote, setSubmitNote] = useState('');
  const [submitFiles, setSubmitFiles] = useState([]);
  const [teamForm, setTeamForm] = useState({ name: '', email: '', password: '', role: 'employee' });
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [otpOn, setOtpOn] = useState(true);
  const [chatEmails, setChatEmails] = useState(user.chatEmails !== false);
  const toastTimer = useRef(null);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const employees = people.filter(p => p.role === 'employee');
  const notify = msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  };
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const go = (nextPage, nextProject = selectedProject) => {
    if (window.innerWidth <= 820) setSidebarOpen(false);
    const hash = hashFor(nextPage, nextPage === 'Overview' ? 'All projects' : nextProject);
    if (`${window.location.pathname}${window.location.search}` !== hash) window.history.pushState({}, '', hash);
    setPage(nextPage);
    setSelectedProject(nextPage === 'Overview' ? 'All projects' : nextProject);
  };

  useEffect(() => {
    const apply = () => {
      const next = parseHash();
      setPage(next.page);
      setSelectedProject(next.project);
    };
    window.addEventListener('hashchange', apply);
    window.addEventListener('popstate', apply);
    apply();
    return () => { window.removeEventListener('hashchange', apply); window.removeEventListener('popstate', apply); };
  }, []);

  // The admin panel pages are not for employees, even if they type the address.
  useEffect(() => { if (!isAdmin && ADMIN_ONLY_PAGES.includes(page)) go('Overview'); }, [page, isAdmin]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        setModal(false);
        setSubmitFor(null);
        setShowWorkspace(false);
        setShowFilters(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const load = async () => {
    try {
      const [tr, ur] = await Promise.all([apiFetch('/tasks'), apiFetch('/users')]);
      if (!tr.ok) throw new Error();
      const data = await tr.json();
      if (Array.isArray(data)) setTasks(data);
      if (ur.ok) setPeople(await ur.json());
      setApiStatus('Connected');
    } catch {
      setApiStatus('Offline');
    }
  };

  useEffect(() => { load(); }, []);

  // Live alerts: tasks assigned to you and team chat messages (toast, bell list, Chat badge).
  const live = useLiveNotifications({ user, page, go, toast: notify, onTasksChanged: load });

  // Pick up new submissions / assignments without a manual refresh.
  useEffect(() => {
    const refresh = () => { if (!document.hidden) load(); };
    const timer = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);

  useEffect(() => {
    const onToast = e => notify(String(e.detail || ''));
    window.addEventListener('xtpl-toast', onToast);
    return () => window.removeEventListener('xtpl-toast', onToast);
  }, []);

  useEffect(() => {
    apiFetch('/health').then(readJson).then(h => { if (typeof h.otp === 'boolean') setOtpOn(h.otp); }).catch(() => {});
  }, []);

  const toggleChatEmails = async on => {
    setChatEmails(on);
    try {
      const r = await apiFetch('/users/me/preferences', { method: 'PATCH', body: JSON.stringify({ chatEmails: on }) });
      if (!r.ok) throw new Error();
      notify(on ? 'You will get an email for chat messages you miss' : 'Chat emails turned off');
    } catch {
      setChatEmails(!on);
      notify('Could not save that setting');
    }
  };

  const openCreate = (dueDate) => { setEditing(null); setForm(blankForm(selectedProject, dueDate || today)); setModal(true); };

  const createTask = async e => {
    e.preventDefault();
    if (!form.title.trim() || saving) return;
    if (form.startDate && form.dueDate && form.dueDate < form.startDate) return notify('Due date cannot be before the start date');
    setSaving(true);
    try {
      const payload = { ...form, title: form.title.trim(), tags: [] };
      const r = await apiFetch('/tasks', { method: 'POST', body: JSON.stringify(payload) });
      const data = await readJson(r);
      if (!r.ok) return notify(data.error || 'Could not create task');
      setTasks(prev => [data, ...prev]);
      setModal(false);
      notify(form.assigneeId ? 'Task assigned and scheduled' : 'Task added to the open pool');
    } catch {
      notify('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  const updateTask = async (task, patch) => {
    try {
      const r = await apiFetch(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      const data = await readJson(r);
      if (!r.ok) { notify(data.error || 'Could not update task'); return false; }
      setTasks(prev => prev.map(t => t.id === task.id ? data : t));
      return true;
    } catch {
      notify('Could not reach the server');
      return false;
    }
  };

  const deleteTask = async task => {
    if (!window.confirm(`Delete "${task.title}"? Its uploaded files are removed too. This cannot be undone.`)) return;
    try {
      const r = await apiFetch(`/tasks/${task.id}`, { method: 'DELETE' });
      if (!r.ok) return notify((await readJson(r)).error || 'Could not delete task');
      setTasks(prev => prev.filter(t => t.id !== task.id));
      notify('Task deleted');
    } catch {
      notify('Could not reach the server');
    }
  };

  const claimTask = async task => {
    try {
      const r = await apiFetch(`/tasks/${task.id}/claim`, { method: 'POST' });
      const data = await readJson(r);
      if (!r.ok) return notify(data.error || 'Could not pick task');
      setTasks(prev => prev.map(t => t.id === task.id ? data : t).filter(t => !t.assigneeId || t.assigneeId === user.id || isAdmin));
      notify('Task picked. Get to work.');
      go('My work');
    } catch {
      notify('Could not reach the server');
    }
  };

  const submitWork = async e => {
    e.preventDefault();
    if (saving) return;
    if (!submitNote.trim() && !submitFiles.length) return notify('Add a note or attach at least one file before submitting');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('note', submitNote);
      [...submitFiles].forEach(f => fd.append('files', f));
      const r = await apiFetch(`/tasks/${submitFor.id}/submit`, { method: 'POST', body: fd });
      const data = await readJson(r);
      if (!r.ok) return notify(data.error || 'Could not submit');
      setTasks(prev => prev.map(t => t.id === submitFor.id ? data : t));
      setSubmitFor(null);
      setSubmitNote('');
      setSubmitFiles([]);
      notify('Work and files submitted for review');
      go('Submitted');
    } catch {
      notify('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  const rejectWork = async task => {
    const reason = window.prompt('Why is it being sent back? The employee will see this note.', 'Please revise and resubmit with the correct files.');
    if (reason === null) return;
    try {
      const r = await apiFetch(`/tasks/${task.id}/reject`, { method: 'POST', body: JSON.stringify({ note: reason.trim() || 'Please revise and resubmit with the correct files.' }) });
      const data = await readJson(r);
      if (!r.ok) return notify(data.error || 'Could not send back');
      setTasks(prev => prev.map(t => t.id === task.id ? data : t));
      notify('Sent back to the employee');
    } catch {
      notify('Could not reach the server');
    }
  };

  const addTeammate = async e => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const r = await apiFetch('/users', { method: 'POST', body: JSON.stringify(teamForm) });
      const data = await readJson(r);
      if (!r.ok) return notify(data.error || 'Could not add teammate');
      setPeople(prev => [...prev, data]);
      setTeamForm({ name: '', email: '', password: '', role: 'employee' });
      notify(`${data.name} can now sign in`);
    } catch {
      notify('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = task => { setEditing(task); setForm({ ...task, assigneeId: task.assigneeId || '', startDate: task.startDate || '' }); setModal(true); };
  const submitTaskForm = async e => {
    if (editing) {
      e.preventDefault();
      if (saving) return;
      if (form.startDate && form.dueDate && form.dueDate < form.startDate) return notify('Due date cannot be before the start date');
      setSaving(true);
      const { title, description, project, status, priority, startDate, dueDate, assigneeId } = form;
      const ok = await updateTask(editing, { title, description, project, status, priority, startDate, dueDate, assigneeId });
      setSaving(false);
      if (ok) {
        setModal(false);
        setEditing(null);
        notify('Changes saved');
      }
      return;
    }
    await createTask(e);
  };

  const scoped = useMemo(() => {
    let list = tasks;
    if (page === 'Open tasks') list = list.filter(t => !t.assigneeId && t.status === 'Todo');
    if (page === 'My work' || page === 'My tasks') list = list.filter(t => t.assigneeId === user.id);
    if (page === 'Submitted' || page === 'Inbox') list = list.filter(t => t.status === 'Submitted' && (isAdmin || t.assigneeId === user.id));
    if (selectedProject !== 'All projects') list = list.filter(t => t.project === selectedProject);
    if (statusFilter !== 'All status') list = list.filter(t => t.status === statusFilter);
    if (search) list = list.filter(t => `${t.title} ${t.project} ${(t.tags || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [tasks, page, selectedProject, statusFilter, search, user.id, isAdmin]);

  const mine = tasks.filter(t => t.assigneeId === user.id);
  const completed = (isAdmin ? tasks : mine).filter(t => t.status === 'Done').length;
  const progress = Math.round(completed / Math.max(isAdmin ? tasks.length : mine.length, 1) * 100);
  const dueSoon = (isAdmin ? tasks : mine).filter(t => t.status !== 'Done' && t.dueDate && t.dueDate <= today);
  const firstName = user.name.split(' ')[0];
  const submittedCount = tasks.filter(t => t.status === 'Submitted').length;
  const nav = isAdmin
    ? [['Overview', LayoutDashboard], ['All tasks', CheckCheck], ['Chat', MessageCircle], ['Schedule', CalendarDays], ['Documents', FileText], ['Tracker', ClipboardList], ['Team', Users], ['Login report', Clock], ['Secure QR', QrCode], ['Inbox', Inbox], ['Settings', Settings2]]
    : [['Overview', LayoutDashboard], ['Open tasks', Inbox], ['My work', CheckCheck], ['Chat', MessageCircle], ['Schedule', CalendarDays], ['Documents', FileText], ['Tracker', ClipboardList], ['Submitted', Upload], ['Settings', Settings2]];

  const approve = task => updateTask(task, { status: 'Done' });
  const taskBoard = (
    <Board tasks={scoped} user={user} isAdmin={isAdmin} updateTask={updateTask} openEdit={openEdit} deleteTask={deleteTask} claimTask={claimTask} onSubmit={t => { setSubmitNote(''); setSubmitFiles([]); setSubmitFor(t); }} approve={approve} rejectWork={rejectWork} />
  );

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <aside className="sidebar glass-panel">
          <div className="brand-row">
            <LogoMark size={46} />
            <div className="brand-copy"><strong>XTPL</strong><span>TaskManager</span></div>
            <button className="icon-btn sidebar-collapse" title="Collapse sidebar" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button>
          </div>
          <div className="workspace-wrap">
            <button className="workspace-switch" type="button" onClick={() => setShowWorkspace(v => !v)}>
              <div className="workspace-avatar">X</div>
              <span><strong>XTPL</strong><small>{isAdmin ? 'Admin workspace' : 'Employee workspace'}</small></span>
              <ChevronDown size={15} />
            </button>
            {showWorkspace && (
              <div className="workspace-menu">
                <p>Signed in as <strong>{user.role}</strong></p>
                <button type="button" onClick={() => { setShowWorkspace(false); go('Settings'); }}>Account settings</button>
                <button type="button" onClick={() => { setShowWorkspace(false); onLogout(); }}>Sign out</button>
              </div>
            )}
          </div>
          <div className="nav-label">WORKSPACE</div>
          <nav className="main-nav">
            {nav.map(([label, Icon]) => (
              <button key={label} className={`nav-item ${page === label ? 'active' : ''}`} onClick={() => go(label, 'All projects')}>
                <Icon size={17} /><span>{label}</span>
                {label === 'Inbox' && submittedCount > 0 && <span className="nav-count">{submittedCount}</span>}
                {label === 'Chat' && live.chatUnread > 0 && <span className="nav-count">{live.chatUnread > 99 ? '99+' : live.chatUnread}</span>}
              </button>
            ))}
          </nav>
          <div className="section-heading"><span>YOUR PROJECTS</span></div>
          <div className="project-nav">
            {projects.map(p => (
              <button key={p.id} className={`project-nav-item ${selectedProject === p.name ? 'selected' : ''}`} onClick={() => go(isAdmin ? 'All tasks' : 'My work', p.name)}>
                <span className={`project-glyph ${p.color}`}>{p.icon}</span><span>{p.name}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-spacer" />
          <div className="upgrade-card">
            <div className="upgrade-icon"><Sparkles size={16} /></div>
            <strong>{isAdmin ? 'Assign and schedule' : 'Pick, finish, upload'}</strong>
            <p>{isAdmin ? 'Create tasks, set due dates, and send them to the right teammate.' : 'Claim open work and submit Excel, PDF, images or other files.'}</p>
          </div>
          <div className="profile-row">
            <div className={`avatar avatar-${tone(user.initials)}`}>{user.initials}</div>
            <div className="profile-copy"><strong>{user.name}</strong><span>{user.email}</span></div>
            <button className="icon-btn" title="Sign out" onClick={onLogout}><LogOut size={16} /></button>
          </div>
        </aside>
      )}
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={18} /></button>
            <button className="icon-btn" title="Back" onClick={() => window.history.back()}><ArrowLeft size={16} /></button>
            <span className="crumb-muted">{isAdmin ? 'Admin' : 'Employee'}</span>
            <ChevronRight size={14} />
            <span>{page === 'All tasks' && selectedProject !== 'All projects' ? selectedProject : page}</span>
          </div>
          <div className="top-actions">
            <SessionClock />
            <ThemeToggle />
            <div className="api-pill"><span className={`status-dot ${apiStatus === 'Connected' ? 'online' : ''}`} />{apiStatus}</div>
            <button className="icon-btn" title="Help" onClick={() => go('Help')}><CircleHelp size={18} /></button>
            <NotificationBell live={live} submittedCount={submittedCount} isAdmin={isAdmin} go={go} />
            <button className={`avatar avatar-${tone(user.initials)} small-avatar avatar-btn`} title="Settings" onClick={() => go('Settings')}>{user.initials}</button>
          </div>
        </header>
        <div className="page-content">
          {page === 'Chat' && <ChatPage user={user} />}
          {page === 'Overview' && (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-line" /> {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}</div>
                  <h1>{hello}, {firstName} <span className="wave">✳</span></h1>
                  <p className="subtitle">{isAdmin ? 'Assign work, schedule due dates, and review uploaded files.' : 'Pick an open task, do the work, and upload your files for review.'}</p>
                </div>
                {isAdmin
                  ? <button className="primary-btn" onClick={() => openCreate()}><Plus size={17} /> Assign task</button>
                  : <button className="primary-btn" onClick={() => go('Open tasks')}><Inbox size={17} /> Open task pool</button>}
              </section>
              <section className="stats-grid">
                <StatCard icon={<Target size={18} />} label={isAdmin ? 'Tasks completed' : 'My completed'} value={`${completed}/${isAdmin ? tasks.length : mine.length}`} foot={`${progress}% finished`} tone="blue" progress={progress} />
                <StatCard icon={<Zap size={18} />} label="In progress" value={(isAdmin ? tasks : mine).filter(t => t.status === 'In progress').length.toString().padStart(2, '0')} foot="Active work" tone="violet" />
                <StatCard icon={<CalendarDays size={18} />} label="Due today or earlier" value={dueSoon.length.toString().padStart(2, '0')} foot="Needs attention" tone="cyan" />
                <StatCard icon={<Activity size={18} />} label={isAdmin ? 'Awaiting review' : 'Open to pick'} value={(isAdmin ? tasks.filter(t => t.status === 'Submitted') : tasks.filter(t => !t.assigneeId && t.status === 'Todo')).length.toString().padStart(2, '0')} foot={isAdmin ? 'Employee submissions' : 'Unassigned tasks'} tone="green" />
              </section>
              <section className="content-grid">
                <div className="panel projects-panel">
                  <div className="panel-heading"><div><h2>Your projects</h2><p>Work grouped by desk</p></div></div>
                  <div className="project-cards">{projects.map(p => <ProjectCard key={p.id} project={p} tasks={isAdmin ? tasks : mine} onClick={() => go(isAdmin ? 'All tasks' : 'My work', p.name)} />)}</div>
                </div>
                <div className="panel focus-panel">
                  <div className="panel-heading"><div><h2>Focus for today</h2><p>{isAdmin ? 'Soonest deadlines' : 'Your next steps'}</p></div><span className="soft-badge">{dueSoon.length} items</span></div>
                  <div className="focus-list">
                    {[...dueSoon].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).slice(0, 4).map(t => (
                      <div className="focus-item" key={t.id}>
                        <button className={`task-check ${t.status === 'Done' ? 'checked' : ''}`} onClick={() => isAdmin && updateTask(t, { status: t.status === 'Done' ? 'Todo' : 'Done' })}>{t.status === 'Done' && <Check size={12} />}</button>
                        <div className="focus-copy"><strong className={t.status === 'Done' ? 'line-through' : ''}>{t.title}</strong><span>{t.project}</span></div>
                        <span className={`priority-dot ${(t.priority || 'Medium').toLowerCase()}`} />
                      </div>
                    ))}
                    {dueSoon.length === 0 && <p className="empty-inline">Nothing urgent right now.</p>}
                  </div>
                </div>
              </section>
              <section className="panel tasks-panel">
                <div className="panel-heading task-heading">
                  <div><h2>{isAdmin ? 'Recent tasks' : 'Your tasks'}</h2><p>{isAdmin ? 'Everything the team is moving' : 'Assigned to you'}</p></div>
                </div>
                <Board tasks={(isAdmin ? tasks : mine).slice(0, 12)} user={user} isAdmin={isAdmin} updateTask={updateTask} openEdit={openEdit} deleteTask={deleteTask} claimTask={claimTask} onSubmit={t => { setSubmitNote(''); setSubmitFiles([]); setSubmitFor(t); }} approve={approve} rejectWork={rejectWork} />
              </section>
            </>
          )}
          {page === 'Team' && isAdmin && (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-line" /> PEOPLE</div>
                  <h1>Team</h1>
                  <p className="subtitle">Add more admins or employees. Employees can also create their own Gmail accounts from the login page.</p>
                </div>
              </section>
              <section className="panel team-panel">
                <form className="team-form" onSubmit={addTeammate}>
                  <label>Name<input required value={teamForm.name} onChange={e => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="Full name" /></label>
                  <label>Email<input type="email" required value={teamForm.email} onChange={e => setTeamForm({ ...teamForm, email: e.target.value })} placeholder="name@xtpl.com or Gmail" /></label>
                  <label>Password<input type="text" required minLength={6} value={teamForm.password} onChange={e => setTeamForm({ ...teamForm, password: e.target.value })} placeholder="Min 6 characters" /></label>
                  <label>Role<select value={teamForm.role} onChange={e => setTeamForm({ ...teamForm, role: e.target.value })}><option value="employee">Employee</option><option value="admin">Admin</option></select></label>
                  <button className="primary-btn" type="submit" disabled={saving}><UserPlus size={16} /> Add person</button>
                </form>
                <div className="table-wrap">
                  <table className="task-table">
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Initials</th></tr></thead>
                    <tbody>
                      {people.map(p => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{p.email}</td>
                          <td><span className={`role-pill ${p.role}`}>{p.role}</span></td>
                          <td><span className={`avatar avatar-${tone(p.initials)} task-avatar`}>{p.initials}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {page === 'Login report' && isAdmin && <LoginReportPage people={people} notify={notify} />}
          {page === 'Secure QR' && isAdmin && <SecureQRPage notify={notify} />}
          {page === 'Inbox' && (
            <InboxPage tasks={scoped} isAdmin={isAdmin} approve={approve} rejectWork={rejectWork} go={go} />
          )}
          {page === 'Schedule' && (
            <SchedulePage
              month={calMonth}
              today={today}
              setMonth={setCalMonth}
              tasks={isAdmin ? tasks : mine}
              isAdmin={isAdmin}
              onDayCreate={d => isAdmin && openCreate(d)}
              onOpen={t => isAdmin ? openEdit(t) : (t.assigneeId === user.id && t.status !== 'Submitted' && t.status !== 'Done' ? (setSubmitNote(''), setSubmitFiles([]), setSubmitFor(t)) : notify('Open this from My work'))}
            />
          )}
          {page === 'Documents' && (
            <DocumentsPage user={user} isAdmin={isAdmin} tasks={tasks} projects={projects} notify={notify} />
          )}
          {page === 'Tracker' && <TrackerPage notify={notify} />}
          {page === 'Settings' && (
            <section className="panel settings-panel">
              <div className="eyebrow"><span className="eyebrow-line" /> ACCOUNT</div>
              <h1>Settings</h1>
              <p className="subtitle">You are signed in as {user.role === 'admin' ? 'an admin' : 'an employee'}.</p>
              <div className="settings-card">
                <div className={`avatar avatar-${tone(user.initials)}`}>{user.initials}</div>
                <div>
                  <strong>{user.name}</strong>
                  <p>{user.email}</p>
                  <span className={`role-pill ${user.role}`}>{user.role}</span>
                </div>
              </div>
              <div className="settings-card security-card">
                <div className="stat-icon blue"><ShieldCheck size={18} /></div>
                <div>
                  <strong>{otpOn ? 'Two-step verification is on' : 'Two-step verification is off'}</strong>
                  <p>{otpOn
                    ? 'Every sign-in needs your password plus a 6-digit code. Sessions use short-lived JWT tokens that refresh automatically and are revoked when you sign out.'
                    : 'Sign-in uses your password only. Sessions use short-lived JWT tokens that refresh automatically and are revoked when you sign out.'}</p>
                </div>
              </div>
              <div className="settings-card">
                <div className="stat-icon cyan"><Bell size={18} /></div>
                <div>
                  <strong>Email me about things I miss</strong>
                  <p>Task assignments are always emailed to you. Chat messages are emailed only when you are not in the app, bundled into one email at most every few minutes.</p>
                  <label className="inline-check"><input type="checkbox" checked={chatEmails} onChange={e => toggleChatEmails(e.target.checked)} /> Email me missed chat messages</label>
                </div>
              </div>
              <p className="help-copy">{isAdmin ? 'Admins assign, schedule, and approve uploaded work. Use Team to add more people.' : 'Employees sign up with Gmail, pick tasks, and submit files (Excel, PDF, images and more).'}</p>
              <button className="secondary-btn" type="button" onClick={onLogout}><LogOut size={15} /> Sign out</button>
            </section>
          )}
          {page === 'Help' && (
            <section className="panel empty-panel help-panel">
              <div className="empty-illustration"><CircleHelp size={26} /></div>
              <h2>How XTPL TaskManager works</h2>
              <p>{isAdmin
                ? 'Use Assign task to create work, set start and due dates, and choose an employee or leave it in the open pool. Review uploaded files in Inbox, then Approve or send back.'
                : 'Sign in with your employee account. Pick a task from Open tasks, complete it, then Submit with a note and your files (Excel, PDF, images, and other formats).'}</p>
              <p>Open <strong>Documents</strong> to download templates and guides, upload your own files, and find every file submitted on tasks.</p>
              <p>Use the back arrow to return to the previous tab. Press <strong>Esc</strong> to close a dialog.</p>
              <button className="secondary-btn" onClick={() => go('Overview')}>Back to overview <ArrowRight size={14} /></button>
            </section>
          )}
          {['All tasks', 'Open tasks', 'My work', 'My tasks', 'Submitted'].includes(page) && (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-line" /> TASK MANAGEMENT</div>
                  <h1>{page === 'All tasks' && selectedProject !== 'All projects' ? selectedProject : page}</h1>
                  <p className="subtitle">{page === 'Open tasks' ? 'Unassigned work you can pick up.' : page === 'Submitted' ? 'Waiting for an admin to approve your files.' : 'Make meaningful progress, one task at a time.'}</p>
                </div>
                {isAdmin && <button className="primary-btn" onClick={() => openCreate()}><Plus size={17} /> Assign task</button>}
              </section>
              <section className="panel tasks-panel full-tasks">
                <div className="panel-heading task-heading">
                  <div><h2>{scoped.length} tasks</h2><p>{page}</p></div>
                  <div className="heading-actions">
                    <div className="search-box"><Search size={15} /><input placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                    <button className="secondary-btn" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={15} /> Filter</button>
                    <div className="view-switch">
                      <button className={view === 'Board' ? 'chosen' : ''} onClick={() => setView('Board')}><Grid2X2 size={15} /></button>
                      <button className={view === 'List' ? 'chosen' : ''} onClick={() => setView('List')}><List size={16} /></button>
                    </div>
                  </div>
                </div>
                {showFilters && <FilterBar statusFilter={statusFilter} setStatusFilter={setStatusFilter} search={search} setSearch={setSearch} />}
                {view === 'Board'
                  ? taskBoard
                  : <TaskTable tasks={scoped} user={user} isAdmin={isAdmin} updateTask={updateTask} openEdit={openEdit} deleteTask={deleteTask} claimTask={claimTask} onSubmit={t => { setSubmitNote(''); setSubmitFiles([]); setSubmitFor(t); }} approve={approve} rejectWork={rejectWork} />}
              </section>
            </>
          )}
          <footer className="footer"><span>Made for thoughtful work <span className="footer-spark">✳</span></span><span><span className="footer-dot" /> Signed in as {user.role}</span></footer>
        </div>
      </main>
      {modal && isAdmin && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(false); }}>
          <form className="task-modal glass-panel" onSubmit={submitTaskForm}>
            <div className="modal-top">
              <div><span className="modal-kicker">TASK DETAILS</span><h2>{editing ? 'Edit task' : 'Assign & schedule'}</h2><p>Give it an owner, or leave it open for anyone to pick.</p></div>
              <button type="button" className="icon-btn" onClick={() => setModal(false)}><X size={18} /></button>
            </div>
            <label>Task name<input autoFocus required placeholder="e.g. Prepare project brief" value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label>Description <span className="optional">OPTIONAL</span><textarea rows="3" placeholder="What does done look like? Which files should they upload?" value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
            <div className="form-row">
              <label>Project<select value={form.project || 'Marketing'} onChange={e => setForm({ ...form, project: e.target.value })}>{projects.map(p => <option key={p.id}>{p.name}</option>)}</select></label>
              <label>Status<select value={form.status || 'Todo'} onChange={e => setForm({ ...form, status: e.target.value })}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select></label>
            </div>
            <div className="form-row">
              <label>Priority<select value={form.priority || 'Medium'} onChange={e => setForm({ ...form, priority: e.target.value })}>{priorityOptions.map(s => <option key={s}>{s}</option>)}</select></label>
              <label>Start date<input type="date" value={form.startDate || ''} onChange={e => setForm({ ...form, startDate: e.target.value })} /></label>
            </div>
            <label>Due date<input type="date" value={form.dueDate || ''} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></label>
            <label>Assign to
              <select value={form.assigneeId || ''} onChange={e => setForm({ ...form, assigneeId: e.target.value })}>
                <option value="">Open pool — employees can pick</option>
                {employees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setModal(false)}>Cancel</button>
              <button className="primary-btn" type="submit" disabled={saving}><Check size={16} />{saving ? 'Saving…' : editing ? 'Save changes' : 'Create task'}</button>
            </div>
          </form>
        </div>
      )}
      {submitFor && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSubmitFor(null); }}>
          <form className="task-modal glass-panel" onSubmit={submitWork}>
            <div className="modal-top">
              <div><span className="modal-kicker">SUBMIT WORK</span><h2>{submitFor.title}</h2><p>Add a note and upload Excel, PDF, images, or other files.</p></div>
              <button type="button" className="icon-btn" onClick={() => setSubmitFor(null)}><X size={18} /></button>
            </div>
            <label>Update for review<textarea rows="3" value={submitNote} onChange={e => setSubmitNote(e.target.value)} placeholder="What did you complete?" /></label>
            <label className="file-label">
              Work files
              <span className="file-drop">
                <Upload size={16} />
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.ppt,.pptx,.txt,.zip,.mp4"
                  onChange={e => setSubmitFiles(e.target.files)}
                />
                <em>{submitFiles.length ? `${submitFiles.length} file${submitFiles.length > 1 ? 's' : ''} selected` : 'Choose Excel, PDF, images, and more'}</em>
              </span>
            </label>
            {(submitFor.files || []).length > 0 && (
              <p className="file-hint">Previously uploaded: {(submitFor.files || []).map(f => f.name).join(', ')}</p>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setSubmitFor(null)}>Cancel</button>
              <button className="primary-btn" type="submit" disabled={saving}><CheckCheck size={16} /> {saving ? 'Submitting…' : 'Submit'}</button>
            </div>
          </form>
        </div>
      )}
      {toast && <div className="toast"><CheckCheck size={16} />{toast}</div>}
    </div>
  );
}

function InboxPage({ tasks, isAdmin, approve, rejectWork, go }) {
  const list = tasks.filter(t => t.status === 'Submitted');
  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> REVIEW</div>
          <h1>Inbox</h1>
          <p className="subtitle">{list.length ? 'Open a submission, download the files, then approve or send it back.' : 'Nothing waiting for review.'}</p>
        </div>
      </section>
      {list.length === 0 ? (
        <section className="panel empty-panel">
          <div className="empty-illustration"><Sparkles size={26} /></div>
          <h2>Inbox is clear</h2>
          <p>When employees submit files they land here.</p>
          <button className="secondary-btn" onClick={() => go('All tasks')}>Go to all tasks <ArrowRight size={14} /></button>
        </section>
      ) : (
        <section className="panel inbox-list">
          {list.map(t => (
            <article className="inbox-item" key={t.id}>
              <div>
                <strong>{t.title}</strong>
                <p>{t.project} · {t.assignee || 'Unassigned'} · {t.submittedAt ? new Date(t.submittedAt).toLocaleString() : ''}</p>
                {t.submissionNote && <p className="inbox-note">{t.submissionNote}</p>}
                <FileList files={t.files} />
              </div>
              {isAdmin && (
                <div className="inbox-actions">
                  <button className="primary-btn" type="button" onClick={() => approve(t)}>Approve</button>
                  <button className="secondary-btn" type="button" onClick={() => rejectWork(t)}>Send back</button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function SchedulePage({ month, today, setMonth, tasks, isAdmin, onDayCreate, onOpen }) {
  const first = new Date(month.y, month.m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  const iso = d => `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> CALENDAR</div>
          <h1>Schedule</h1>
          <p className="subtitle">{isAdmin ? 'Click a day to assign a task due that date.' : 'Your tasks by due date.'}</p>
        </div>
        <div className="cal-nav">
          <button className="icon-btn" type="button" onClick={() => setMonth(m => m.m === 0 ? { y: m.y - 1, m: 11 } : { y: m.y, m: m.m - 1 })}><ChevronLeft size={18} /></button>
          <strong>{label}</strong>
          <button className="icon-btn" type="button" onClick={() => setMonth(m => m.m === 11 ? { y: m.y + 1, m: 0 } : { y: m.y, m: m.m + 1 })}><ChevronRight size={18} /></button>
        </div>
      </section>
      <section className="panel calendar-panel">
        <div className="cal-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <span key={d}>{d}</span>)}</div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="cal-cell empty" />;
            const date = iso(d);
            const dayTasks = tasks.filter(t => t.dueDate === date);
            return (
              <button type="button" key={date} className={`cal-cell ${date === today ? 'today' : ''}`} onClick={() => onDayCreate(date)}>
                <span className="cal-num">{d}</span>
                {dayTasks.slice(0, 3).map(t => (
                  <span key={t.id} className="cal-chip" onClick={e => { e.stopPropagation(); onOpen(t); }}>{t.title}</span>
                ))}
                {dayTasks.length > 3 && <span className="cal-more">+{dayTasks.length - 3}</span>}
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function FileList({ files }) {
  if (!files?.length) return <p className="file-hint">No files uploaded.</p>;
  return (
    <div className="file-list">
      {files.map(f => (
        <button key={f.stored} type="button" className="file-chip" onClick={() => downloadApiFile(f.stored, f.name).catch(() => toastMessage('Could not download this file'))}>
          <Paperclip size={12} /> {f.name}
        </button>
      ))}
    </div>
  );
}

function LogoMark({ size = 46 }) {
  return (
    <div className="xt-logo" style={{ '--s': `${size}px` }} aria-label="XTPL logo">
      <span className="xt-ring" /><span className="xt-glow" />
      <div className="xt-disc"><img src={LOGO} alt="XTPL" /></div>
    </div>
  );
}
function tone(initials) {
  if (initials === 'JD') return 'purple';
  if (initials === 'SK') return 'cyan';
  if (initials === 'ML') return 'orange';
  if (initials === 'RV') return 'purple';
  return 'blue';
}
function StatCard({ icon, label, value, foot, tone: t, progress }) {
  return (
    <div className="stat-card glass-panel">
      <div className={`stat-icon ${t}`}>{icon}</div>
      <span className="stat-label">{label}</span>
      <div className="stat-value-row"><strong>{value}</strong>{progress !== undefined && <span className="mini-progress"><i style={{ width: `${progress}%` }} /></span>}</div>
      <span className="stat-foot">{foot}</span>
    </div>
  );
}
function ProjectCard({ project, tasks, onClick }) {
  const projectTasks = tasks.filter(t => t.project === project.name);
  const done = projectTasks.filter(t => t.status === 'Done').length;
  const pct = projectTasks.length ? Math.round(done / projectTasks.length * 100) : 0;
  return (
    <button className="project-card" onClick={onClick}>
      <div className="project-card-top"><div className={`project-icon ${project.color}`}>{project.icon}</div></div>
      <h3>{project.name}</h3>
      <p>{project.description}</p>
      <div className="project-progress-row"><span>Progress</span><strong>{pct}%</strong></div>
      <div className="progress-track"><i className={project.color} style={{ width: `${pct}%` }} /></div>
      <div className="project-card-bottom"><span>{projectTasks.length} tasks <span className="tiny-separator">·</span> <span className="done-text">{done} done</span></span></div>
    </button>
  );
}
function FilterBar({ statusFilter, setStatusFilter, search, setSearch }) {
  return (
    <div className="filter-bar">
      <div className="search-box"><Search size={15} /><input placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>{['All status', ...statusOptions].map(s => <option key={s}>{s}</option>)}</select>
      <button className="text-btn" onClick={() => { setStatusFilter('All status'); setSearch(''); }}>Clear</button>
    </div>
  );
}
function Board({ tasks, user, isAdmin, updateTask, openEdit, deleteTask, claimTask, onSubmit, approve, rejectWork }) {
  return (
    <div className="board-grid board-grid-4">
      {statusOptions.map((status, i) => {
        const list = tasks.filter(t => t.status === status);
        return (
          <div className="board-column" key={status}>
            <div className="column-heading"><span className={`column-status status-${i}`} /><strong>{status}</strong><span className="column-count">{list.length}</span></div>
            <div className="column-cards">
              {list.map(t => <TaskCard key={t.id} task={t} user={user} isAdmin={isAdmin} updateTask={updateTask} openEdit={openEdit} deleteTask={deleteTask} claimTask={claimTask} onSubmit={onSubmit} approve={approve} rejectWork={rejectWork} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function TaskCard({ task, user, isAdmin, updateTask, openEdit, deleteTask, claimTask, onSubmit, approve, rejectWork }) {
  const mine = task.assigneeId === user.id;
  const open = !task.assigneeId && task.status === 'Todo';
  return (
    <article className="task-card">
      <div className="task-card-top">
        <span className={`priority-label ${(task.priority || 'Medium').toLowerCase()}`}><span /> {task.priority || 'Medium'}</span>
        {isAdmin && <button className="icon-btn tiny" title="Edit task" onClick={() => openEdit(task)}><MoreHorizontal size={16} /></button>}
      </div>
      <button className="task-title-btn" onClick={() => isAdmin && openEdit(task)}>{task.title}</button>
      {task.description && <p className="task-description">{task.description}</p>}
      {task.submissionNote && <p className="task-description">Note: {task.submissionNote}</p>}
      {task.reviewNote && task.status === 'In progress' && <p className="task-description">Admin: {task.reviewNote}</p>}
      <FileList files={task.files} />
      <div className="task-tags">{(task.tags || []).slice(0, 2).map(tag => <span key={tag} className="task-tag">{tag}</span>)}</div>
      <div className="task-card-bottom">
        <span className="task-project"><i className={`project-mini ${task.project === 'Telecalling Reports' ? 'violet' : task.project === 'Training & Demo Sessions' ? 'cyan' : task.project === 'Operations' ? 'orange' : 'blue'}`} />{task.project}</span>
        <div className="task-meta">
          <span className="due-date"><CalendarDays size={12} />{formatDate(task.dueDate)}</span>
          <span className={`avatar avatar-${tone(task.assignee)} task-avatar`}>{task.assignee || '?'}</span>
        </div>
      </div>
      <div className="task-card-actions always-actions">
        {isAdmin && <select aria-label="Change task status" value={task.status} onChange={e => updateTask(task, { status: e.target.value })}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select>}
        {isAdmin && task.status === 'Submitted' && <button type="button" onClick={() => approve(task)}>Approve</button>}
        {isAdmin && task.status === 'Submitted' && <button type="button" onClick={() => rejectWork(task)}>Back</button>}
        {isAdmin && <button type="button" onClick={() => deleteTask(task)} title="Delete task"><X size={13} /></button>}
        {!isAdmin && open && <button type="button" className="chip-action" onClick={() => claimTask(task)}>Pick task</button>}
        {!isAdmin && mine && task.status !== 'Submitted' && task.status !== 'Done' && <button type="button" className="chip-action" onClick={() => onSubmit(task)}>Submit</button>}
      </div>
    </article>
  );
}
function TaskTable({ tasks, user, isAdmin, updateTask, openEdit, deleteTask, claimTask, onSubmit, approve, rejectWork }) {
  return (
    <div className="table-wrap">
      <table className="task-table">
        <thead><tr><th>Task name</th><th>Project</th><th>Status</th><th>Owner</th><th /></tr></thead>
        <tbody>
          {tasks.map(t => {
            const mine = t.assigneeId === user.id;
            const open = !t.assigneeId && t.status === 'Todo';
            return (
              <tr key={t.id}>
                <td><button className="table-task-name" onClick={() => isAdmin && openEdit(t)}><span className={t.status === 'Done' ? 'line-through' : ''}>{t.title}</span></button></td>
                <td>{t.project}</td>
                <td>{isAdmin ? <select className="status-select" value={t.status} onChange={e => updateTask(t, { status: e.target.value })}>{statusOptions.map(s => <option key={s}>{s}</option>)}</select> : t.status}</td>
                <td><span className={`avatar avatar-${tone(t.assignee)} task-avatar`}>{t.assignee || '?'}</span></td>
                <td>
                  {isAdmin && t.status === 'Submitted' && <button className="text-btn" onClick={() => approve(t)}>Approve</button>}
                  {isAdmin && t.status === 'Submitted' && <button className="text-btn" onClick={() => rejectWork(t)}>Send back</button>}
                  {isAdmin && <button className="icon-btn tiny" onClick={() => deleteTask(t)}><X size={14} /></button>}
                  {!isAdmin && open && <button className="text-btn" onClick={() => claimTask(t)}>Pick</button>}
                  {!isAdmin && mine && t.status !== 'Done' && t.status !== 'Submitted' && <button className="text-btn" onClick={() => onSubmit(t)}>Submit</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tasks.length === 0 && <div className="no-results">No tasks match those filters.</div>}
    </div>
  );
}
function formatDate(date) {
  if (!date) return 'No date';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
