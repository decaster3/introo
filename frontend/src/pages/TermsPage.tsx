import { Link } from 'react-router-dom';

export function TermsPage() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <Link to="/" className="legal-brand">Introo</Link>
      </nav>

      <div className="legal-content">
        <h1>Terms of Use</h1>
        <p className="legal-updated">Last updated: February 23, 2026</p>

        <section>
          <h2>1. Agreement to Terms</h2>
          <p>
            By accessing or using Introo ("Service"), operated by Aspeen Inc. ("Company", "we", "us", or "our"), 
            you agree to be bound by these Terms of Use ("Terms"). If you disagree with any part of these terms, 
            you may not access the Service.
          </p>
        </section>

        <section>
          <h2>2. Description of Service</h2>
          <p>
            Introo is a professional networking platform that helps users discover connections within their 
            network and facilitate warm introductions. The Service allows users to:
          </p>
          <ul>
            <li>Connect their Google Calendar to identify professional relationships</li>
            <li>Join private communities ("Spaces") with trusted peers</li>
            <li>Request and provide introductions to other professionals</li>
            <li>Manage their professional network</li>
          </ul>
        </section>

        <section>
          <h2>3. Google Calendar Access</h2>
          <p>
            To use certain features of the Service, you may choose to connect your Google Calendar. 
            By doing so, you authorize us to:
          </p>
          <ul>
            <li>Access your calendar event metadata (attendees, dates, event titles)</li>
            <li>Analyze meeting patterns to identify your professional network</li>
            <li>Store derived relationship data to power intro matching</li>
          </ul>
          <p>
            We access your calendar in read-only mode -- we never modify, create, or delete events. 
            We process event metadata including titles, descriptions, attendees, and times.
            You can revoke this access at any time through your Google Account settings.
          </p>
        </section>

        <section>
          <h2>4. User Accounts</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account and for all activities 
            that occur under your account. You agree to:
          </p>
          <ul>
            <li>Provide accurate and complete information when creating an account</li>
            <li>Keep your account credentials secure</li>
            <li>Notify us immediately of any unauthorized use of your account</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>
        </section>

        <section>
          <h2>5. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul>
            <li>Violate any applicable laws or regulations</li>
            <li>Harass, abuse, or harm other users</li>
            <li>Send spam or unsolicited communications</li>
            <li>Impersonate others or misrepresent your affiliation</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Use automated means to access the Service without permission</li>
            <li>Share false or misleading information about your network</li>
          </ul>
        </section>

        <section>
          <h2>6. User Content</h2>
          <p>
            You retain ownership of content you submit to the Service. By submitting content, you grant us 
            a non-exclusive, worldwide, royalty-free license to use, display, and distribute your content 
            in connection with operating the Service.
          </p>
        </section>

        <section>
          <h2>7. Privacy</h2>
          <p>
            Your use of the Service is also governed by our <Link to="/privacy">Privacy Policy</Link>. 
            Please review our Privacy Policy to understand our practices regarding your personal information.
          </p>
        </section>

        <section>
          <h2>8. Intellectual Property</h2>
          <p>
            The Service and its original content, features, and functionality are owned by Aspeen Inc. 
            and are protected by international copyright, trademark, and other intellectual property laws.
          </p>
        </section>

        <section>
          <h2>9. Termination</h2>
          <p>
            We may terminate or suspend your account and access to the Service immediately, without prior 
            notice or liability, for any reason, including breach of these Terms. Upon termination, your 
            right to use the Service will cease immediately.
          </p>
        </section>

        <section>
          <h2>10. Disclaimer of Warranties</h2>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER 
            EXPRESS OR IMPLIED. WE DO NOT GUARANTEE THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR 
            ERROR-FREE.
          </p>
        </section>

        <section>
          <h2>11. Limitation of Liability</h2>
          <p>
            IN NO EVENT SHALL ASPEEN INC., ITS DIRECTORS, EMPLOYEES, PARTNERS, OR AFFILIATES BE LIABLE 
            FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR 
            USE OF THE SERVICE.
          </p>
        </section>

        <section>
          <h2>12. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will notify users of any material 
            changes by posting the new Terms on this page and updating the "Last updated" date. Your 
            continued use of the Service after changes constitutes acceptance of the new Terms.
          </p>
        </section>

        <section>
          <h2>13. Contact Us</h2>
          <p>
            If you have any questions about these Terms, please contact us at:
          </p>
          <p>
            <strong>Aspeen Inc.</strong><br />
            Email: legal@introo.app
          </p>
        </section>
      </div>

      <footer className="legal-footer">
        <Link to="/">← Back to Introo</Link>
        <span>·</span>
        <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  );
}
