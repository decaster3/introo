import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState, useAppActions } from '../store';
import { adminApi, type AdminUser, type AdminStats, type AdminPendingInvite } from '../lib/api';

const COL_COUNT = 7;

const USER_FUNNEL_STEPS = [
  { key: 'invited', label: 'Invited', color: '#f97316' },
  { key: 'signed_up', label: 'Signed Up', color: '#facc15' },
  { key: 'calendar_connected', label: 'Calendar', color: '#60a5fa' },
  { key: 'contacts_enriched', label: 'Enriched', color: '#c084fc' },
  { key: 'first_connection', label: '1-1 / Space', color: '#4ade80' },
  { key: 'intro_created', label: 'Intro Created', color: '#38bdf8' },
  { key: 'intro_success', label: 'Intro Success', color: '#a78bfa' },
] as const;

const STATUS_INDEX: Record<string, number> = {
  invited: 0,
  signed_up: 1,
  calendar_connected: 2,
  contacts_enriched: 3,
  first_connection: 4,
  intro_created: 5,
  intro_success: 6,
};

type DisplayUser = AdminUser | {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  status: 'invited';
  role: string;
  createdAt: string;
  calendarConnected: false;
  contactsCount: 0;
  identifiedContactCount: 0;
  enrichedContactCount: 0;
  connectionsCount: 0;
  introRequestsSent: 0;
  introRequestsSuccessful: 0;
  introRequestsReceived: 0;
  introRequestsReceivedSuccessful: 0;
  activeDays7: 0;
  activeDays30: 0;
  lastActiveAt: null;
  isPendingInvite: true;
  invitedBy?: string;
};

function pendingInviteToDisplayUser(inv: AdminPendingInvite): DisplayUser {
  return {
    id: `invite-${inv.id}`,
    name: inv.email.split('@')[0],
    email: inv.email,
    avatar: null,
    status: 'invited',
    role: 'invited',
    createdAt: inv.createdAt,
    calendarConnected: false,
    contactsCount: 0,
    identifiedContactCount: 0,
    enrichedContactCount: 0,
    connectionsCount: 0,
    introRequestsSent: 0,
    introRequestsSuccessful: 0,
    introRequestsReceived: 0,
    introRequestsReceivedSuccessful: 0,
    activeDays7: 0,
    activeDays30: 0,
    lastActiveAt: null,
    isPendingInvite: true,
    invitedBy: inv.invitedBy.name,
  };
}

function getUserCompletedSteps(user: DisplayUser): boolean[] {
  const idx = STATUS_INDEX[user.status] ?? 0;
  return USER_FUNNEL_STEPS.map((_, i) => i <= idx);
}

function getStatusDisplay(status: string): { label: string; color: string } {
  const step = USER_FUNNEL_STEPS.find(s => s.key === status);
  return step ? { label: step.label, color: step.color } : { label: status, color: '#888' };
}

const STATUS_FILTER_OPTIONS = USER_FUNNEL_STEPS.map(s => ({ key: s.key, label: s.label, color: s.color }));

const FUNNEL_EMAILS: Record<number, string> = {
  0: 'Invitation email sent',
  1: 'Welcome email sent',
};

// -- Month helpers --

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
}

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES_FULL[parseInt(month, 10)]} ${year}`;
}

function formatMonthShort(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTH_NAMES[parseInt(month, 10)]} ${year}`;
}

function groupUsersByMonth(users: DisplayUser[]): { key: string; label: string; users: DisplayUser[] }[] {
  const map = new Map<string, DisplayUser[]>();
  for (const u of users) {
    const k = getMonthKey(u.createdAt);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(u);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, users]) => ({ key, label: formatMonthLabel(key), users }));
}

// -- Cohort analysis --

interface CohortRow {
  month: string;
  label: string;
  invited: number;
  total: number;
  calendar: number;
  enriched: number;
  connected: number;
  introCreated: number;
  introSuccess: number;
  introsSent: number;
  introsOK: number;
}

const COHORT_COLS = [
  { key: 'invited', label: 'Invited', color: '#f97316', rateBase: 'invited' },
  { key: 'total', label: 'Signed Up', color: '#facc15', rateBase: 'invited' },
  { key: 'calendar', label: 'Calendar', color: '#60a5fa', rateBase: 'total' },
  { key: 'enriched', label: 'Enriched', color: '#c084fc', rateBase: 'total' },
  { key: 'connected', label: '1-1 / Space', color: '#4ade80', rateBase: 'total' },
  { key: 'introCreated', label: 'Intro Created', color: '#38bdf8', rateBase: 'total' },
  { key: 'introSuccess', label: 'Intro Success', color: '#a78bfa', rateBase: 'total' },
] as const;

function buildCohorts(users: AdminUser[], pendingInvites: AdminPendingInvite[]): CohortRow[] {
  const userMap = new Map<string, AdminUser[]>();
  for (const u of users) {
    const k = getMonthKey(u.createdAt);
    if (!userMap.has(k)) userMap.set(k, []);
    userMap.get(k)!.push(u);
  }

  // Count pending (unconverted) invites by month
  const inviteMap = new Map<string, number>();
  for (const inv of pendingInvites) {
    const k = getMonthKey(inv.createdAt);
    inviteMap.set(k, (inviteMap.get(k) || 0) + 1);
  }

  // Merge all month keys
  const allMonths = new Set([...userMap.keys(), ...inviteMap.keys()]);

  return Array.from(allMonths)
    .sort((a, b) => b.localeCompare(a))
    .map(month => {
      const cohort = userMap.get(month) || [];
      const pendingCount = inviteMap.get(month) || 0;
      return {
        month,
        label: formatMonthShort(month),
        invited: cohort.length + pendingCount,
        total: cohort.length,
        calendar: cohort.filter(u => u.calendarConnected).length,
        enriched: cohort.filter(u => u.enrichedContactCount > 0).length,
        connected: cohort.filter(u => u.connectionsCount > 0).length,
        introCreated: cohort.filter(u => (u.introRequestsSent + u.introRequestsReceived) > 0).length,
        introSuccess: cohort.filter(u => (u.introRequestsSuccessful + u.introRequestsReceivedSuccessful) > 0).length,
        introsSent: cohort.reduce((s, u) => s + u.introRequestsSent, 0),
        introsOK: cohort.reduce((s, u) => s + u.introRequestsSuccessful, 0),
      };
    });
}

export function AdminPage() {
  const { isAuthenticated, isLoading, currentUser } = useAppState();
  const { logout } = useAppActions();
  const navigate = useNavigate();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 200, pages: 1 });
  const [pendingInvites, setPendingInvites] = useState<AdminPendingInvite[]>([]);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const sortField = 'createdAt';
  const sortOrder = 'desc';
  const [activityChart, setActivityChart] = useState<{ wau: { week: string; count: number }[]; mau: { month: string; count: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const isAdmin = currentUser?.role === 'admin';

  // Redirect non-admins
  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isAdmin)) {
      navigate('/home');
    }
  }, [isLoading, isAuthenticated, isAdmin, navigate]);

  const fetchData = useCallback(async (p?: { search?: string; sort?: string; order?: string; page?: number }) => {
    try {
      setLoading(true);
      setError(null);
      const params = {
        search: p?.search ?? search,
        sort: p?.sort ?? sortField,
        order: p?.order ?? sortOrder,
        page: p?.page ?? pagination.page,
        limit: pagination.limit,
      };
      const [statsRes, usersRes, invitesRes, chartRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.getUsers(params),
        adminApi.getPendingInvites(),
        adminApi.getActivityChart(),
      ]);
      setStats(statsRes);
      setUsers(usersRes.data);
      setPagination(usersRes.pagination);
      setPendingInvites(invitesRes);
      setActivityChart(chartRes);
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [search, sortField, sortOrder, pagination.page, pagination.limit]);

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchData({ search: val, page: 1 });
    }, 300);
  };

  const cohorts = useMemo(() => buildCohorts(users, pendingInvites), [users, pendingInvites]);

  const allDisplayUsers: DisplayUser[] = useMemo(() => {
    const inviteUsers = pendingInvites.map(pendingInviteToDisplayUser);
    return [...users, ...inviteUsers];
  }, [users, pendingInvites]);

  const filteredUsers = useMemo(() => {
    let result = allDisplayUsers;
    if (monthFilter) result = result.filter(u => getMonthKey(u.createdAt) === monthFilter);
    if (statusFilter) result = result.filter(u => u.status === statusFilter);
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter(u => new Date(u.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(u => new Date(u.createdAt) <= to);
    }
    return result;
  }, [allDisplayUsers, monthFilter, statusFilter, dateFrom, dateTo]);

  const handleCohortClick = (month: string) => {
    setMonthFilter(prev => prev === month ? null : month);
  };

  const handlePageChange = (page: number) => {
    fetchData({ page });
  };

  const handleDeleteUser = async (userId: string, userName: string, userEmail: string) => {
    if (!confirm(`Are you sure you want to permanently delete "${userName}" (${userEmail})?\n\nThis will cascade-delete ALL their data (contacts, spaces, intros, etc.) and cannot be undone.`)) return;
    if (!confirm(`FINAL WARNING: This action is irreversible. Delete "${userEmail}"?`)) return;
    try {
      await adminApi.deleteUser(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      if (expandedUser === userId) setExpandedUser(null);
    } catch (err: any) {
      alert(err.message || 'Failed to delete user');
    }
  };

  const handleRoleToggle = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (newRole === 'admin' && !confirm(`Promote this user to admin?`)) return;
    if (newRole === 'user' && !confirm(`Remove admin access from this user?`)) return;
    try {
      await adminApi.setUserRole(userId, newRole);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err: any) {
      alert(err.message || 'Failed to update role');
    }
  };

  if (isLoading || !isAdmin) {
    return (
      <div className="admin-page">
        <div className="admin-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="admin-header-left">
          <button className="admin-back-btn" onClick={() => navigate('/home')} title="Back to app">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h1 className="admin-title">Admin Dashboard</h1>
        </div>
        <div className="admin-header-right">
          <span className="admin-user-name">{currentUser?.name}</span>
          <button className="admin-logout-btn" onClick={logout}>Log out</button>
        </div>
      </header>

      {error && <div className="admin-error">{error}</div>}

      {/* Active Users Chart */}
      {!loading && activityChart && (activityChart.wau.length > 0 || activityChart.mau.length > 0) && (
        <div className="admin-au-section">
          <div className="admin-au-header">
            <span className="admin-au-title">Active Users</span>
          </div>
          <div className="admin-au-charts">
            {activityChart.mau.length > 0 && (
              <div className="admin-au-chart">
                <div className="admin-au-chart-label">Monthly Active Users (MAU)</div>
                <div className="admin-au-bars">
                  {(() => {
                    const max = Math.max(...activityChart.mau.map(m => m.count), 1);
                    return activityChart.mau.map(m => (
                      <div key={m.month} className="admin-au-bar-col">
                        <span className="admin-au-bar-val">{m.count}</span>
                        <div className="admin-au-bar-track">
                          <div className="admin-au-bar-fill mau" style={{ height: `${Math.max(4, Math.round((m.count / max) * 100))}%` }} />
                        </div>
                        <span className="admin-au-bar-label">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
            {activityChart.wau.length > 0 && (
              <div className="admin-au-chart">
                <div className="admin-au-chart-label">Weekly Active Users (WAU)</div>
                <div className="admin-au-bars">
                  {(() => {
                    const max = Math.max(...activityChart.wau.map(w => w.count), 1);
                    const recent = activityChart.wau.slice(-12);
                    return recent.map(w => {
                      const d = new Date(w.week);
                      const label = `${d.getMonth() + 1}/${d.getDate()}`;
                      return (
                        <div key={w.week} className="admin-au-bar-col">
                          <span className="admin-au-bar-val">{w.count}</span>
                          <div className="admin-au-bar-track">
                            <div className="admin-au-bar-fill wau" style={{ height: `${Math.max(4, Math.round((w.count / max) * 100))}%` }} />
                          </div>
                          <span className="admin-au-bar-label">{label}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cohort analysis */}
      {!loading && users.length > 0 && (
        <div className="admin-cohort-section">
          <div className="admin-cohort-header">
            <span className="admin-cohort-title">Cohort Analysis</span>
          </div>
          <div className="admin-cohort-scroll">
            <table className="admin-cohort-table">
              <thead>
                <tr>
                  <th className="admin-cohort-month-col">Cohort</th>
                  {COHORT_COLS.map(col => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map(row => {
                  const isActive = monthFilter === row.month;
                  return (
                    <tr
                      key={row.month}
                      className={`admin-cohort-row ${isActive ? 'active' : ''}`}
                      onClick={() => handleCohortClick(row.month)}
                    >
                      <td className="admin-cohort-month-cell">
                        <span className="admin-cohort-month-text">{row.label}</span>
                      </td>
                      {COHORT_COLS.map(col => {
                        const val = row[col.key as keyof CohortRow] as number;
                        const base = col.rateBase ? (row[col.rateBase as keyof CohortRow] as number) : 0;
                        const hasRate = col.rateBase !== null && base > 0;
                        const pct = hasRate ? Math.round((val / base) * 100) : 0;
                        const barHeight = row.invited > 0 && col.rateBase !== null
                          ? Math.max(18, Math.round((val / row.invited) * 100))
                          : (row.invited > 0 ? Math.max(18, Math.round((val / row.invited) * 100)) : 18);
                        return (
                          <td key={col.key} className="admin-cohort-cell">
                            <div className="admin-cohort-bar-wrap">
                              <div
                                className="admin-cohort-bar"
                                style={{
                                  height: `${barHeight}%`,
                                  backgroundColor: `${col.color}30`,
                                  borderColor: `${col.color}60`,
                                }}
                              >
                                <span className="admin-cohort-val">{val}</span>
                                {hasRate && (
                                  <span className="admin-cohort-pct" style={{ color: col.color }}>{pct}%</span>
                                )}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Intro activity by month */}
      {!loading && cohorts.length > 0 && (
        <div className="admin-intro-activity">
          <div className="admin-intro-activity-header">
            <span className="admin-intro-activity-title">Intro Requests by Month</span>
            {stats && (
              <span className="admin-intro-activity-total">
                {stats.totalIntroRequests} total &middot; {stats.successfulIntroRequests} successful &middot; {stats.totalIntroOffers} offers
              </span>
            )}
          </div>
          <div className="admin-intro-activity-bars">
            {cohorts.filter(r => r.introsSent > 0 || r.introsOK > 0).length === 0 ? (
              <span className="admin-intro-activity-empty">No intro requests yet</span>
            ) : cohorts.map(row => {
              const maxSent = Math.max(...cohorts.map(r => r.introsSent), 1);
              const sentWidth = Math.round((row.introsSent / maxSent) * 100);
              const okWidth = row.introsSent > 0 ? Math.round((row.introsOK / row.introsSent) * 100) : 0;
              return (
                <div key={row.month} className="admin-intro-activity-row">
                  <span className="admin-intro-activity-month">{row.label}</span>
                  <div className="admin-intro-activity-track">
                    <div className="admin-intro-activity-bar sent" style={{ width: `${sentWidth}%` }}>
                      <div className="admin-intro-activity-bar ok" style={{ width: `${okWidth}%` }} />
                    </div>
                  </div>
                  <span className="admin-intro-activity-nums">
                    <span className="admin-intro-activity-ok">{row.introsOK}</span>
                    <span className="admin-intro-activity-sep">/</span>
                    <span>{row.introsSent}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="admin-intro-activity-legend">
            <span className="admin-intro-activity-legend-item"><span className="admin-intro-legend-swatch sent" /> Requested</span>
            <span className="admin-intro-activity-legend-item"><span className="admin-intro-legend-swatch ok" /> Successful</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="admin-controls">
        <input
          className="admin-search"
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />

        <div className="admin-filter-group">
          <span className="admin-filter-label">Status</span>
          <div className="admin-filter-pills">
            <button
              className={`admin-filter-pill ${statusFilter === null ? 'active' : ''}`}
              onClick={() => setStatusFilter(null)}
            >All</button>
            {STATUS_FILTER_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className={`admin-filter-pill ${statusFilter === opt.key ? 'active' : ''}`}
                onClick={() => setStatusFilter(statusFilter === opt.key ? null : opt.key)}
              >
                <span className="admin-filter-dot" style={{ backgroundColor: opt.color }} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-filter-group">
          <span className="admin-filter-label">Created</span>
          <div className="admin-filter-dates">
            <input type="date" className="admin-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span className="admin-date-sep">—</span>
            <input type="date" className="admin-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            {(dateFrom || dateTo) && (
              <button className="admin-filter-clear" onClick={() => { setDateFrom(''); setDateTo(''); }}>&times;</button>
            )}
          </div>
        </div>

        {monthFilter && (
          <button className="admin-filter-tab active" onClick={() => setMonthFilter(null)}>
            {formatMonthShort(monthFilter)}
            <span style={{ marginLeft: 4, opacity: 0.6 }}>&times;</span>
          </button>
        )}
      </div>

      {/* Users table */}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: '220px' }}>User</th>
              <th style={{ width: '120px' }}>Status</th>
              <th style={{ width: '400px' }}>Activation</th>
              <th style={{ width: '180px' }}>Intros</th>
              <th style={{ width: '150px' }}>Activity</th>
              <th style={{ width: '80px' }}>Role</th>
              <th style={{ width: '50px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && filteredUsers.length === 0 ? (
              <tr><td colSpan={COL_COUNT} className="admin-table-empty">Loading...</td></tr>
            ) : filteredUsers.length === 0 ? (
              <tr><td colSpan={COL_COUNT} className="admin-table-empty">No users found</td></tr>
            ) : groupUsersByMonth(filteredUsers).map(group => (
              <MonthGroup
                key={group.key}
                label={group.label}
                count={group.users.length}
                users={group.users}
                expandedUser={expandedUser}
                onToggleExpand={(id) => setExpandedUser(expandedUser === id ? null : id)}
                onRoleToggle={handleRoleToggle}
                onDeleteUser={handleDeleteUser}
                currentUserId={currentUser?.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="admin-pagination">
          <button disabled={pagination.page <= 1} onClick={() => handlePageChange(pagination.page - 1)}>Prev</button>
          <span>Page {pagination.page} of {pagination.pages} ({pagination.total} users)</span>
          <button disabled={pagination.page >= pagination.pages} onClick={() => handlePageChange(pagination.page + 1)}>Next</button>
        </div>
      )}

    </div>
  );
}

function MonthGroup({ label, count, users, expandedUser, onToggleExpand, onRoleToggle, onDeleteUser, currentUserId }: {
  label: string;
  count: number;
  users: DisplayUser[];
  expandedUser: string | null;
  onToggleExpand: (id: string) => void;
  onRoleToggle: (id: string, role: string) => void;
  onDeleteUser: (id: string, name: string, email: string) => void;
  currentUserId?: string;
}) {
  return (
    <>
      <tr className="admin-month-header">
        <td colSpan={COL_COUNT}>
          <span className="admin-month-label">{label}</span>
          <span className="admin-month-count">{count}</span>
        </td>
      </tr>
      {users.map(user => (
        <UserRow
          key={user.id}
          user={user}
          expanded={expandedUser === user.id}
          onToggleExpand={() => onToggleExpand(user.id)}
          onRoleToggle={onRoleToggle}
          onDeleteUser={onDeleteUser}
          isSelf={user.id === currentUserId}
        />
      ))}
    </>
  );
}

function UserRow({ user, expanded, onToggleExpand, onRoleToggle, onDeleteUser, isSelf }: {
  user: DisplayUser;
  expanded: boolean;
  onToggleExpand: () => void;
  onRoleToggle: (id: string, role: string) => void;
  onDeleteUser: (id: string, name: string, email: string) => void;
  isSelf: boolean;
}) {
  const steps = getUserCompletedSteps(user);
  const isPending = 'isPendingInvite' in user && user.isPendingInvite;

  return (
    <>
      <tr className={`admin-user-row ${expanded ? 'expanded' : ''} ${isPending ? 'pending-invite' : ''}`} onClick={onToggleExpand}>
        <td>
          <div className="admin-user-cell">
            {user.avatar ? (
              <img className="admin-avatar" src={user.avatar} alt="" />
            ) : (
              <div className="admin-avatar admin-avatar-placeholder">{user.name.charAt(0).toUpperCase()}</div>
            )}
            <div>
              <div className="admin-user-name-text">{user.name}</div>
              <div className="admin-user-email">{user.email}</div>
            </div>
          </div>
        </td>
        <td>
          {(() => {
            const s = getStatusDisplay(user.status);
            return (
              <span className="admin-status-badge" style={{ '--status-color': s.color } as React.CSSProperties}>
                <span className="admin-status-dot" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
            );
          })()}
        </td>
        <td>
          <div className="admin-user-funnel">
            <div className="admin-user-funnel-dots">
              {USER_FUNNEL_STEPS.map((step, i) => (
                <div key={step.key} className="admin-user-funnel-step">
                  <div
                    className={`admin-user-funnel-dot ${steps[i] ? 'done' : ''}`}
                    style={{ '--step-color': step.color } as React.CSSProperties}
                    title={step.label}
                  >
                    {steps[i] && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                    )}
                  </div>
                  {i < USER_FUNNEL_STEPS.length - 1 && (
                    <div className={`admin-user-funnel-line ${steps[i] ? 'done' : ''}`}>
                      {FUNNEL_EMAILS[i] && steps[i] && (
                        <div className="admin-funnel-email" title={FUNNEL_EMAILS[i]}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="admin-user-funnel-labels">
              {USER_FUNNEL_STEPS.map((step, i) => (
                <span key={step.key} className={`admin-user-funnel-label ${steps[i] ? 'done' : ''}`}>
                  {step.label}
                </span>
              ))}
            </div>
          </div>
        </td>
        <td>
          <div className="admin-user-intros">
            <div className="admin-user-intro-row">
              <span className="admin-user-intro-label">Sent</span>
              <span className="admin-user-intro-nums">{user.introRequestsSuccessful}<span className="admin-user-intro-sep">/</span>{user.introRequestsSent}</span>
            </div>
            <div className="admin-user-intro-row">
              <span className="admin-user-intro-label">Recv</span>
              <span className="admin-user-intro-nums">{user.introRequestsReceivedSuccessful}<span className="admin-user-intro-sep">/</span>{user.introRequestsReceived}</span>
            </div>
          </div>
        </td>
        <td>
          <div className="admin-user-activity">
            <div className="admin-user-activity-row">
              <span className="admin-user-activity-label">7d</span>
              <div className="admin-user-activity-bar-track">
                {user.activeDays7 > 0 && (
                  <div className="admin-user-activity-bar-fill" style={{ width: `${Math.round((user.activeDays7 / 7) * 100)}%` }} />
                )}
              </div>
              <span className={`admin-user-activity-val ${user.activeDays7 === 0 ? 'zero' : ''}`}>{user.activeDays7}/7</span>
            </div>
            <div className="admin-user-activity-row">
              <span className="admin-user-activity-label">30d</span>
              <div className="admin-user-activity-bar-track">
                {user.activeDays30 > 0 && (
                  <div className="admin-user-activity-bar-fill" style={{ width: `${Math.round((user.activeDays30 / 30) * 100)}%` }} />
                )}
              </div>
              <span className={`admin-user-activity-val ${user.activeDays30 === 0 ? 'zero' : ''}`}>{user.activeDays30}/30</span>
            </div>
            {user.lastActiveAt ? (
              <div className="admin-user-activity-last">
                Last: {new Date(user.lastActiveAt).toLocaleDateString()}
              </div>
            ) : (
              <div className="admin-user-activity-last zero">Never</div>
            )}
          </div>
        </td>
        <td>
          <span className={`admin-role-badge ${user.role === 'admin' ? 'admin-role-admin' : user.role === 'invited' ? 'admin-role-invited' : ''}`}>
            {user.role}
          </span>
        </td>
        <td onClick={e => e.stopPropagation()}>
          <div className="admin-actions-cell">
            {!isSelf && !isPending && (
              <button
                className="admin-role-toggle-btn"
                onClick={() => onRoleToggle(user.id, user.role)}
                title={user.role === 'admin' ? 'Remove admin' : 'Make admin'}
              >
                {user.role === 'admin' ? '\u2212' : '+'}
              </button>
            )}
            {!isSelf && !isPending && (
              <button
                className="admin-delete-btn"
                onClick={() => onDeleteUser(user.id, user.name, user.email)}
                title="Permanently delete user"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="admin-detail-row">
          <td colSpan={COL_COUNT}>
            <div className="admin-detail-grid">
              {isPending && 'invitedBy' in user && (
                <DetailItem label="Invited By" value={user.invitedBy || '—'} />
              )}
              <DetailItem label={isPending ? 'Invited' : 'Joined'} value={new Date(user.createdAt).toLocaleDateString()} />
              {!isPending && (
                <>
                  <DetailItem label="Calendar" value={user.calendarConnected ? 'Connected' : 'No'} ok={user.calendarConnected} />
                  <DetailItem label="Contacts" value={String(user.contactsCount)} />
                  <DetailItem label="Identified" value={String(user.identifiedContactCount)} ok={user.identifiedContactCount > 0} />
                  <DetailItem label="Enriched" value={String(user.enrichedContactCount)} ok={user.enrichedContactCount > 0} />
                  <DetailItem label="Connections" value={String(user.connectionsCount)} ok={user.connectionsCount > 0} />
                  <DetailItem label="Intros Requested" value={String(user.introRequestsSent)} />
                  <DetailItem label="Intros Successful" value={String(user.introRequestsSuccessful)} ok={user.introRequestsSuccessful > 0} />
                  <DetailItem label="Intros Received" value={String(user.introRequestsReceived)} />
                  <DetailItem label="Received Successful" value={String(user.introRequestsReceivedSuccessful)} ok={user.introRequestsReceivedSuccessful > 0} />
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailItem({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="admin-detail-item">
      <span className="admin-detail-label">{label}</span>
      <span className={`admin-detail-value ${ok === true ? 'ok' : ok === false ? 'not-ok' : ''}`}>{value}</span>
    </div>
  );
}
