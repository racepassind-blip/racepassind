import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "react-router-dom";

const PrivacyPolicy = () => {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Privacy Policy</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-200px)] pr-4">
            <div className="prose max-w-none space-y-6">
              <p className="text-sm text-muted-foreground">
                <strong>Last Updated:</strong> 20 September 2026
              </p>

              <p>
                Welcome to <strong>SportPass India</strong>.
              </p>
              <p>
                SportPass India provides a platform for discovering, registering for, organizing and managing sports events. Our platform may support registrations, participant management, payments, event-day operations, allocations, check-ins, scores, timings, standings and results depending on the type of event.
              </p>
              <p>
                This Privacy Policy explains what information we collect, why we collect it, how it may be used and shared, and the choices available to you when using SportPass India.
              </p>
              <p>
                By using SportPass India, you acknowledge the practices described in this Privacy Policy.
              </p>

              <h2 className="text-xl font-semibold mt-6">1. Information We Collect</h2>
              <p>The information we collect depends on how you use SportPass India.</p>

              <h3 className="text-lg font-medium mt-4">Account Information</h3>
              <p>When you create an account or use SportPass India, we may collect:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Name</li>
                <li>Email address</li>
                <li>Mobile number</li>
                <li>Login and account information</li>
                <li>Profile information</li>
              </ul>

              <h3 className="text-lg font-medium mt-4">Event Registration Information</h3>
              <p>When you register for an event, we may collect information required for that specific event, including:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Participant name</li>
                <li>Email address</li>
                <li>Mobile number</li>
                <li>Date of birth or age</li>
                <li>Gender</li>
                <li>Emergency contact information</li>
                <li>Team, club or group name</li>
                <li>Jersey or T-shirt size</li>
                <li>Event category</li>
                <li>Ticket or registration category</li>
                <li>Add-ons selected</li>
                <li>Participant-specific responses</li>
                <li>Other information requested by the event organizer</li>
              </ul>
              <p>
                Different sports and events may require different information. Event organizers may therefore configure additional registration questions relevant to their event.
              </p>

              <h2 className="text-xl font-semibold mt-6">2. Group or Multiple Participant Registrations</h2>
              <p>
                SportPass India may allow one person to register multiple participants, teammates or group members. In such cases, the person completing the registration may provide personal information about other participants. By submitting such information, the person making the registration confirms that they are authorized to provide that information for the purpose of participating in the event.
              </p>

              <h2 className="text-xl font-semibold mt-6">3. Payment Information</h2>
              <p>
                Some events on SportPass India may use direct UPI payments or other payment methods. Where direct UPI payments are used, payments may be made directly from the participant to the event organizer.
              </p>
              <p>SportPass India may process information related to the payment, including:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Payment amount</li>
                <li>UTR or transaction reference number</li>
                <li>Payment date</li>
                <li>Payment status</li>
                <li>Payment verification status</li>
                <li>Organizer payment information required to initiate payment</li>
              </ul>
              <p>
                SportPass India does not require users to provide their UPI PIN, banking password, OTP or similar authentication credentials. Where payments are processed through third-party payment providers, their respective terms and privacy policies may also apply.
              </p>

              <h2 className="text-xl font-semibold mt-6">4. Event-Day Information</h2>
              <p>
                Depending on the event and features being used, SportPass India may process information relating to:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Participant check-in</li>
                <li>Bib number</li>
                <li>Player number</li>
                <li>Team or group allocation</li>
                <li>Court or match allocation</li>
                <li>Start group or wave allocation</li>
                <li>Event item or goodie distribution</li>
                <li>Attendance</li>
                <li>Checkpoints</li>
                <li>Match status</li>
                <li>Activity status</li>
                <li>Scores</li>
                <li>Timings</li>
                <li>Rankings</li>
                <li>Standings</li>
                <li>Results</li>
              </ul>
              <p>Not every event uses all of these features.</p>

              <h2 className="text-xl font-semibold mt-6">5. Organizer Information</h2>
              <p>
                If you create, organize or manage events through SportPass India, we may collect:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Organizer name</li>
                <li>Organization, club or community name</li>
                <li>Email address</li>
                <li>Mobile number</li>
                <li>Event information</li>
                <li>Payment information configured for the event</li>
                <li>Billing information</li>
                <li>Account information</li>
                <li>Administrative information</li>
              </ul>
              <p>We may also collect information reasonably required to approve, verify or manage organizer accounts.</p>

              <h2 className="text-xl font-semibold mt-6">6. Technical Information</h2>
              <p>
                When you use SportPass India, certain technical information may be collected automatically, including:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>IP address</li>
                <li>Browser type</li>
                <li>Device information</li>
                <li>Operating system</li>
                <li>Pages visited</li>
                <li>Date and time of access</li>
                <li>Application logs</li>
                <li>Error logs</li>
                <li>Security logs</li>
              </ul>
              <p>
                This information may be used to maintain the platform, troubleshoot issues, improve performance and protect SportPass India from misuse or unauthorized access.
              </p>

              <h2 className="text-xl font-semibold mt-6">7. How We Use Your Information</h2>
              <p>We may use information collected through SportPass India to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Create and manage user accounts</li>
                <li>Process event registrations</li>
                <li>Provide registration confirmations</li>
                <li>Generate tickets or registration references</li>
                <li>Allow organizers to manage participants</li>
                <li>Associate payments with registrations</li>
                <li>Verify payment information</li>
                <li>Manage event categories</li>
                <li>Manage teams, groups and entries</li>
                <li>Allocate bibs, player numbers or other identifiers</li>
                <li>Manage event items or distributions</li>
                <li>Enable event-day check-in</li>
                <li>Support event operations</li>
                <li>Generate event-related exports</li>
                <li>Record scores, timings and outcomes</li>
                <li>Publish event results where applicable</li>
                <li>Send important event-related communications</li>
                <li>Provide customer support</li>
                <li>Prevent fraud, abuse or unauthorized use</li>
                <li>Maintain platform security</li>
                <li>Diagnose technical issues</li>
                <li>Improve SportPass India</li>
                <li>Meet legal and regulatory requirements</li>
              </ul>
              <p>SportPass India does not sell personal information to advertisers.</p>

              <h2 className="text-xl font-semibold mt-6">8. Event Organizers and Your Information</h2>
              <p>
                When you register for an event, information relevant to your registration may be made available to the organizer of that event. The organizer may use this information to operate the event, including for:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Participant verification</li>
                <li>Event communication</li>
                <li>Category management</li>
                <li>Team or group management</li>
                <li>Meal planning</li>
                <li>Merchandise or kit planning</li>
                <li>Bib or participant allocation</li>
                <li>Check-in</li>
                <li>Timing</li>
                <li>Scoring</li>
                <li>Results</li>
                <li>Safety coordination</li>
                <li>Emergency coordination</li>
                <li>Other reasonable event operations</li>
              </ul>
              <p>Event organizers are responsible for how they use participant information after receiving or exporting it from SportPass India.</p>

              <h2 className="text-xl font-semibold mt-6">9. Event Vendors and Operational Partners</h2>
              <p>Event organizers may sometimes need to share limited participant information with vendors, partners or teams involved in operating an event. This may include:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Timing providers</li>
                <li>Scoring providers</li>
                <li>Check-in teams</li>
                <li>Event staff</li>
                <li>Volunteers</li>
                <li>Merchandise or kit teams</li>
                <li>Logistics providers</li>
                <li>Other event-related service providers</li>
              </ul>
              <p>
                The information shared should be limited to what is reasonably necessary for the relevant event activity. SportPass India is not responsible for independent processing performed by event organizers or their external vendors after information has been exported from the platform.
              </p>

              <h2 className="text-xl font-semibold mt-6">10. Results and Public Information</h2>
              <p>Sports events may publish results publicly. Depending on the event, publicly visible information may include:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Participant name</li>
                <li>Bib or player number</li>
                <li>Team or club</li>
                <li>Event category</li>
                <li>Score</li>
                <li>Timing</li>
                <li>Rank</li>
                <li>Position</li>
                <li>Match result</li>
                <li>Bracket</li>
                <li>Standings</li>
                <li>Other event results</li>
              </ul>
              <p>Organizers may determine which results and event information are published through the features available to them. Contact information such as phone numbers and email addresses should not ordinarily be displayed as part of public event results.</p>

              <h2 className="text-xl font-semibold mt-6">11. Communications</h2>
              <p>SportPass India or event organizers may send communications relating to your registration or use of the platform. These communications may include:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Registration confirmations</li>
                <li>Payment status updates</li>
                <li>Tickets</li>
                <li>Event instructions</li>
                <li>Event updates</li>
                <li>Schedule changes</li>
                <li>Check-in details</li>
                <li>Match information</li>
                <li>Result notifications</li>
                <li>Account messages</li>
                <li>Security notifications</li>
              </ul>
              <p>Essential event or account communications may still be sent even where you choose not to receive promotional communications.</p>

              <h2 className="text-xl font-semibold mt-6">12. Cookies and Similar Technologies</h2>
              <p>SportPass India may use cookies or similar technologies to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Keep users signed in</li>
                <li>Maintain user sessions</li>
                <li>Remember preferences</li>
                <li>Improve website performance</li>
                <li>Understand how the platform is used</li>
                <li>Prevent abuse and security threats</li>
              </ul>
              <p>You may be able to manage cookies through your browser settings. Disabling certain cookies may affect the functionality of SportPass India.</p>

              <h2 className="text-xl font-semibold mt-6">13. Participants Under 18 Years of Age</h2>
              <p>
                Some events may allow participants under the age of 18. Where personal information about a minor is submitted, the registration should be completed or authorized by a parent, legal guardian or other person legally permitted to provide such information where required by applicable law. Event organizers should collect only information reasonably required for the minor's participation, safety and event administration.
              </p>

              <h2 className="text-xl font-semibold mt-6">14. Data Retention</h2>
              <p>SportPass India may retain personal information for as long as reasonably necessary for purposes including:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Providing platform services</li>
                <li>Maintaining event registration records</li>
                <li>Supporting participants and organizers</li>
                <li>Maintaining event results</li>
                <li>Resolving disputes</li>
                <li>Preventing fraud</li>
                <li>Maintaining audit records</li>
                <li>Complying with legal requirements</li>
                <li>Protecting the security of the platform</li>
              </ul>
              <p>
                Different categories of information may be retained for different periods. Where information is no longer required, it may be deleted, anonymized or securely disposed of, subject to legal and operational requirements.
              </p>

              <h2 className="text-xl font-semibold mt-6">15. Data Security</h2>
              <p>
                SportPass India uses reasonable technical and organizational safeguards designed to protect information processed through the platform. These measures may include:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Access controls</li>
                <li>Authentication</li>
                <li>Secure communications</li>
                <li>Infrastructure security</li>
                <li>Database security</li>
                <li>Restricted administrative access</li>
                <li>Logging and monitoring</li>
                <li>Backup and recovery procedures</li>
              </ul>
              <p>
                However, no internet-based platform, electronic communication system or storage method can guarantee absolute security. Users are responsible for keeping their account credentials confidential and should contact SportPass India if they believe their account may have been compromised.
              </p>

              <h2 className="text-xl font-semibold mt-6">16. Third-Party Service Providers</h2>
              <p>SportPass India may use third-party service providers to operate and improve the platform. These may include providers for:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Website and application hosting</li>
                <li>Database hosting</li>
                <li>File and media storage</li>
                <li>Email delivery</li>
                <li>Analytics</li>
                <li>Monitoring</li>
                <li>Security</li>
                <li>Customer support</li>
                <li>Payment processing</li>
              </ul>
              <p>
                These providers may process information where required to provide their services. Their own terms and privacy policies may apply to their processing activities.
              </p>

              <h2 className="text-xl font-semibold mt-6">17. Your Privacy Rights</h2>
              <p>Subject to applicable law, you may request:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Information about personal data held about you</li>
                <li>Correction of inaccurate information</li>
                <li>Updating of incomplete information</li>
                <li>Deletion or erasure of certain personal information</li>
                <li>Withdrawal of consent where applicable</li>
                <li>Information about how your personal information is being used</li>
                <li>Resolution of privacy-related grievances</li>
              </ul>
              <p>Certain information may need to be retained where required for:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Legal obligations</li>
                <li>Fraud prevention</li>
                <li>Security</li>
                <li>Payment records</li>
                <li>Event records</li>
                <li>Dispute resolution</li>
                <li>Audit requirements</li>
              </ul>

              <h2 className="text-xl font-semibold mt-6">18. Requests Related to Event Registrations</h2>
              <p>Some personal information is collected specifically to enable participation in an event. Deleting or modifying registration information may affect:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Participation eligibility</li>
                <li>Payment verification</li>
                <li>Ticket validity</li>
                <li>Check-in</li>
                <li>Team or category allocation</li>
                <li>Safety information</li>
                <li>Results</li>
                <li>Organizer records</li>
              </ul>
              <p>Where appropriate, SportPass India may work with the relevant event organizer when handling requests relating to event registration information.</p>

              <h2 className="text-xl font-semibold mt-6">19. International Data Processing</h2>
              <p>
                Some service providers used by SportPass India may process or store data outside India. Where this occurs, SportPass India will seek to handle such processing in accordance with applicable law and any applicable restrictions or requirements relating to international data transfers.
              </p>

              <h2 className="text-xl font-semibold mt-6">20. Legal Requirements and Disclosure</h2>
              <p>SportPass India may disclose information where reasonably necessary to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Comply with applicable law</li>
                <li>Respond to lawful government or regulatory requests</li>
                <li>Investigate suspected fraud or abuse</li>
                <li>Protect the security of SportPass India</li>
                <li>Protect participants or organizers</li>
                <li>Enforce applicable terms and policies</li>
                <li>Establish, exercise or defend legal claims</li>
              </ul>

              <h2 className="text-xl font-semibold mt-6">21. Links to Third-Party Websites</h2>
              <p>
                SportPass India may contain links to third-party websites or services. SportPass India is not responsible for the privacy practices, security or content of external websites. Users should review the privacy policies of any third-party services they use.
              </p>

              <h2 className="text-xl font-semibold mt-6">22. Changes to This Privacy Policy</h2>
              <p>
                SportPass India may update this Privacy Policy from time to time as the platform, services or applicable requirements change. When significant changes are made, the <strong>Last Updated</strong> date at the top of this page will be updated. Users are encouraged to review this Privacy Policy periodically.
              </p>

              <h2 className="text-xl font-semibold mt-6">23. Contact Us</h2>
              <p>
                If you have questions, concerns or requests regarding this Privacy Policy or your personal information, you can contact us at:
              </p>
              <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-medium">
                  <strong>SportPass India</strong>
                </p>
                <p className="mt-1">Email: sportpassind@gmail.com</p>
                <p className="mt-1">Website: https://sportpassindia.com/</p>
              </div>
              <p className="mt-4">
                For privacy-related requests or grievances, please email: sportpassind@gmail.com
              </p>
              <p>We will review legitimate privacy requests and respond as reasonably required under applicable law.</p>

              <div className="border-l-4 border-primary pl-4 mt-6">
                <p className="font-medium">Registration Privacy Notice</p>
                <p className="mt-2">
                  By registering, you agree that SportPass India and the event organizer may use the information you provide to process your registration and operate the event. Please review our Privacy Policy for more information.
                </p>
              </div>

              <div className="pt-6 pb-2">
                <Button asChild className="w-full">
                  <Link to="/">Return to Home</Link>
                </Button>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

export default PrivacyPolicy;