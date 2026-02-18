import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

type ArticleId = 'getting-started' | 'filters' | 'connections' | 'spaces' | 'intros';

const articles: { id: ArticleId; title: string; icon: string; subtitle: string }[] = [
  { id: 'getting-started', title: 'Getting Started', icon: '🚀', subtitle: 'What is Introo and how it works' },
  { id: 'filters', title: 'Filters, Tags & Views', icon: '🔍', subtitle: 'Use Introo as your personal CRM' },
  { id: 'connections', title: '1:1 Connections', icon: '🤝', subtitle: 'Share networks with trusted people' },
  { id: 'spaces', title: 'Spaces', icon: '👥', subtitle: 'Pool networks in private groups' },
  { id: 'intros', title: 'How Intros Work', icon: '✨', subtitle: 'Request and make warm introductions' },
];

function GettingStartedArticle({ onNavigate }: { onNavigate: (id: ArticleId) => void }) {
  return (
    <article className="docs-article">
      <h1>What is Introo?</h1>
      <p className="docs-lead">
        Introo turns your scattered calls, meetings, and emails into a structured, searchable map of your professional
        network. It finds every person you've ever interacted with, enriches them with company data, and lets you
        share your network with trusted people to make warm introductions — no spreadsheets, no cold outreach.
      </p>

      <section>
        <h2>How it works</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <span className="docs-step-num">1</span>
            <div>
              <strong>Get an invite</strong>
              <p>Introo is invite-only. An existing user sends an invite to your email — either as a 1:1 Connection or to join their Space. Once invited, sign in with Google and your calendar syncs automatically.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">2</span>
            <div>
              <strong>Review & approve contacts</strong>
              <p>Introo shows you everyone it found. Approve the contacts you want in your network. Personal email domains (Gmail, Yahoo, etc.) are filtered out — only business contacts make it through.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">3</span>
            <div>
              <strong>Automatic enrichment</strong>
              <p>Every contact and company is enriched with data — job titles, LinkedIn profiles, photos, company size, industry, funding stage, and more. This happens in the background, no manual data entry needed.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">4</span>
            <div>
              <strong>Explore your network</strong>
              <p>Browse by company or by person. Search, filter, sort, group, tag — like a CRM, but built automatically from your real relationships.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>Your data stays yours</h2>
        <p>
          Privacy is baked into how Introo works. Here's what you need to know:
        </p>
        <div className="docs-grid">
          <div className="docs-card">
            <h4>Your contacts are private</h4>
            <p>Nobody can see your contacts or meeting history unless you explicitly share through a Connection or Space.</p>
          </div>
          <div className="docs-card">
            <h4>Emails are never shown</h4>
            <p>When you share your network, contact email addresses are completely hidden from others. Only names and job titles are visible.</p>
          </div>
          <div className="docs-card">
            <h4>Meetings are never shared</h4>
            <p>Your calendar event titles, dates, and frequency — the raw data from your calendar — are never visible to anyone else.</p>
          </div>
          <div className="docs-card">
            <h4>You control sharing</h4>
            <p>Sharing only happens through 1:1 Connections or Spaces that you explicitly join. You can leave anytime and your data is immediately removed from the shared view.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>What can you do with Introo?</h2>
        <div className="docs-examples">
          <div className="docs-example-card">
            <h4>🎯 Find warm paths to any company</h4>
            <p>Looking to reach someone at a target company? See if anyone in your network (or your connections' networks) already knows someone there. Request a warm intro instead of cold outreach.</p>
          </div>
          <div className="docs-example-card">
            <h4>📋 Use it as a lightweight CRM</h4>
            <p>Tag companies as "Customer," "Prospect," or "Partner." Create saved Views like "Strong prospects" or "Cold clients" to organize your pipeline without the complexity of a full CRM.</p>
          </div>
          <div className="docs-example-card">
            <h4>👥 Pool networks with your team</h4>
            <p>Create a Space for your sales team, investor syndicate, or industry group. Everyone contributes their contacts and the whole group benefits from a larger combined reach.</p>
          </div>
          <div className="docs-example-card">
            <h4>🤝 Help others with warm intros</h4>
            <p>When someone in your Space or Connections needs to reach a company where you know people, you get notified. Help them with a 3-way introduction email — all from within the app.</p>
          </div>
          <div className="docs-example-card">
            <h4>📊 Understand your relationship strength</h4>
            <p>Introo scores how strong your connection is to each company based on meeting recency and frequency. See at a glance which relationships are strong and which are going cold.</p>
          </div>
          <div className="docs-example-card">
            <h4>🔄 Always up to date</h4>
            <p>Your calendar syncs automatically every few hours. New meetings, new contacts, new companies — they all show up without you lifting a finger.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>Key concepts</h2>
        <p>Here's a quick overview of the main features. Click any to learn more:</p>
        <div className="docs-concepts">
          <button className="docs-concept-link" onClick={() => onNavigate('filters')}>
            <span className="docs-concept-icon">🔍</span>
            <div>
              <strong>Filters, Tags & Views</strong>
              <p>Slice your network by industry, strength, location, funding stage, and more. Tag companies and save custom Views for one-click access.</p>
            </div>
            <span className="docs-concept-arrow">→</span>
          </button>
          <button className="docs-concept-link" onClick={() => onNavigate('connections')}>
            <span className="docs-concept-icon">🤝</span>
            <div>
              <strong>1:1 Connections</strong>
              <p>Link directly with another Introo user. Both of you share visibility into each other's professional networks.</p>
            </div>
            <span className="docs-concept-arrow">→</span>
          </button>
          <button className="docs-concept-link" onClick={() => onNavigate('spaces')}>
            <span className="docs-concept-icon">👥</span>
            <div>
              <strong>Spaces</strong>
              <p>Private groups where members pool their contacts. Think shared rolodex — everyone contributes, everyone benefits.</p>
            </div>
            <span className="docs-concept-arrow">→</span>
          </button>
          <button className="docs-concept-link" onClick={() => onNavigate('intros')}>
            <span className="docs-concept-icon">✨</span>
            <div>
              <strong>How Intros Work</strong>
              <p>Request warm introductions through your network. Connectors choose how to help — ask for details, check with the contact, or make a direct intro.</p>
            </div>
            <span className="docs-concept-arrow">→</span>
          </button>
        </div>
      </section>

      <section>
        <h2>Real-world scenarios</h2>
        <div className="docs-scenarios">
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">💰</span>
              <strong>Founder raising a Series A</strong>
            </div>
            <p>See who in your advisory network knows investors at target funds. Request warm intros instead of cold-emailing.</p>
            <div className="docs-scenario-features">Spaces · Intros</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🎯</span>
              <strong>Sales team at a startup</strong>
            </div>
            <p>Pool the whole team's contacts. Before cold-calling Acme, check if anyone on the team already has a warm path in.</p>
            <div className="docs-scenario-features">Spaces · Filters</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">📋</span>
              <strong>Consultant managing clients</strong>
            </div>
            <p>Tag companies as clients, prospects, or partners. Create a "Going cold" view to catch relationships before they fade.</p>
            <div className="docs-scenario-features">Tags · Views · Strength</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🔍</span>
              <strong>Job seeker exploring options</strong>
            </div>
            <p>Filter by industry and company size. Connect 1:1 with a mentor to see their network and request intros to hiring managers.</p>
            <div className="docs-scenario-features">Connections · Filters</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">📊</span>
              <strong>VC mapping deal flow</strong>
            </div>
            <p>Partners create a Space. Search pipeline companies to see who already has relationships there. Prioritize warm deals.</p>
            <div className="docs-scenario-features">Spaces · Strength · Intros</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🤝</span>
              <strong>BD at a growing company</strong>
            </div>
            <p>Before reaching out to a potential partner, check if someone on the team already met them at a conference or past deal. Start warm, close faster.</p>
            <div className="docs-scenario-features">Spaces · Filters · Intros</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🏗️</span>
              <strong>Hiring for a hard-to-fill role</strong>
            </div>
            <p>Search your network by job title — "Staff Engineer," "Head of Design." See who you've actually met with, how recently, and ask a mutual contact to make the intro.</p>
            <div className="docs-scenario-features">Filters · Strength · Intros</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🌍</span>
              <strong>Expanding into a new market</strong>
            </div>
            <p>Filter your combined network by country or city. Discover who already has contacts in your target region and get introduced to local partners or clients.</p>
            <div className="docs-scenario-features">Spaces · Filters · Intros</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🎓</span>
              <strong>Mentor connecting mentees</strong>
            </div>
            <p>Share your network with people you're advising via 1:1 Connections. They can browse your contacts and request intros — you stay in control of every introduction.</p>
            <div className="docs-scenario-features">Connections · Intros</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🔄</span>
              <strong>Re-engaging dormant relationships</strong>
            </div>
            <p>Sort by last contact date to surface people you haven't spoken to in months. Tag them "Re-engage" and create a View to work through the list.</p>
            <div className="docs-scenario-features">Views · Tags · Strength</div>
          </div>
          <div className="docs-scenario-card">
            <div className="docs-scenario-header">
              <span className="docs-scenario-emoji">🚀</span>
              <strong>Launching a product</strong>
            </div>
            <p>Find every contact in your network at companies in your target industry. Filter by company size and funding stage to build a launch outreach list from real relationships.</p>
            <div className="docs-scenario-features">Filters · Tags · Views</div>
          </div>
        </div>
      </section>
    </article>
  );
}

function FiltersArticle() {
  return (
    <article className="docs-article">
      <h1>Filters, Tags & Views</h1>
      <p className="docs-lead">
        Introo turns your calendar contacts into a searchable network. Use filters, tags, and saved views
        to organize it like a lightweight CRM — no spreadsheets needed.
      </p>

      <section>
        <h2>Filtering your network</h2>
        <p>
          The sidebar contains filters that let you slice your network by any dimension.
          You can combine multiple filters at once — they all work together.
        </p>
        <div className="docs-grid">
          <div className="docs-card">
            <h4>Source</h4>
            <p>See only your contacts, only shared contacts from spaces, or both.</p>
          </div>
          <div className="docs-card">
            <h4>Strength</h4>
            <p>Filter by how well you know someone — strong, medium, or weak connections based on meeting frequency.</p>
          </div>
          <div className="docs-card">
            <h4>Company details</h4>
            <p>Filter by employee count, industry, location, funding stage, revenue, and technologies.</p>
          </div>
          <div className="docs-card">
            <h4>Time</h4>
            <p>Find people you met last week, last month, or within a custom date range.</p>
          </div>
        </div>
        <p>
          You can also use the <strong>search bar</strong> at the top to find people or companies by name,
          title, or email. It searches across everything in your network instantly.
        </p>
      </section>

      <section>
        <h2>Tagging companies</h2>
        <p>
          Tags let you categorize companies however you want. Open any company card, click
          <strong> + Add tag</strong>, and type a tag name. If the tag doesn't exist yet, it gets created for you.
        </p>
        <div className="docs-example">
          <span className="docs-tag" style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>customer</span>
          <span className="docs-tag" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>prospect</span>
          <span className="docs-tag" style={{ background: 'rgba(244,63,94,0.15)', color: '#f43e5e' }}>competitor</span>
          <span className="docs-tag" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>portfolio</span>
          <span className="docs-tag" style={{ background: 'rgba(91,141,239,0.15)', color: '#5b8def' }}>partner</span>
        </div>
        <p>
          Once tagged, you can filter your entire network by tag. For example, show only
          companies tagged <em>"prospect"</em> where you have a strong connection — instant pipeline view.
        </p>
      </section>

      <section>
        <h2>Saved Views</h2>
        <p>
          When you've set up a useful combination of filters, sorts, and groups — save it as a <strong>View</strong>.
          Views live in your sidebar and restore the exact configuration with one click.
        </p>
        <div className="docs-steps">
          <div className="docs-step">
            <span className="docs-step-num">1</span>
            <div>
              <strong>Set up your filters</strong>
              <p>Apply any combination of filters, sorting, grouping, and search terms.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">2</span>
            <div>
              <strong>Click "Save as View"</strong>
              <p>A prompt appears at the top. Give it a name or use the auto-generated one.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">3</span>
            <div>
              <strong>Access anytime</strong>
              <p>Switch to the Views tab in the sidebar. Click any view to instantly restore it.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>Examples</h2>
        <div className="docs-examples">
          <div className="docs-example-card">
            <h4>Sales pipeline</h4>
            <p>Tag companies as <em>prospect</em>, <em>active deal</em>, or <em>customer</em>. Create a view filtered to <em>prospect</em> + <em>strong connection</em> to see warm leads.</p>
          </div>
          <div className="docs-example-card">
            <h4>Investor tracking</h4>
            <p>Tag funds as <em>portfolio</em> or <em>target LP</em>. Group by industry and sort by employee count for quick scanning.</p>
          </div>
          <div className="docs-example-card">
            <h4>Hiring pipeline</h4>
            <p>Use search to find people by title (e.g. "engineer"). Filter by <em>strong connection</em> to surface candidates you've met multiple times.</p>
          </div>
        </div>
      </section>
    </article>
  );
}

function ConnectionsArticle() {
  return (
    <article className="docs-article">
      <h1>1:1 Connections</h1>
      <p className="docs-lead">
        A 1:1 connection links you directly with another Introo user. You both share
        visibility into each other's professional networks, making it easy to find and request warm intros.
      </p>

      <section>
        <h2>How it works</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <span className="docs-step-num">1</span>
            <div>
              <strong>Send a connection request</strong>
              <p>Go to Your Network, scroll to 1:1 Connections, and enter their email. If they're not on Introo yet, we'll send them an invite.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">2</span>
            <div>
              <strong>They accept</strong>
              <p>Your connection appears as pending until they accept. Once accepted, you both get access.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">3</span>
            <div>
              <strong>Browse each other's networks</strong>
              <p>You can now see their companies and contacts in your network, and request intros through them.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>What you share</h2>
        <p>
          When you connect with someone, here's exactly what becomes visible to them:
        </p>
        <div className="docs-share-table">
          <div className="docs-share-row docs-share-row--header">
            <span>Data</span>
            <span>Visible?</span>
            <span>Details</span>
          </div>
          <div className="docs-share-row">
            <span>Companies you know</span>
            <span className="docs-share-yes">Yes</span>
            <span>Company name, domain, industry, size, and enriched data</span>
          </div>
          <div className="docs-share-row">
            <span>Contact names & titles</span>
            <span className="docs-share-yes">Yes</span>
            <span>They can see who you know at each company and their job title</span>
          </div>
          <div className="docs-share-row">
            <span>Contact emails</span>
            <span className="docs-share-no">Hidden</span>
            <span>Email addresses are completely hidden — never shown to your connection</span>
          </div>
          <div className="docs-share-row">
            <span>Meeting details</span>
            <span className="docs-share-no">No</span>
            <span>Your calendar events, dates, and meeting subjects are never shared</span>
          </div>
          <div className="docs-share-row">
            <span>Your tags & views</span>
            <span className="docs-share-no">No</span>
            <span>Tags and saved views are completely private to you</span>
          </div>
          <div className="docs-share-row">
            <span>Connection strength</span>
            <span className="docs-share-no">No</span>
            <span>How well you know someone (strong/medium/weak) is only visible to you</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Requesting an intro</h2>
        <p>
          When you see your connection knows someone at a company you're interested in, you can request an intro.
          Open the company card, click <strong>Request an Intro</strong>, and write a short message explaining why
          you'd like to meet. Your connection receives the request and can accept, decline, or forward it.
        </p>
      </section>

      <section>
        <h2>Removing a connection</h2>
        <p>
          You can remove a 1:1 connection at any time. Go to the connection's profile and use the options menu.
          Once removed, you both lose access to each other's shared network immediately. No data is deleted — your
          contacts and companies remain in your own account.
        </p>
      </section>
    </article>
  );
}

function SpacesArticle() {
  return (
    <article className="docs-article">
      <h1>Spaces</h1>
      <p className="docs-lead">
        A Space is a private group where members pool their professional networks.
        Think of it as a shared rolodex — everyone contributes their contacts, and the whole group
        benefits from a larger combined reach.
      </p>

      <section>
        <h2>How Spaces work</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <span className="docs-step-num">1</span>
            <div>
              <strong>Create or join a Space</strong>
              <p>Create a new Space and invite people by email, or join an existing one with an invite code.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">2</span>
            <div>
              <strong>Everyone's network is pooled</strong>
              <p>Each member's approved contacts are automatically added to the shared Space reach. No manual work needed.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">3</span>
            <div>
              <strong>Browse and request intros</strong>
              <p>See all companies the group collectively knows. Request intros through the person with the best connection.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>What members see</h2>
        <p>
          Spaces are designed to be useful while protecting personal details:
        </p>
        <div className="docs-share-table">
          <div className="docs-share-row docs-share-row--header">
            <span>Data</span>
            <span>Visible?</span>
            <span>Details</span>
          </div>
          <div className="docs-share-row">
            <span>Companies in the group's reach</span>
            <span className="docs-share-yes">Yes</span>
            <span>All enriched company data is visible to every member</span>
          </div>
          <div className="docs-share-row">
            <span>Who knows who</span>
            <span className="docs-share-partial">Partial</span>
            <span>Members see names and job titles at each company, but emails are completely hidden</span>
          </div>
          <div className="docs-share-row">
            <span>Your own contacts</span>
            <span className="docs-share-yes">Full</span>
            <span>You always see full details for your own contacts</span>
          </div>
          <div className="docs-share-row">
            <span>Intro requests</span>
            <span className="docs-share-partial">Relevant only</span>
            <span>You only see requests where you could be a connector (you know someone at the target company)</span>
          </div>
          <div className="docs-share-row">
            <span>Member list</span>
            <span className="docs-share-yes">Yes</span>
            <span>All members can see who else is in the Space</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Use cases</h2>
        <div className="docs-examples">
          <div className="docs-example-card">
            <h4>👥 Team selling</h4>
            <p>Create a Space for your sales team. Everyone pools their contacts so anyone on the team can find warm paths into target accounts.</p>
          </div>
          <div className="docs-example-card">
            <h4>💰 Investor syndicate</h4>
            <p>A group of investors pools deal flow and portfolio networks. When one member needs an intro to a founder, the group can help.</p>
          </div>
          <div className="docs-example-card">
            <h4>🌐 Industry peers</h4>
            <p>A group of founders or operators in the same industry share networks for hiring, partnerships, and customer intros.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>Managing a Space</h2>
        <p>
          The Space owner can invite new members by email, approve join requests, and remove members.
          Members can leave a Space at any time. When someone leaves, their contacts are immediately
          removed from the shared reach — no data stays behind.
        </p>
        <p>
          <strong>Invite codes:</strong> Each Space has a unique invite code that you can share.
          When someone enters the code, they send a join request that the owner can approve.
        </p>
      </section>
    </article>
  );
}

function IntrosArticle() {
  return (
    <article className="docs-article">
      <h1>How Intros Work</h1>
      <p className="docs-lead">
        The whole point of Introo is warm introductions. When you spot someone interesting in your
        network's reach, you can request an intro — and the person who knows them gets notified to help connect you.
      </p>

      <section>
        <h2>Requesting an intro</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <span className="docs-step-num">1</span>
            <div>
              <strong>Find a company or person</strong>
              <p>Browse your network, filter by tags, industry, or strength. When you see a company where someone in your network has contacts — you can request an intro.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">2</span>
            <div>
              <strong>Click "Request Intro"</strong>
              <p>Open the company card and hit the ✨ Request Intro button. Write a short message explaining who you'd like to meet and why.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">3</span>
            <div>
              <strong>Your connector gets notified</strong>
              <p>The person who knows someone at that company receives a notification and an email. They can then decide how to help.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>Where intros come from</h2>
        <p>
          You can request intros through two channels, depending on how you're connected:
        </p>
        <div className="docs-grid">
          <div className="docs-card">
            <h4>Through Spaces</h4>
            <p>When a Space member has contacts at a company you're interested in, you can request an intro. All Space members who know people there will be notified.</p>
          </div>
          <div className="docs-card">
            <h4>Through 1:1 Connections</h4>
            <p>If your direct connection knows someone, you can request an intro specifically through them. Only they will be notified.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>Responding to an intro request</h2>
        <p>
          When someone requests an intro through you, you'll see it in your notifications. You have three options:
        </p>
        <div className="docs-steps">
          <div className="docs-step">
            <span className="docs-step-num">✉️</span>
            <div>
              <strong>Ask for details</strong>
              <p>Email the requester to learn more about what they need before making the introduction.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">🤝</span>
            <div>
              <strong>Make the intro</strong>
              <p>Send an introduction email connecting both parties. Introo helps you compose the email with the right context.</p>
            </div>
          </div>
          <div className="docs-step">
            <span className="docs-step-num">🔒</span>
            <div>
              <strong>Ask permission first</strong>
              <p>Check with your contact before making the intro — send them a heads-up email first, then introduce once they agree.</p>
            </div>
          </div>
        </div>
        <p>
          You can also <strong>decline</strong> a request if you don't think the intro would be appropriate.
          The requester will be notified, and no introductions are made.
        </p>
      </section>

      <section>
        <h2>Privacy & control</h2>
        <div className="docs-share-table">
          <div className="docs-share-row docs-share-row--header">
            <span>What happens</span>
            <span>Who controls it</span>
            <span>Details</span>
          </div>
          <div className="docs-share-row">
            <span>Intro is requested</span>
            <span className="docs-share-partial">Requester</span>
            <span>Only the connector (person who knows the contact) is notified — the target contact is not contacted yet</span>
          </div>
          <div className="docs-share-row">
            <span>Intro is made</span>
            <span className="docs-share-partial">Connector</span>
            <span>The connector decides if, when, and how to make the introduction via email</span>
          </div>
          <div className="docs-share-row">
            <span>Request is declined</span>
            <span className="docs-share-partial">Connector</span>
            <span>The connector can decline with an optional reason — no intro email is sent</span>
          </div>
          <div className="docs-share-row">
            <span>Contact email shared</span>
            <span className="docs-share-no">Never auto-shared</span>
            <span>Contact emails are only shared when the connector explicitly makes the intro</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Tips for great intro requests</h2>
        <div className="docs-examples">
          <div className="docs-example-card">
            <h4>Be specific</h4>
            <p>Mention who you want to meet (by role or name) and why. "I'd like to meet the Head of Product to discuss a partnership" is better than "I want an intro."</p>
          </div>
          <div className="docs-example-card">
            <h4>Keep it short</h4>
            <p>Your connector needs to forward your message. A 2-3 sentence explanation makes it easy for them to introduce you.</p>
          </div>
          <div className="docs-example-card">
            <h4>Make it easy to say yes</h4>
            <p>Explain the value for both sides. Connectors are more likely to help when the intro benefits everyone involved.</p>
          </div>
        </div>
      </section>
    </article>
  );
}

export function DocsPage() {
  const location = useLocation();
  const [activeArticle, setActiveArticle] = useState<ArticleId>(() => {
    const hash = window.location.hash.replace('#', '') as ArticleId;
    return articles.some(a => a.id === hash) ? hash : 'getting-started';
  });

  useEffect(() => {
    const hash = location.hash.replace('#', '') as ArticleId;
    if (articles.some(a => a.id === hash)) setActiveArticle(hash);
  }, [location.hash]);

  const navigate = (id: ArticleId) => {
    setActiveArticle(id);
    window.history.replaceState(null, '', `/docs#${id}`);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="docs-page">
      <nav className="docs-nav">
        <Link to="/" className="docs-brand">Introo</Link>
        <div className="docs-nav-tabs">
          {articles.map(a => (
            <button
              key={a.id}
              className={`docs-nav-tab ${activeArticle === a.id ? 'docs-nav-tab--active' : ''}`}
              onClick={() => navigate(a.id)}
            >
              {a.title}
            </button>
          ))}
        </div>
        <div className="docs-nav-links">
          <Link to="/home" className="docs-nav-link">Open App →</Link>
        </div>
      </nav>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <h3 className="docs-sidebar-title">Documentation</h3>
          {articles.map(a => (
            <button
              key={a.id}
              className={`docs-sidebar-item ${activeArticle === a.id ? 'docs-sidebar-item--active' : ''}`}
              onClick={() => navigate(a.id)}
            >
              <span className="docs-sidebar-icon">{a.icon}</span>
              <div className="docs-sidebar-text">
                <span className="docs-sidebar-name">{a.title}</span>
                <span className="docs-sidebar-desc">{a.subtitle}</span>
              </div>
            </button>
          ))}
        </aside>

        <main className="docs-main">
          {activeArticle === 'getting-started' && <GettingStartedArticle onNavigate={navigate} />}
          {activeArticle === 'filters' && <FiltersArticle />}
          {activeArticle === 'connections' && <ConnectionsArticle />}
          {activeArticle === 'spaces' && <SpacesArticle />}
          {activeArticle === 'intros' && <IntrosArticle />}

          <div className="docs-article-nav">
            {articles.findIndex(a => a.id === activeArticle) > 0 && (
              <button className="docs-article-nav-btn" onClick={() => navigate(articles[articles.findIndex(a => a.id === activeArticle) - 1].id)}>
                ← {articles[articles.findIndex(a => a.id === activeArticle) - 1].title}
              </button>
            )}
            <div style={{ flex: 1 }} />
            {articles.findIndex(a => a.id === activeArticle) < articles.length - 1 && (
              <button className="docs-article-nav-btn" onClick={() => navigate(articles[articles.findIndex(a => a.id === activeArticle) + 1].id)}>
                {articles[articles.findIndex(a => a.id === activeArticle) + 1].title} →
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
