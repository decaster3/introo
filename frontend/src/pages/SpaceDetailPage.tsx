import { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAppState, useAppDispatch } from '../store';
import { Contact } from './HomePage';
import { API_BASE } from '../lib/api';
import { CompanyLogo, Pagination, PersonAvatar } from '../components';
import { calculateStrength } from '../types';
import { openOfferIntroEmail } from '../lib/offerIntro';

interface SpaceRequest {
  id: string;
  requesterId: string;
  rawText: string;
  normalizedQuery: Record<string, string>;
  bidAmount: number;
  status: string;
  createdAt: string;
  requester: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
  offers: {
    id: string;
    introducerId: string;
    status: string;
    introducer: {
      id: string;
      name: string;
      avatar: string | null;
    };
  }[];
}

interface SpaceMember {
  id: string;
  role: string;
  status?: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
}

interface Space {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  isPrivate: boolean;
  inviteCode: string;
  ownerId: string;
  members: SpaceMember[];
  requests: SpaceRequest[];
  pendingCount?: number;
}

// Industry and size options
const industryOptions = [
  { value: 'fintech', label: 'Fintech' },
  { value: 'saas', label: 'SaaS' },
  { value: 'ai', label: 'AI / ML' },
  { value: 'developer_tools', label: 'Developer Tools' },
  { value: 'design', label: 'Design' },
  { value: 'vc', label: 'VC / Investment' },
];

const sizeOptions = [
  { value: 'startup', label: 'Startup (1-50)' },
  { value: 'scaleup', label: 'Scale-up (51-500)' },
  { value: 'enterprise', label: 'Enterprise (500+)' },
];

interface SpaceCompany {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  sizeBucket: string | null;
  logo: string | null;
  contactCount: number;
  contacts: {
    id: string;
    name: string;
    email: string;
    title: string | null;
    userId: string;
    userName: string;
  }[];
}

const COMPANIES_PER_PAGE = 20;

export function SpaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser, contacts: storeContacts } = useAppState();
  const dispatch = useAppDispatch();
  const [space, setSpace] = useState<Space | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [copied, setCopied] = useState(false);

  // Transform store contacts to display format
  const contacts: Contact[] = useMemo(() => {
    return storeContacts
      .filter(c => c.isApproved)
      .map(c => ({
        id: c.id,
        name: c.name || 'Unknown',
        email: c.email,
        avatar: '', // Not used - we use PersonAvatar component instead
        title: c.title || '',
        company: c.company?.name || '',
        companyDomain: c.company?.domain || '',
        lastContacted: new Date(c.lastSeenAt),
        connectionStrength: calculateStrength(c.lastSeenAt, c.meetingsCount),
      }));
  }, [storeContacts]);
  const [activeTab, setActiveTab] = useState<'requests' | 'reach' | 'members' | 'admin'>('requests');
  
  // Admin tab state
  const [pendingMembers, setPendingMembers] = useState<SpaceMember[]>([]);
  
  // Space reach state
  const [spaceCompanies, setSpaceCompanies] = useState<SpaceCompany[]>([]);
  const [reachLoading, setReachLoading] = useState(false);
  const [_reachStats, setReachStats] = useState({ totalCompanies: 0, totalContacts: 0, memberCount: 0 });
  void _reachStats; // Stats available for future use
  
  // Filters for Space Reach
  const [reachSearchQuery, setReachSearchQuery] = useState('');
  const [reachSortBy, setReachSortBy] = useState<'contacts' | 'name'>('contacts');
  const [showReachFilters, setShowReachFilters] = useState(false);
  const [selectedContactCounts, setSelectedContactCounts] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [hideMyContacts, setHideMyContacts] = useState(true); // Default to showing only others' contacts
  const [currentPage, setCurrentPage] = useState(1);
  
  // Intro request modal state
  const [showIntroModal, setShowIntroModal] = useState(false);
  const [introTarget, setIntroTarget] = useState<{ company: string; role: string; domain: string } | null>(null);
  const [introMessage, setIntroMessage] = useState('');
  const [introOffer, setIntroOffer] = useState('');
  const [isSubmittingIntro, setIsSubmittingIntro] = useState(false);

  // Filter and sort companies
  const filteredCompanies = useMemo(() => {
    // First, filter out my contacts if hideMyContacts is enabled
    let companies = spaceCompanies.map(company => {
      if (!hideMyContacts || !currentUser) return company;
      
      // Filter out contacts that belong to the current user
      const filteredContacts = company.contacts.filter(c => c.userId !== currentUser.id);
      
      // Only include company if it still has contacts after filtering
      if (filteredContacts.length === 0) return null;
      
      return {
        ...company,
        contacts: filteredContacts,
        contactCount: filteredContacts.length,
      };
    }).filter((c): c is SpaceCompany => c !== null);

    // Text search
    if (reachSearchQuery) {
      const query = reachSearchQuery.toLowerCase();
      companies = companies.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.domain.toLowerCase().includes(query)
      );
    }

    // Contact count filter
    if (selectedContactCounts.length > 0) {
      companies = companies.filter(c => {
        if (selectedContactCounts.includes('1') && c.contactCount === 1) return true;
        if (selectedContactCounts.includes('2-5') && c.contactCount >= 2 && c.contactCount <= 5) return true;
        if (selectedContactCounts.includes('5+') && c.contactCount > 5) return true;
        return false;
      });
    }

    // Industry filter
    if (selectedIndustries.length > 0) {
      companies = companies.filter(c => c.industry && selectedIndustries.includes(c.industry));
    }

    // Size filter
    if (selectedSizes.length > 0) {
      companies = companies.filter(c => c.sizeBucket && selectedSizes.includes(c.sizeBucket));
    }

    // Sort
    return companies.sort((a, b) => {
      if (reachSortBy === 'contacts') {
        return b.contactCount - a.contactCount;
      }
      return a.name.localeCompare(b.name);
    });
  }, [spaceCompanies, reachSearchQuery, reachSortBy, selectedContactCounts, selectedIndustries, selectedSizes, hideMyContacts, currentUser]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [reachSearchQuery, reachSortBy, selectedContactCounts, selectedIndustries, selectedSizes, hideMyContacts]);

  // Paginated companies
  const totalPages = Math.ceil(filteredCompanies.length / COMPANIES_PER_PAGE);
  const paginatedCompanies = useMemo(() => {
    const startIndex = (currentPage - 1) * COMPANIES_PER_PAGE;
    return filteredCompanies.slice(startIndex, startIndex + COMPANIES_PER_PAGE);
  }, [filteredCompanies, currentPage]);

  const toggleContactCount = (count: string) => {
    setSelectedContactCounts(prev =>
      prev.includes(count)
        ? prev.filter(c => c !== count)
        : [...prev, count]
    );
  };

  const toggleIndustry = (industry: string) => {
    setSelectedIndustries(prev =>
      prev.includes(industry)
        ? prev.filter(i => i !== industry)
        : [...prev, industry]
    );
  };

  const toggleSize = (size: string) => {
    setSelectedSizes(prev =>
      prev.includes(size)
        ? prev.filter(s => s !== size)
        : [...prev, size]
    );
  };

  const clearReachFilters = () => {
    setReachSearchQuery('');
    setSelectedContactCounts([]);
    setSelectedIndustries([]);
    setSelectedSizes([]);
  };

  const activeReachFilterCount = selectedContactCounts.length + selectedIndustries.length + selectedSizes.length;

  // Open intro request modal
  const openIntroModal = (company: string, role: string, domain: string) => {
    setIntroTarget({ company, role, domain });
    setIntroMessage(`Looking for an intro to someone at ${company} in ${role}.`);
    setIntroOffer('$100 for a successful intro');
    setShowIntroModal(true);
  };

  // Offer intro via email
  const offerIntro = (request: SpaceRequest, contactName?: string) => {
    openOfferIntroEmail({
      requesterEmail: request.requester.email,
      requesterName: request.requester.name,
      targetCompany: request.normalizedQuery?.targetCompany || 'the company',
      contactName,
      senderName: currentUser?.name,
    });
  };

  // Submit intro request
  const submitIntroRequest = async () => {
    if (!introTarget || !introMessage.trim() || !id || !currentUser) return;
    
    setIsSubmittingIntro(true);
    try {
      // Parse amount from offer if it's a money amount
      const moneyMatch = introOffer.match(/\$(\d+)/);
      const bidAmount = moneyMatch ? parseInt(moneyMatch[1], 10) : 0;
      
      const rawText = `${introMessage}\n\nOffering: ${introOffer}`;
      const normalizedQuery = {
        targetDomain: introTarget.domain,
        targetCompany: introTarget.company,
        targetRole: introTarget.role,
        offer: introOffer,
      };
      
      const response = await fetch(`${API_BASE}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rawText,
          normalizedQuery,
          bidAmount,
          currency: 'USD',
          spaceId: id,
        }),
      });

      if (!response.ok) throw new Error('Failed to create request');
      
      const data = await response.json();
      
      // Add to global store so RequestDetailPage can find it
      dispatch({
        type: 'ADD_REQUEST',
        payload: {
          id: data.id,
          requesterId: currentUser.id,
          rawText,
          normalizedQuery,
          bidAmount,
          currency: 'USD',
          status: 'open',
          createdAt: new Date().toISOString(),
          spaceId: id,
        },
      });
      
      // Refresh the space data to show new request
      await fetchSpace();
      
      // Close modal and reset
      setShowIntroModal(false);
      setIntroTarget(null);
      setIntroMessage('');
      setIntroOffer('');
      
      // Switch to requests tab to show the new request
      setActiveTab('requests');
    } catch (err) {
      console.error('Failed to submit intro request:', err);
      alert('Failed to submit request. Please try again.');
    } finally {
      setIsSubmittingIntro(false);
    }
  };

  useEffect(() => {
    fetchSpace();
  }, [id]);

  const fetchSpace = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/spaces/${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSpace(data);
        // Fetch pending members if owner
        if (data.ownerId === currentUser?.id) {
          fetchPendingMembers();
        }
      }
    } catch (e) {
      console.error('Failed to fetch space:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingMembers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/spaces/${id}/pending`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPendingMembers(data);
      }
    } catch (e) {
      console.error('Failed to fetch pending members:', e);
    }
  };

  const fetchSpaceReach = async () => {
    if (!id) return;
    setReachLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/spaces/${id}/reach`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSpaceCompanies(data.companies || []);
        setReachStats({
          totalCompanies: data.totalCompanies || 0,
          totalContacts: data.totalContacts || 0,
          memberCount: data.memberCount || 0,
        });
      }
    } catch (e) {
      console.error('Failed to fetch space reach:', e);
    } finally {
      setReachLoading(false);
    }
  };

  // Fetch reach data when switching to the reach tab
  useEffect(() => {
    if (activeTab === 'reach' && spaceCompanies.length === 0 && !reachLoading) {
      fetchSpaceReach();
    }
  }, [activeTab]);

  const approveMember = async (memberId: string) => {
    if (!space) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${space.id}/members/${memberId}/approve`, {
        method: 'POST',
        credentials: 'include',
      });
      fetchSpace();
      fetchPendingMembers();
    } catch (e) {
      console.error('Failed to approve member:', e);
    }
  };

  const rejectMember = async (memberId: string) => {
    if (!space) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${space.id}/members/${memberId}/reject`, {
        method: 'POST',
        credentials: 'include',
      });
      fetchPendingMembers();
    } catch (e) {
      console.error('Failed to reject member:', e);
    }
  };

  const deleteRequest = async (requestId: string) => {
    if (!space || !confirm('Delete this request? This cannot be undone.')) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${space.id}/requests/${requestId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      fetchSpace();
    } catch (e) {
      console.error('Failed to delete request:', e);
    }
  };

  // All requests in this space
  const spaceRequests = space?.requests || [];

  // My requests in this space
  const myRequests = useMemo(() => {
    return spaceRequests.filter(req => req.requesterId === currentUser?.id);
  }, [spaceRequests, currentUser?.id]);

  // Other people's requests
  const otherRequests = useMemo(() => {
    return spaceRequests.filter(req => req.requesterId !== currentUser?.id);
  }, [spaceRequests, currentUser?.id]);

  // Requests I can help with (where I have a matching contact based on normalizedQuery.targetDomain)
  const requestsICanHelp = useMemo(() => {
    return otherRequests.filter(req => {
      const targetDomain = req.normalizedQuery?.targetDomain;
      if (!targetDomain) return false;
      return contacts.some(c => c.companyDomain === targetDomain || c.company.toLowerCase().includes(targetDomain.replace('.com', '').toLowerCase()));
    });
  }, [otherRequests]);

  const inviteMember = async () => {
    if (!inviteEmail.trim() || !space) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${space.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: inviteEmail }),
      });
      setInviteEmail('');
      setShowInvite(false);
      fetchSpace();
    } catch (e) {
      console.error('Failed to invite member:', e);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!space) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${space.id}/members/${memberId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      fetchSpace();
    } catch (e) {
      console.error('Failed to remove member:', e);
    }
  };

  const leaveSpace = async () => {
    if (!space) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${space.id}/leave`, {
        method: 'POST',
        credentials: 'include',
      });
      navigate('/spaces');
    } catch (e) {
      console.error('Failed to leave space:', e);
    }
  };

  const deleteSpace = async () => {
    if (!space || !confirm('Delete this space? This cannot be undone.')) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${space.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      navigate('/spaces');
    } catch (e) {
      console.error('Failed to delete space:', e);
    }
  };

  const copyInviteCode = () => {
    if (!space) return;
    navigator.clipboard.writeText(space.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="space-detail-page">
        <div className="loading-state">Loading...</div>
      </div>
    );
  }

  if (!space) {
    return (
      <div className="space-detail-page">
        <div className="detail-empty">
          <h2>Space not found</h2>
          <Link to="/spaces" className="btn-primary">Back to Spaces</Link>
        </div>
      </div>
    );
  }

  const isOwner = space.ownerId === currentUser?.id;

  return (
    <div className="space-detail-page">
      <div className="space-detail-header">
        <Link to="/spaces" className="back-link">← Back to Spaces</Link>
      </div>

      <div className="space-detail-hero">
        <span className="space-hero-emoji">{space.emoji}</span>
        <div className="space-hero-info">
          <h1>{space.name}</h1>
          {space.description && <p className="space-hero-desc">{space.description}</p>}
          <div className="space-hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-value">{space.members.length}</span>
              <span className="hero-stat-label">Members</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{spaceCompanies.length}</span>
              <span className="hero-stat-label">Companies</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{spaceRequests.length}</span>
              <span className="hero-stat-label">Requests</span>
            </div>
          </div>
        </div>
        {isOwner && <span className="owner-badge-large">Owner</span>}
      </div>

      {/* Tab Navigation */}
      <div className="space-tabs">
        <button 
          className={`space-tab ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          Requests
        </button>
        <button 
          className={`space-tab ${activeTab === 'reach' ? 'active' : ''}`}
          onClick={() => setActiveTab('reach')}
        >
          Space Reach
        </button>
        <button 
          className={`space-tab ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          Members
        </button>
        {isOwner && (
          <button 
            className={`space-tab ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => setActiveTab('admin')}
          >
            Admin {pendingMembers.length > 0 && <span className="tab-badge">{pendingMembers.length}</span>}
          </button>
        )}
      </div>

      <div className="space-detail-content">
        {/* Requests Tab */}
        {activeTab === 'requests' && (
          <>
            {/* My Requests in this Space */}
            {myRequests.length > 0 && (
              <div className="feed-section">
                <div className="section-header">
                  <h2>Your Requests</h2>
                  <span className="section-count">{myRequests.filter(r => r.status === 'open').length} active</span>
                </div>
                <div className="section-content">
                  {myRequests.map(req => (
                    <Link to={`/request/${req.id}`} key={req.id} className="request-card my-request">
                      <div className="request-card-header">
                        <span className={`status-badge ${req.status}`}>{req.status}</span>
                        {req.bidAmount > 0 && <span className="bounty-badge">${req.bidAmount}</span>}
                      </div>
                      <p className="request-text">{req.rawText}</p>
                      {req.offers.length > 0 && (
                        <div className="request-notification success">
                          {req.offers.length} offer{req.offers.length !== 1 ? 's' : ''} waiting for review
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Requests I Can Help With */}
            {requestsICanHelp.length > 0 && (
              <div className="feed-section suggested">
                <div className="section-header">
                  <h2>You Can Help</h2>
                  <span className="section-subtitle">{requestsICanHelp.length} requests you can intro</span>
                </div>
                <div className="section-content">
                  {requestsICanHelp.map(req => {
                    const targetDomain = req.normalizedQuery?.targetDomain;
                    const matchingContact = contacts.find(c => 
                      c.companyDomain === targetDomain || 
                      c.company.toLowerCase().includes((targetDomain || '').replace('.com', '').toLowerCase())
                    );
                    return (
                      <div key={req.id} className="request-card suggestion">
                        <div className="request-card-header">
                          <div className="requester-info">
                            <PersonAvatar 
                              email={req.requester.email} 
                              name={req.requester.name} 
                              avatarUrl={req.requester.avatar}
                              size={40}
                            />
                            <span className="requester-name">{req.requester.name}</span>
                          </div>
                          {req.bidAmount > 0 && <span className="bounty-badge">${req.bidAmount}</span>}
                        </div>
                        <p className="request-text">{req.rawText}</p>
                        {matchingContact && (
                          <div className="suggestion-box">
                            <div className="suggestion-label">You know:</div>
                            <div className="contact-suggestion">
                              <PersonAvatar 
                                email={matchingContact.email} 
                                name={matchingContact.name} 
                                size={32}
                              />
                              <div className="contact-info">
                                <span className="contact-name">{matchingContact.name}</span>
                                <span className="contact-title">{matchingContact.title} at {matchingContact.company}</span>
                              </div>
                              <span className={`connection-strength ${matchingContact.connectionStrength}`}>
                                {matchingContact.connectionStrength}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="request-actions">
                          <Link to={`/request/${req.id}`} className="btn-secondary">View Details</Link>
                          <button 
                            className="btn-primary"
                            onClick={() => offerIntro(req, matchingContact?.name)}
                          >
                            Offer Intro
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* All Space Requests */}
            <div className="feed-section">
              <div className="section-header">
                <h2>All Space Requests</h2>
                <span className="section-count">{otherRequests.length} requests</span>
              </div>
              <div className="section-content">
                {otherRequests.length === 0 ? (
                  <div className="empty-section">
                    <p>No requests yet from other members</p>
                  </div>
                ) : (
                  otherRequests.map(req => (
                    <div key={req.id} className="request-card community">
                      <div className="request-card-header">
                        <div className="requester-info">
                          <PersonAvatar 
                            email={req.requester.email} 
                            name={req.requester.name} 
                            avatarUrl={req.requester.avatar}
                            size={40}
                          />
                          <span className="requester-name">{req.requester.name}</span>
                        </div>
                        {req.bidAmount > 0 && <span className="bounty-badge">${req.bidAmount}</span>}
                      </div>
                      <p className="request-text">{req.rawText}</p>
                      <div className="request-actions">
                        <Link to={`/request/${req.id}`} className="btn-text-link">View</Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* Space Reach Tab */}
        {activeTab === 'reach' && (
          <div className="reach-page">
            <div className="crm-header">
              <div className="crm-title">
                <h1>Companies We Can Reach</h1>
                <p className="crm-subtitle">
                  {filteredCompanies.length} of {spaceCompanies.length} companies
                  {activeReachFilterCount > 0 && (
                    <button className="clear-filters-btn" onClick={clearReachFilters}>
                      Clear {activeReachFilterCount} filter{activeReachFilterCount > 1 ? 's' : ''}
                    </button>
                  )}
                </p>
              </div>
              <button 
                className={`filter-toggle-btn ${showReachFilters ? 'active' : ''}`}
                onClick={() => setShowReachFilters(!showReachFilters)}
              >
                <span>⚙️</span> Filters {activeReachFilterCount > 0 && `(${activeReachFilterCount})`}
              </button>
            </div>

            <div className="crm-layout">
              {/* Filter Sidebar */}
              {showReachFilters && (
                <aside className="crm-filters">
                  {/* Contacts Available */}
                  <div className="filter-section">
                    <h3 className="filter-title">Contacts Available</h3>
                    <div className="filter-options">
                      {['1', '2-5', '5+'].map(count => (
                        <label key={count} className="filter-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedContactCounts.includes(count)}
                            onChange={() => toggleContactCount(count)}
                          />
                          <span className="filter-label-text">
                            {count === '1' ? '1 contact' : count === '2-5' ? '2-5 contacts' : '5+ contacts'}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Industry Filter */}
                  <div className="filter-section">
                    <h3 className="filter-title">
                      Industry
                      {selectedIndustries.length > 0 && (
                        <span className="filter-count">{selectedIndustries.length}</span>
                      )}
                    </h3>
                    <div className="filter-options">
                      {industryOptions.map(({ value, label }) => (
                        <label key={value} className="filter-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedIndustries.includes(value)}
                            onChange={() => toggleIndustry(value)}
                          />
                          <span className="filter-label-text">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Company Size Filter */}
                  <div className="filter-section">
                    <h3 className="filter-title">
                      Company Size
                      {selectedSizes.length > 0 && (
                        <span className="filter-count">{selectedSizes.length}</span>
                      )}
                    </h3>
                    <div className="filter-options">
                      {sizeOptions.map(({ value, label }) => (
                        <label key={value} className="filter-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedSizes.includes(value)}
                            onChange={() => toggleSize(value)}
                          />
                          <span className="filter-label-text">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {activeReachFilterCount > 0 && (
                    <button className="clear-filters-btn" onClick={clearReachFilters}>
                      Clear all filters
                    </button>
                  )}
                </aside>
              )}

              {/* Main Content */}
              <div className="crm-content">
                <div className="crm-toolbar">
                  <div className="crm-controls">
                    <div className="search-box">
                      <span className="search-icon">🔍</span>
                      <input
                        type="text"
                        placeholder="Search companies..."
                        value={reachSearchQuery}
                        onChange={(e) => setReachSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className="sort-controls">
                      <button 
                        className={`sort-btn ${reachSortBy === 'contacts' ? 'active' : ''}`}
                        onClick={() => setReachSortBy('contacts')}
                      >
                        Most Contacts
                      </button>
                      <button 
                        className={`sort-btn ${reachSortBy === 'name' ? 'active' : ''}`}
                        onClick={() => setReachSortBy('name')}
                      >
                        A-Z
                      </button>
                    </div>
                    <label className="hide-my-contacts-toggle">
                      <input
                        type="checkbox"
                        checked={hideMyContacts}
                        onChange={() => setHideMyContacts(!hideMyContacts)}
                      />
                      <span>Hide my contacts</span>
                    </label>
                  </div>
                </div>

                {/* Active Filters Tags */}
                {activeReachFilterCount > 0 && (
                  <div className="active-filters">
                    {selectedContactCounts.map(count => (
                      <span key={count} className="filter-tag">
                        {count === '1' ? '1 contact' : count === '2-5' ? '2-5 contacts' : '5+ contacts'}
                        <button onClick={() => toggleContactCount(count)}>×</button>
                      </span>
                    ))}
                    {selectedIndustries.map(industry => (
                      <span key={industry} className="filter-tag">
                        {industryOptions.find(i => i.value === industry)?.label || industry}
                        <button onClick={() => toggleIndustry(industry)}>×</button>
                      </span>
                    ))}
                    {selectedSizes.map(size => (
                      <span key={size} className="filter-tag">
                        {sizeOptions.find(s => s.value === size)?.label || size}
                        <button onClick={() => toggleSize(size)}>×</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Companies List */}
                {reachLoading ? (
                  <div className="loading-state">Loading companies...</div>
                ) : filteredCompanies.length === 0 ? (
                  <div className="empty-network">
                    <div className="empty-icon">🏢</div>
                    <h2>{spaceCompanies.length === 0 ? 'No companies yet' : 'No companies found'}</h2>
                    <p>{spaceCompanies.length === 0 ? 'Space members need to sync their calendars' : 'Try adjusting your filters'}</p>
                    {activeReachFilterCount > 0 && (
                      <button className="btn-secondary" onClick={clearReachFilters}>
                        Clear all filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="companies-list">
                    {paginatedCompanies.map(company => (
                      <div key={company.id} className="company-card">
                        <div 
                          className="company-row"
                          onClick={() => setExpandedCompany(expandedCompany === company.domain ? null : company.domain)}
                        >
                          <CompanyLogo domain={company.domain} name={company.name} size={48} />
                          <div className="company-info">
                            <div className="company-name">{company.name}</div>
                            <div className="company-domain">{company.domain}</div>
                          </div>
                          <div className="company-meta">
                            {company.industry && (
                              <span className="company-industry-badge">
                                {industryOptions.find(i => i.value === company.industry)?.label || company.industry}
                              </span>
                            )}
                            {company.sizeBucket && (
                              <span className="company-size-badge">
                                {sizeOptions.find(s => s.value === company.sizeBucket)?.label?.split(' ')[0] || company.sizeBucket}
                              </span>
                            )}
                            <span className="company-contact-count">
                              {company.contactCount} contact{company.contactCount !== 1 ? 's' : ''}
                            </span>
                            <span className={`expand-arrow ${expandedCompany === company.domain ? 'expanded' : ''}`}>▼</span>
                          </div>
                        </div>
                        
                        {expandedCompany === company.domain && (
                          <div className="company-contacts">
                            {company.contacts.map((contact) => {
                              const isMyContact = currentUser && contact.userId === currentUser.id;
                              return (
                                <div key={contact.id} className="company-contact-row">
                                  <div className="contact-row-avatar-placeholder">
                                    {contact.name.charAt(0)}
                                  </div>
                                  <div className="contact-row-info">
                                    <span className="contact-row-name">{contact.name}</span>
                                    <span className="contact-row-title">
                                      {isMyContact 
                                        ? (contact.title || contact.email)
                                        : (contact.title || 'Request intro to see details')
                                      }
                                    </span>
                                    <span className="contact-row-via">via {contact.userName}</span>
                                  </div>
                                  {!isMyContact && (
                                    <button 
                                      className="btn-text-small"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openIntroModal(company.name, contact.title || 'Contact', company.domain);
                                      }}
                                    >
                                      Request Intro
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {/* Pagination */}
                    <Pagination 
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Members Tab */}
        {activeTab === 'members' && (
          <>
            <div className="space-section">
              <div className="space-section-header">
                <h2>Members</h2>
                {isOwner && (
                  <button className="btn-secondary" onClick={() => setShowInvite(!showInvite)}>
                    + Invite
                  </button>
                )}
              </div>

              {showInvite && (
                <div className="invite-form">
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <button className="btn-primary" onClick={inviteMember} disabled={!inviteEmail.trim()}>
                    Send
                  </button>
                  <button className="btn-text" onClick={() => setShowInvite(false)}>Cancel</button>
                </div>
              )}

              <div className="members-grid">
                {space.members.map(member => (
                  <div key={member.id} className="member-card">
                    <div className="member-card-avatar">
                      <PersonAvatar 
                        email={member.user.email} 
                        name={member.user.name} 
                        avatarUrl={member.user.avatar}
                        size={48}
                      />
                    </div>
                    <div className="member-card-info">
                      <span className="member-card-name">
                        {member.user.name}
                        {member.user.id === currentUser?.id && ' (you)'}
                      </span>
                      <span className="member-card-role">{member.role}</span>
                    </div>
                    {isOwner && member.user.id !== currentUser?.id && (
                      <button 
                        className="member-remove-btn"
                        onClick={() => removeMember(member.user.id)}
                        title="Remove member"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Invite Code */}
            <div className="space-section">
              <div className="space-section-header">
                <h2>Invite Code</h2>
              </div>
              <div className="invite-code-box">
                <code className="invite-code">{space.inviteCode}</code>
                <button className="btn-secondary" onClick={copyInviteCode}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="invite-hint">Share this code with others to let them join</p>
            </div>

            {/* Actions */}
            <div className="space-section">
              <div className="space-actions">
                {!isOwner && (
                  <button className="btn-secondary" onClick={leaveSpace}>
                    Leave Space
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* Admin Tab (Owner Only) */}
        {activeTab === 'admin' && isOwner && (
          <>
            {/* Pending Applications */}
            <div className="space-section admin-section">
              <div className="space-section-header">
                <h2>Pending Applications</h2>
                <span className="section-badge">{pendingMembers.length} pending</span>
              </div>
              {pendingMembers.length === 0 ? (
                <div className="empty-section">
                  <p>No pending applications</p>
                </div>
              ) : (
                <div className="admin-list">
                  {pendingMembers.map(member => (
                    <div key={member.id} className="admin-list-item">
                      <div className="admin-item-main">
                        <div className="admin-item-avatar">
                          <PersonAvatar 
                            email={member.user.email} 
                            name={member.user.name} 
                            avatarUrl={member.user.avatar}
                            size={40}
                          />
                        </div>
                        <div className="admin-item-info">
                          <span className="admin-item-name">{member.user.name}</span>
                          <span className="admin-item-email">{member.user.email}</span>
                        </div>
                      </div>
                      <div className="admin-item-actions">
                        <button 
                          className="btn-primary-small" 
                          onClick={() => approveMember(member.user.id)}
                        >
                          Approve
                        </button>
                        <button 
                          className="btn-secondary-small" 
                          onClick={() => rejectMember(member.user.id)}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Manage Members */}
            <div className="space-section admin-section">
              <div className="space-section-header">
                <h2>Members</h2>
                <span className="section-badge">{space.members.filter(m => m.user.id !== currentUser?.id).length} members</span>
              </div>
              {space.members.filter(m => m.user.id !== currentUser?.id).length === 0 ? (
                <div className="empty-section">
                  <p>No other members yet</p>
                </div>
              ) : (
                <div className="admin-list">
                  {space.members
                    .filter(m => m.user.id !== currentUser?.id)
                    .map(member => (
                      <div key={member.id} className="admin-list-item">
                        <div className="admin-item-main">
                          <div className="admin-item-avatar">
                            <PersonAvatar 
                              email={member.user.email} 
                              name={member.user.name} 
                              avatarUrl={member.user.avatar}
                              size={40}
                            />
                          </div>
                          <div className="admin-item-info">
                            <span className="admin-item-name">{member.user.name}</span>
                            <span className="admin-item-role">{member.role}</span>
                          </div>
                        </div>
                        <div className="admin-item-actions">
                          <button 
                            className="btn-danger-small" 
                            onClick={() => removeMember(member.user.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Manage Requests */}
            <div className="space-section admin-section">
              <div className="space-section-header">
                <h2>Space Requests</h2>
                <span className="section-badge">{space.requests.length} requests</span>
              </div>
              {space.requests.length === 0 ? (
                <div className="empty-section">
                  <p>No intro requests in this space</p>
                </div>
              ) : (
                <div className="admin-list">
                  {space.requests.map(req => (
                    <div key={req.id} className="admin-list-item request-item">
                      <div className="admin-item-main">
                        <div className="request-item-content">
                          <p className="request-item-text">"{req.rawText}"</p>
                          <div className="request-item-meta">
                            <span className="request-item-author">by {req.requester.name}</span>
                            <span className={`status-badge small ${req.status}`}>{req.status}</span>
                          </div>
                        </div>
                      </div>
                      <div className="admin-item-actions">
                        <button 
                          className="btn-danger-small" 
                          onClick={() => deleteRequest(req.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <div className="space-section admin-section danger-zone">
              <div className="space-section-header">
                <h2>Danger Zone</h2>
              </div>
              <div className="danger-zone-content">
                <div className="danger-zone-item">
                  <div className="danger-zone-info">
                    <h3>Delete this space</h3>
                    <p>Once deleted, this space and all its data cannot be recovered.</p>
                  </div>
                  <button className="btn-danger" onClick={deleteSpace}>
                    Delete Space
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Intro Request Modal */}
      {showIntroModal && introTarget && (
        <div className="modal-overlay" onClick={() => setShowIntroModal(false)}>
          <div className="intro-request-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Request Introduction</h2>
              <button className="modal-close" onClick={() => setShowIntroModal(false)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="intro-target-preview">
                <div className="intro-target-icon">🎯</div>
                <div className="intro-target-info">
                  <span className="intro-target-company">{introTarget.company}</span>
                  <span className="intro-target-role">{introTarget.role} Team</span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="intro-message">Your request</label>
                <textarea
                  id="intro-message"
                  value={introMessage}
                  onChange={(e) => setIntroMessage(e.target.value)}
                  placeholder="Describe who you're looking to meet and why..."
                  rows={5}
                />
                <p className="form-hint">Be specific about the role, context, and why you want to connect.</p>
              </div>

              <div className="form-group">
                <label htmlFor="intro-offer">What are you offering in return?</label>
                <input
                  id="intro-offer"
                  type="text"
                  value={introOffer}
                  onChange={(e) => setIntroOffer(e.target.value)}
                  placeholder="e.g., $100, coffee, dinner, help with your project..."
                />
                <p className="form-hint">Can be money, a favor, expertise, or anything of value to the introducer.</p>
              </div>

              <div className="offer-suggestions">
                <span className="offer-suggestions-label">Quick options:</span>
                <div className="offer-suggestion-chips">
                  {['$50', '$100', '$200', 'Coffee ☕', 'Dinner 🍽️', 'Advice session', 'Will return the favor'].map(suggestion => (
                    <button
                      key={suggestion}
                      className={`offer-chip ${introOffer === suggestion ? 'active' : ''}`}
                      onClick={() => setIntroOffer(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowIntroModal(false)}>
                Cancel
              </button>
              <button 
                className="btn-primary"
                onClick={submitIntroRequest}
                disabled={!introMessage.trim() || !introOffer.trim() || isSubmittingIntro}
              >
                {isSubmittingIntro ? 'Submitting...' : 'Post Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
