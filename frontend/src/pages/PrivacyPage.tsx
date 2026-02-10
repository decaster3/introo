import { Link } from 'react-router-dom';

export function PrivacyPage() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <Link to="/" className="legal-brand">Introo</Link>
      </nav>

      <div className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: February 10, 2024</p>

        <section>
          <h2>1. Introduction</h2>
          <p>
            Aspeen Inc. ("Company", "we", "us", or "our") operates Introo (the "Service"). This Privacy Policy 
            explains how we collect, use, disclose, and safeguard your information when you use our Service.
          </p>
          <p>
            We take your privacy seriously. Please read this Privacy Policy carefully. By using the Service, 
            you agree to the collection and use of information in accordance with this policy.
          </p>
        </section>

        <section>
          <h2>2. Information We Collect</h2>
          
          <h3>2.1 Information You Provide</h3>
          <ul>
            <li><strong>Account Information:</strong> Name, email address, and profile photo from your Google account</li>
            <li><strong>Profile Information:</strong> Professional information you choose to add to your profile</li>
            <li><strong>Communications:</strong> Messages and intro requests you send through the Service</li>
          </ul>

          <h3>2.2 Google Calendar Data</h3>
          <p>
            When you connect your Google Calendar, we access and process the following data:
          </p>
          <ul>
            <li><strong>Event Metadata:</strong> Event titles, dates, times, and attendee email addresses</li>
            <li><strong>Meeting Patterns:</strong> Frequency and recency of meetings with contacts</li>
          </ul>
          <p>
            <strong>What we DO NOT access:</strong>
          </p>
          <ul>
            <li>Event descriptions or notes</li>
            <li>Event attachments or documents</li>
            <li>Location details</li>
            <li>Private or confidential event content</li>
          </ul>

          <h3>2.3 Automatically Collected Information</h3>
          <ul>
            <li>Device information (browser type, operating system)</li>
            <li>Usage data (pages visited, features used)</li>
            <li>IP address and general location</li>
          </ul>
        </section>

        <section>
          <h2>3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide and maintain the Service</li>
            <li>Create your professional network map based on calendar data</li>
            <li>Match you with community members who can provide introductions</li>
            <li>Facilitate intro requests between users</li>
            <li>Send you important updates about the Service</li>
            <li>Improve and optimize the Service</li>
            <li>Detect and prevent fraud or abuse</li>
          </ul>
        </section>

        <section>
          <h2>4. Google API Services User Data Policy</h2>
          <p>
            Our use and transfer of information received from Google APIs adheres to the 
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer"> Google API Services User Data Policy</a>, 
            including the Limited Use requirements.
          </p>
          <p>Specifically:</p>
          <ul>
            <li>We only use Google Calendar data to provide the intro matching features you've requested</li>
            <li>We do not sell, rent, or share your Google data with third parties for advertising</li>
            <li>We do not use Google data for purposes unrelated to the Service's core functionality</li>
            <li>Human access to your Google data is limited to necessary support and legal compliance</li>
          </ul>
        </section>

        <section>
          <h2>5. Data Sharing and Disclosure</h2>
          <p>We may share your information in the following situations:</p>
          <ul>
            <li><strong>With Your Consent:</strong> When you explicitly agree to share information</li>
            <li><strong>Within Communities:</strong> Limited profile information is visible to members of Spaces you join</li>
            <li><strong>For Introductions:</strong> Relevant contact information shared when facilitating intros</li>
            <li><strong>Service Providers:</strong> With trusted vendors who assist in operating our Service</li>
            <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
          </ul>
          <p>
            <strong>We do not sell your personal information to third parties.</strong>
          </p>
        </section>

        <section>
          <h2>6. Data Security</h2>
          <p>
            We implement appropriate technical and organizational security measures to protect your 
            personal information, including:
          </p>
          <ul>
            <li>Encryption of data in transit (TLS/SSL)</li>
            <li>Encryption of sensitive data at rest</li>
            <li>Regular security assessments</li>
            <li>Access controls and authentication</li>
            <li>Secure cloud infrastructure</li>
          </ul>
          <p>
            However, no method of transmission over the Internet is 100% secure. We cannot guarantee 
            absolute security of your data.
          </p>
        </section>

        <section>
          <h2>7. Data Retention</h2>
          <p>
            We retain your personal information for as long as your account is active or as needed to 
            provide you with the Service. You can request deletion of your data at any time by contacting us.
          </p>
          <p>
            When you disconnect your Google Calendar or delete your account:
          </p>
          <ul>
            <li>We stop accessing your Google Calendar data immediately</li>
            <li>Derived network data is deleted within 30 days</li>
            <li>Account information is deleted upon request</li>
          </ul>
        </section>

        <section>
          <h2>8. Your Rights and Choices</h2>
          <p>You have the right to:</p>
          <ul>
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Correction:</strong> Request correction of inaccurate data</li>
            <li><strong>Deletion:</strong> Request deletion of your data</li>
            <li><strong>Portability:</strong> Request your data in a portable format</li>
            <li><strong>Revoke Access:</strong> Disconnect Google Calendar at any time via Google Account settings</li>
            <li><strong>Opt-out:</strong> Opt out of non-essential communications</li>
          </ul>
          <p>
            To exercise these rights, contact us at privacy@introo.app.
          </p>
        </section>

        <section>
          <h2>9. Children's Privacy</h2>
          <p>
            The Service is not intended for users under 18 years of age. We do not knowingly collect 
            personal information from children. If we discover that a child has provided us with personal 
            information, we will delete it immediately.
          </p>
        </section>

        <section>
          <h2>10. International Data Transfers</h2>
          <p>
            Your information may be transferred to and processed in countries other than your country 
            of residence. We ensure appropriate safeguards are in place to protect your information 
            in accordance with this Privacy Policy.
          </p>
        </section>

        <section>
          <h2>11. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any material 
            changes by posting the new Privacy Policy on this page and updating the "Last updated" date. 
            We encourage you to review this Privacy Policy periodically.
          </p>
        </section>

        <section>
          <h2>12. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or our data practices, please contact us at:
          </p>
          <p>
            <strong>Aspeen Inc.</strong><br />
            Email: privacy@introo.app
          </p>
          <p>
            For Google-related data inquiries, you may also manage your connected apps at:<br />
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
              https://myaccount.google.com/permissions
            </a>
          </p>
        </section>
      </div>

      <footer className="legal-footer">
        <Link to="/">← Back to Introo</Link>
        <span>·</span>
        <Link to="/terms">Terms of Use</Link>
      </footer>
    </div>
  );
}
