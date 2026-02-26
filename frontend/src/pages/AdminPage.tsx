import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppState, useAppActions } from '../store';
import { adminApi, type AdminUser, type AdminStats, type AdminPendingInvite } from '../lib/api';

const FUNNEL_STAGES = [
  { key: '', label: 'All' },
  { key: 'signed_up', label: 'Signed Up' },
  { key: 'calendar_connected', label: 'Calendar Connected' },
  { key: 'contacts_enriched', label: 'Contacts Enriched' },
  { key: 'first_connection', label: 'First Connection' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  signed_up: '#facc15',
  calendar_connected: '#60a5fa',
  contacts_enriched: '#c084fc',
  first_connection: '#4ade80',
};

const STATUS_LABELS: Record<string, string> = {
  signed_up: 'Signed Up',
  calendar_connected: 'Calendar',
  contacts_enriched: 'Enriched',
  first_connection: 'Connected',
};

type SortField = 'name' | 'email' | 'createdAt' | 'status' | 'introRequestsSent' | 'introRequestsSuccessful' | 'introRequestsReceived' | 'introRequestsReceivedSuccessful' | 'role';

const COLUMNS: { key: SortField | 'actions'; label: string; sortable: boolean; width?: string }[] = [
  { key: 'name', label: 'User', sortable: true, width: '200px' },
  { key: 'status', label: 'Status', sortable: true, width: '120px' },
  { key: 'createdAt', label: 'Signed Up', sortable: true, width: '110px' },
  { key: 'introRequestsSent', label: 'Intros Sent', sortable: true, width: '100px' },
  { key: 'introRequestsSuccessful', label: 'Sent OK', sortable: true, width: '80px' },
  { key: 'introRequestsReceived', label: 'Intros Recv', sortable: true, width: '100px' },
  { key: 'introRequestsReceivedSuccessful', label: 'Recv OK', sortable: true, width: '80px' },
  { key: 'role', label: 'Role', sortable: true, width: '90px' },
  { key: 'actions', label: '', sortable: false, width: '60px' },
];

export function AdminPage() {
  const { isAuthenticated, isLoading, currentUser } = useAppState();
  const { logout } = useAppActions();
  const navigate = useNavigate();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 50, pages: 1 });
  const [pendingInvites, setPendingInvites] = useState<AdminPendingInvite[]>([]);
  const [showInvites, setShowInvites] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
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

  const fetchData = useCallback(async (p?: { search?: string; status?: string; sort?: string; order?: string; page?: number }) => {
    try {
      setLoading(true);
      setError(null);
      const params = {
        search: p?.search ?? search,
        status: p?.status ?? statusFilter,
        sort: p?.sort ?? sortField,
        order: p?.order ?? sortOrder,
        page: p?.page ?? pagination.page,
        limit: pagination.limit,
      };
      const [statsRes, usersRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.getUsers(params),
      ]);
      setStats(statsRes);
      setUsers(usersRes.data);
      setPagination(usersRes.pagination);
    } catch (err: any) {
      setError(err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, sortField, sortOrder, pagination.page, pagination.limit]);

  useEffect(() => {
    if (isAdmin) fetchData();
  }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadInvites = useCallback(async () => {
    try {
      const res = await adminApi.getPendingInvites();
      setPendingInvites(res);
    } catch {}
  }, []);

  useEffect(() => {
    if (showInvites) loadInvites();
  }, [showInvites, loadInvites]);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchData({ search: val, page: 1 });
    }, 300);
  };

  const handleSort = (field: SortField) => {
    const newOrder = field === sortField ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc';
    setSortField(field);
    setSortOrder(newOrder);
    fetchData({ sort: field, order: newOrder, page: 1 });
  };

  const handleStatusFilter = (status: string) => {
    setStatusFilter(status);
    fetchData({ status, page: 1 });
  };

  const handlePageChange = (page: number) => {
    fetchData({ page });
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

      {/* Summary cards */}
      {stats && (
        <div className="admin-stats-grid">
          <StatCard label="Total Users" value={stats.totalUsers} />
          <StatCard label="Calendar Connected" value={stats.usersWithCalendar} accent="#60a5fa" />
          <StatCard label="Contacts Enriched" value={stats.usersWithEnrichedContacts} accent="#c084fc" />
          <StatCard label="First Connection" value={stats.usersWithConnection} accent="#4ade80" />
          <StatCard label="Pending Invites" value={stats.pendingInvites} accent="#facc15" />
          <StatCard label="Intros Requested" value={stats.totalIntroRequests} />
          <StatCard label="Intros Successful" value={stats.successfulIntroRequests} accent="#4ade80" />
          <StatCard label="Intro Offers" value={stats.totalIntroOffers} />
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
        <div className="admin-filter-tabs">
          {FUNNEL_STAGES.map(s => (
            <button
              key={s.key}
              className={`admin-filter-tab ${statusFilter === s.key ? 'active' : ''}`}
              onClick={() => handleStatusFilter(s.key)}
            >
              {s.key && <span className="admin-filter-dot" style={{ background: STATUS_COLORS[s.key] || 'var(--text-muted)' }} />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={col.sortable ? 'sortable' : ''}
                  onClick={() => col.sortable && col.key !== 'actions' && handleSort(col.key as SortField)}
                >
                  {col.label}
                  {col.sortable && sortField === col.key && (
                    <span className="admin-sort-arrow">{sortOrder === 'asc' ? ' \u25B2' : ' \u25BC'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="admin-table-empty">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="admin-table-empty">No users found</td></tr>
            ) : users.map(user => (
              <UserRow
                key={user.id}
                user={user}
                expanded={expandedUser === user.id}
                onToggleExpand={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                onRoleToggle={handleRoleToggle}
                isSelf={user.id === currentUser?.id}
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

      {/* Pending Invites */}
      <div className="admin-section">
        <button className="admin-section-toggle" onClick={() => setShowInvites(!showInvites)}>
          <span>{showInvites ? '\u25BC' : '\u25B6'} Pending Invites ({stats?.pendingInvites ?? 0})</span>
        </button>
        {showInvites && (
          <div className="admin-invites-list">
            {pendingInvites.length === 0 ? (
              <div className="admin-table-empty">No pending invites</div>
            ) : (
              <table className="admin-table admin-invites-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Invited By</th>
                    <th>Space</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingInvites.map(inv => (
                    <tr key={inv.id}>
                      <td>{inv.email}</td>
                      <td>{inv.invitedBy.name}</td>
                      <td>{inv.space ? `${inv.space.emoji} ${inv.space.name}` : '1:1'}</td>
                      <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="admin-stat-label">{label}</div>
    </div>
  );
}

function UserRow({ user, expanded, onToggleExpand, onRoleToggle, isSelf }: {
  user: AdminUser;
  expanded: boolean;
  onToggleExpand: () => void;
  onRoleToggle: (id: string, role: string) => void;
  isSelf: boolean;
}) {
  const statusColor = STATUS_COLORS[user.status] || 'var(--text-muted)';
  const statusLabel = STATUS_LABELS[user.status] || user.status;

  return (
    <>
      <tr className={`admin-user-row ${expanded ? 'expanded' : ''}`} onClick={onToggleExpand}>
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
          <span className="admin-status-badge" style={{ background: `${statusColor}22`, color: statusColor, borderColor: `${statusColor}44` }}>
            {statusLabel}
          </span>
        </td>
        <td className="admin-date">{new Date(user.createdAt).toLocaleDateString()}</td>
        <td className="admin-num">{user.introRequestsSent}</td>
        <td className="admin-num">{user.introRequestsSuccessful}</td>
        <td className="admin-num">{user.introRequestsReceived}</td>
        <td className="admin-num">{user.introRequestsReceivedSuccessful}</td>
        <td>
          <span className={`admin-role-badge ${user.role === 'admin' ? 'admin-role-admin' : ''}`}>
            {user.role}
          </span>
        </td>
        <td onClick={e => e.stopPropagation()}>
          {!isSelf && (
            <button
              className="admin-role-toggle-btn"
              onClick={() => onRoleToggle(user.id, user.role)}
              title={user.role === 'admin' ? 'Remove admin' : 'Make admin'}
            >
              {user.role === 'admin' ? '\u2212' : '+'}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="admin-detail-row">
          <td colSpan={COLUMNS.length}>
            <div className="admin-detail-grid">
              <DetailItem label="Calendar" value={user.calendarConnected ? 'Connected' : 'Not connected'} ok={user.calendarConnected} />
              <DetailItem label="Contacts" value={String(user.contactsCount)} />
              <DetailItem label="Enriched" value={String(user.enrichedContactCount)} ok={user.enrichedContactCount > 0} />
              <DetailItem label="Connections" value={String(user.connectionsCount)} ok={user.connectionsCount > 0} />
              <DetailItem label="Intros Sent" value={`${user.introRequestsSuccessful} / ${user.introRequestsSent}`} />
              <DetailItem label="Intros Recv" value={`${user.introRequestsReceivedSuccessful} / ${user.introRequestsReceived}`} />
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
